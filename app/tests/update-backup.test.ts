import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  acquireUpdateLock,
  backupForUpdate,
  validateDataLocation,
  validateExistingData,
} from '../src/update-backup.js';

const temporary: string[] = [];
afterEach(async () => {
  for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'artel-update-test-'));
  temporary.push(dir);
  await mkdir(path.join(dir, 'pgdata'));
  await writeFile(path.join(dir, 'pgdata', 'PG_VERSION'), '16');
  await writeFile(path.join(dir, 'pgdata', 'database'), 'existing rows');
  await writeFile(path.join(dir, 'config.json'), '{"secretsKey":"existing-key"}');
  await mkdir(path.join(dir, 'storage'));
  await writeFile(path.join(dir, 'storage', 'evidence'), 'evidence');
  return dir;
}

describe('업데이트 데이터 보존', () => {
  it('설치 폴더와 데이터 폴더가 겹치면 업데이트를 막는다', () => {
    expect(() => validateDataLocation('/app/data', '/app')).toThrow('separate');
    expect(() => validateDataLocation('/app', '/app')).toThrow('separate');
    expect(() => validateDataLocation('/app', '/app/desktop')).toThrow('separate');
    expect(() => validateDataLocation('/app-data', '/app')).not.toThrow();
  });
  it('기존 DB와 설정 및 파일을 변경하지 않고 완성된 백업을 만든다', async () => {
    const dir = await fixture();
    const destination = await backupForUpdate(dir, '0.1.0');
    for (const file of [
      'pgdata/PG_VERSION',
      'pgdata/database',
      'config.json',
      'storage/evidence',
    ]) {
      expect(await readFile(path.join(destination, file))).toEqual(
        await readFile(path.join(dir, file)),
      );
    }
    expect(JSON.parse(await readFile(path.join(destination, 'backup.json'), 'utf8'))).toMatchObject(
      {
        version: '0.1.0',
        postgresVersion: '16',
        dataDir: dir,
      },
    );
  });
  it('PostgreSQL이 종료되지 않았으면 백업을 시작하지 않는다', async () => {
    const dir = await fixture();
    await writeFile(path.join(dir, 'pgdata', 'postmaster.pid'), '1234');
    await expect(backupForUpdate(dir, '0.1.0')).rejects.toThrow('shut down');
    expect(await readdir(dir)).not.toContain('backups');
  });
  it('PG_VERSION이 사라진 기존 DB를 초기화하지 않는다', async () => {
    const dir = await fixture();
    await rm(path.join(dir, 'pgdata', 'PG_VERSION'));
    await expect(validateExistingData(dir)).rejects.toThrow('incomplete');
    expect(await readFile(path.join(dir, 'pgdata', 'database'), 'utf8')).toBe('existing rows');
  });
  it('PostgreSQL major 변경은 별도 업그레이드를 요구한다', async () => {
    const dir = await fixture();
    await writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ components: { postgres: '17.0' } }),
    );
    await expect(validateExistingData(dir, dir)).rejects.toThrow('upgrade is required');
    await writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ components: { postgres: '16.9' } }),
    );
    await expect(validateExistingData(dir, dir)).resolves.toBeUndefined();
  });
  it('다른 supervisor의 lock을 덮어쓰지 않는다', async () => {
    const dir = await fixture();
    const release = await acquireUpdateLock(dir);
    await expect(acquireUpdateLock(dir)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(path.join(dir, 'supervisor.lock'), 'utf8')).toBe(String(process.pid));
    await release();
  });
});
