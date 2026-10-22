import { test } from 'node:test';
import assert from 'node:assert/strict';

test('ESM에서 electron-updater의 CommonJS default export를 읽는다', async () => {
  const { default: updater } = await import('electron-updater');
  // getter를 실행하려면 Electron이 필요하므로 Node에서는 export descriptor를 검사한다.
  assert.equal(typeof Object.getOwnPropertyDescriptor(updater, 'autoUpdater')?.get, 'function');
});
