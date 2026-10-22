import { cp, lstat, mkdir, mkdtemp, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function validateDataLocation(dataDir: string, installationDir: string): void {
  const contains = (parent: string, child: string): boolean => {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return (
      relative === '' ||
      (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
    );
  };
  if (contains(installationDir, dataDir) || contains(dataDir, installationDir)) {
    throw new Error('The installation and data directories must be separate before updating.');
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

// PG_VERSION이 없는 기존 디렉터리를 supervisor가 초기화하며 삭제하지 못하게 한다.
export async function validateExistingData(dataDir: string, runtimeDir?: string): Promise<void> {
  const pgdata = path.join(dataDir, 'pgdata');
  if (!(await exists(pgdata))) return;
  if (!(await exists(path.join(pgdata, 'PG_VERSION'))) && (await readdir(pgdata)).length > 0) {
    throw new Error(`PostgreSQL data is incomplete. Restore a backup before starting: ${pgdata}`);
  }
  if (runtimeDir && (await exists(path.join(pgdata, 'PG_VERSION')))) {
    const stored = (await readFile(path.join(pgdata, 'PG_VERSION'), 'utf8')).trim();
    const manifest = JSON.parse(await readFile(path.join(runtimeDir, 'manifest.json'), 'utf8')) as {
      components?: { postgres?: string };
    };
    const bundled = manifest.components?.postgres?.split('.')[0];
    if (stored !== bundled) {
      throw new Error(
        `PostgreSQL ${stored} data cannot be opened with runtime ${bundled ?? 'unknown'}. A PostgreSQL upgrade is required.`,
      );
    }
  }
}

export async function acquireUpdateLock(dataDir: string): Promise<() => Promise<void>> {
  await mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, 'supervisor.lock');
  // CLI도 같은 PID lock을 사용하므로 백업 중 새 stack을 시작할 수 없다.
  await writeFile(file, String(process.pid), { flag: 'wx', mode: 0o600 });
  return () => unlink(file);
}

export async function backupForUpdate(dataDir: string, version: string): Promise<string> {
  await validateExistingData(dataDir);
  const pidFile = path.join(dataDir, 'pgdata', 'postmaster.pid');
  if (await exists(pidFile)) {
    throw new Error('PostgreSQL has not shut down cleanly. Stop the stack before updating.');
  }
  const root = path.join(dataDir, 'backups');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const destination = await mkdtemp(path.join(root, 'before-update-'));
  // runtime과 재생성되는 console 파일은 제외하고 사용자 데이터만 보관한다.
  for (const name of ['pgdata', 'storage', 'config.json']) {
    const source = path.join(dataDir, name);
    if (await exists(source)) {
      await cp(source, path.join(destination, name), {
        recursive: true,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: true,
        filter: async (file) => {
          if ((await lstat(file)).isSymbolicLink()) {
            throw new Error(`Back up linked data separately before updating: ${file}`);
          }
          return true;
        },
      });
    }
  }
  const pgVersionFile = path.join(dataDir, 'pgdata', 'PG_VERSION');
  const postgresVersion = (await exists(pgVersionFile))
    ? (await readFile(pgVersionFile, 'utf8')).trim()
    : null;
  // 이 파일이 없는 백업은 복사 도중 실패한 것이므로 복원에 사용하지 않는다.
  await writeFile(
    path.join(destination, 'backup.json'),
    JSON.stringify(
      {
        version,
        postgresVersion,
        createdAt: new Date().toISOString(),
        dataDir,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  return destination;
}
