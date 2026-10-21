import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateRuntime } from './validate-runtime.mjs';

test('rejects missing, wrong-target, incomplete and escaping runtime bundles', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'artel-runtime-test-'));
  try {
    await assert.rejects(validateRuntime(directory, 'win32-x64'));
    const manifest = {
      schemaVersion: 1,
      target: 'win32-arm64',
      version: '0.1.0',
      executables: Object.fromEntries(
        ['postgres', 'initdb', 'pg_ctl', 'pg_isready', 'createdb', 'java', 'python'].map((name) => [
          name,
          `${name}.exe`,
        ]),
      ),
      orchestrationJar: 'orchestration.jar',
      agentServerDir: 'agent-server',
      homeDir: 'home',
    };
    const save = () => writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
    await save();
    await assert.rejects(validateRuntime(directory, 'win32-x64'), /Expected runtime/);
    manifest.target = 'win32-x64';
    await save();
    await assert.rejects(validateRuntime(directory, 'win32-x64'));
    await mkdir(path.join(directory, 'agent-server/app'), { recursive: true });
    await mkdir(path.join(directory, 'home'));
    for (const file of [
      ...Object.values(manifest.executables),
      manifest.orchestrationJar,
      'agent-server/app/main.py',
      'home/index.html',
    ]) {
      await writeFile(path.join(directory, file), 'fixture');
    }
    assert.equal((await validateRuntime(directory, 'win32-x64')).target, 'win32-x64');
    manifest.executables.java = '../java.exe';
    await save();
    await assert.rejects(validateRuntime(directory, 'win32-x64'), /Invalid runtime path/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
