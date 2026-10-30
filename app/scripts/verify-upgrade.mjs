import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { extractFile, uncache } from '@electron/asar';

const [mode, executable, directory, expectedVersion, feedDirectory] = process.argv.slice(2);
const executablePath = path.resolve(executable);
const dataDir = path.resolve(directory);
const fixtureFile = path.join(dataDir, 'upgrade-fixture.json');
const reportFile = path.join(dataDir, 'upgrade-report.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const digest = (data) => createHash('sha256').update(data).digest('hex');
await mkdir(dataDir, { recursive: true });

async function poll(check, label, timeout = 300000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(1000);
  }
  throw new Error(`Timed out: ${label}`);
}

async function launch(updates = false) {
  const env = {
    ...process.env,
    ARTEL_DATA_DIR: dataDir,
    ARTEL_DISABLE_UPDATES: updates ? '0' : '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath,
    env,
    args: ['--lang=en-US'],
    timeout: 60000,
  });
  let page;
  try {
    await poll(async () => {
      for (const candidate of app.windows()) {
        if (candidate.url().startsWith('http://127.0.0.1:')) page = candidate;
        if (candidate.url().includes('startup.html')) {
          const state = await candidate.evaluate(() => window.artelStartup?.getState());
          if (state?.phase === 'failed') throw new Error(state.error);
        }
      }
      return Boolean(page);
    }, 'stack startup');
    await page.waitForLoadState('domcontentloaded');
    return { app, page };
  } catch (error) {
    await app.close();
    throw error;
  }
}

const migrationHistoryQuery =
  "SELECT installed_rank || ':' || coalesce(version, '') || ':' || coalesce(checksum::text, '') FROM flyway_schema_history WHERE success ORDER BY installed_rank";

async function sql(query) {
  const config = JSON.parse(await readFile(path.join(dataDir, 'config.json'), 'utf8'));
  const psql = path.join(path.dirname(executablePath), 'resources/runtime/postgres/bin/psql.exe');
  return execFileSync(
    psql,
    [
      '-X',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      '127.0.0.1',
      '-p',
      String(config.ports.postgres),
      '-U',
      'artel',
      '-d',
      'artel',
      '-c',
      query,
    ],
    {
      env: { ...process.env, PGPASSWORD: config.dbPassword },
      encoding: 'utf8',
      windowsHide: true,
    },
  ).trim();
}

async function me(page) {
  return page.evaluate(async () => {
    let response = await fetch('/api/auth/me');
    if (response.status === 401) {
      await fetch('/api/auth/refresh', { method: 'POST' });
      response = await fetch('/api/auth/me');
    }
    if (!response.ok) throw new Error(`Session lost: ${response.status}`);
    return response.json();
  });
}

async function report(entry) {
  const previous = await readFile(reportFile, 'utf8')
    .then(JSON.parse)
    .catch(() => []);
  previous.push(entry);
  await writeFile(reportFile, JSON.stringify(previous, null, 2));
  console.log(JSON.stringify(entry));
}

async function verify(app, page, version) {
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), version);
  const fixture = JSON.parse(await readFile(fixtureFile, 'utf8'));
  assert.deepEqual(await me(page), fixture.account, 'Account/session changed');
  assert.equal(await sql('SELECT payload FROM desktop_update_probe WHERE id = 1'), fixture.row);
  // A newer runtime may add migrations; the ones applied before the upgrade must stay as they were.
  const migrations = (await sql(migrationHistoryQuery)).split(/\r?\n/);
  assert.deepEqual(
    migrations.slice(0, fixture.migrations.length),
    fixture.migrations,
    'Migration history changed',
  );
  assert.equal(await sql('SELECT count(*) FROM flyway_schema_history WHERE NOT success'), '0');
  assert.equal(digest(await readFile(path.join(dataDir, 'config.json'))), fixture.configHash);
  assert.equal(
    digest(await readFile(path.join(dataDir, 'storage', 'upgrade-probe.bin'))),
    fixture.fileHash,
  );
  await page.screenshot({ path: path.join(dataDir, `upgrade-${version}.png`) });
  await report({
    version,
    accountAndSession: true,
    databaseRow: true,
    migrationHistory: true,
    configAndEncryptionKeys: true,
    storageFile: true,
  });
}

if (mode === 'seed') {
  const { app, page } = await launch();
  try {
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), expectedVersion);
    await page.evaluate(
      async (password) => {
        const result = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'upgrade-test@example.test',
            name: '업데이트 보존 테스트',
            password,
          }),
        });
        if (!result.ok) throw new Error(`Signup failed: ${result.status}`);
      },
      `Artel-${randomBytes(20).toString('hex')}!`,
    );
    await sql(
      "CREATE TABLE desktop_update_probe (id integer PRIMARY KEY, payload text NOT NULL); INSERT INTO desktop_update_probe VALUES (1, 'preserve-existing-data-2026');",
    );
    await mkdir(path.join(dataDir, 'storage'), { recursive: true });
    await writeFile(path.join(dataDir, 'storage', 'upgrade-probe.bin'), randomBytes(65536));
    await writeFile(
      fixtureFile,
      JSON.stringify({
        account: await me(page),
        row: await sql('SELECT payload FROM desktop_update_probe WHERE id = 1'),
        migrations: (await sql(migrationHistoryQuery)).split(/\r?\n/),
        configHash: digest(await readFile(path.join(dataDir, 'config.json'))),
        fileHash: digest(await readFile(path.join(dataDir, 'storage', 'upgrade-probe.bin'))),
      }),
    );
    await verify(app, page, expectedVersion);
  } finally {
    await app.close();
  }
} else if (mode === 'verify') {
  const { app, page } = await launch();
  try {
    await verify(app, page, expectedVersion);
  } finally {
    await app.close();
  }
} else if (mode === 'auto') {
  const feed = path.resolve(feedDirectory);
  const server = createServer(async (request, response) => {
    try {
      const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1);
      if (name !== path.basename(name)) {
        response.writeHead(404).end();
        return;
      }
      const file = path.join(feed, name);
      const info = await stat(file);
      response.writeHead(200, {
        'Content-Length': info.size,
        'Content-Type': 'application/octet-stream',
      });
      createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { app } = await launch(true);
  let exited = false;
  app.on('close', () => {
    exited = true;
  });
  try {
    await poll(
      () =>
        app.evaluate(({ Menu }) =>
          Menu.getApplicationMenu().items[0].submenu.items.some(
            (item) => ['Check for updates', '업데이트 확인'].includes(item.label) && item.enabled,
          ),
        ),
      'initial check',
    );
    await app.evaluate(({ app, dialog }, url) => {
      const require = process
        .getBuiltinModule('module')
        .createRequire(`${app.getAppPath()}/package.json`);
      const { autoUpdater } = require('electron-updater');
      autoUpdater.setFeedURL({ provider: 'generic', url, channel: `latest-${process.arch}` });
      autoUpdater.disableDifferentialDownload = true;
      autoUpdater.autoRunAppAfterInstall = false;
      // CI에서는 확인 대화상자와 NSIS wizard만 생략하고 앱의 종료·백업 경로를 그대로 실행한다.
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
      dialog.showErrorBox = (_title, message) => {
        console.error(message);
      };
      const install = autoUpdater.quitAndInstall.bind(autoUpdater);
      autoUpdater.quitAndInstall = () => install(true, false);
    }, `http://127.0.0.1:${server.address().port}/`);
    async function click(labels) {
      await poll(
        () =>
          app.evaluate(
            ({ Menu }, labels) =>
              Menu.getApplicationMenu().items[0].submenu.items.some(
                (item) => labels.includes(item.label) && item.enabled,
              ),
            labels,
          ),
        labels.join('/'),
      );
      await app.evaluate(({ Menu }, labels) => {
        const item = Menu.getApplicationMenu().items[0].submenu.items.find((item) =>
          labels.includes(item.label),
        );
        item.click();
      }, labels);
    }
    await click(['Check for updates', '업데이트 확인']);
    await click(['Download update', '업데이트 다운로드']);
    await click(['Restart to update', '재시작하여 업데이트']);
    await poll(() => exited, 'source app shutdown');
    await poll(async () => {
      try {
        const archive = path.join(path.dirname(executablePath), 'resources/app.asar');
        uncache(archive);
        return (
          JSON.parse(extractFile(archive, 'package.json').toString()).version === expectedVersion
        );
      } catch {
        return false;
      }
    }, 'installer replacement');
    // NSIS가 파일 교체 뒤 shortcut/registry 작업을 마칠 시간을 준다.
    await sleep(5000);
    const backups = await readdir(path.join(dataDir, 'backups'));
    const completed = [];
    for (const name of backups) {
      const backup = path.join(dataDir, 'backups', name);
      try {
        await readFile(path.join(backup, 'backup.json'));
        completed.push(backup);
      } catch {
        /* 실패한 백업 제외 */
      }
    }
    assert.equal(completed.length, 1);
    const fixture = JSON.parse(await readFile(fixtureFile, 'utf8'));
    assert.equal(
      digest(await readFile(path.join(completed[0], 'config.json'))),
      fixture.configHash,
    );
    assert.equal(
      digest(await readFile(path.join(completed[0], 'storage/upgrade-probe.bin'))),
      fixture.fileHash,
    );
    assert.ok((await stat(path.join(completed[0], 'pgdata/PG_VERSION'))).isFile());
    await report({
      automaticDownloadAndInstall: true,
      completedBackup: true,
      targetVersion: expectedVersion,
    });
    const next = await launch();
    try {
      await verify(next.app, next.page, expectedVersion);
    } finally {
      await next.app.close();
    }
  } finally {
    if (!exited) await app.close();
    await new Promise((resolve) => server.close(resolve));
  }
} else {
  throw new Error(`Unknown mode: ${mode}`);
}
