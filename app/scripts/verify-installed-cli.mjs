import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

const directory = path.resolve(process.argv[2]);
const result = spawnSync(
  path.join(directory, 'artel.exe'),
  [
    path.join(directory, 'resources/app.asar.unpacked/node_modules/@project-artel/cli/dist/cli.js'),
    '--version',
  ],
  {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true,
    encoding: 'utf8',
    timeout: 60000,
  },
);
assert.equal(result.status, 0, result.error?.message ?? result.stderr);
assert.match(result.stdout, /\d+\.\d+\.\d+/);
console.log(`Installed CLI: ${result.stdout.trim()}`);
