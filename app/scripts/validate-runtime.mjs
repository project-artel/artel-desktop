import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function validateRuntime(directory, target) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.target !== target) {
    throw new Error(`Expected runtime schema 1 for ${target}`);
  }
  const required = ['postgres', 'initdb', 'pg_ctl', 'pg_isready', 'createdb', 'java', 'python'];
  const entries = required.map((name) => manifest.executables?.[name]);
  entries.push(manifest.orchestrationJar);
  for (const entry of [manifest.agentServerDir, manifest.homeDir, ...entries]) {
    if (
      typeof entry !== 'string' ||
      !entry ||
      entry.includes('\\') ||
      path.isAbsolute(entry) ||
      /^[A-Za-z]:/.test(entry) ||
      entry.split('/').includes('..')
    ) {
      throw new Error(`Invalid runtime path: ${entry}`);
    }
    await access(path.join(directory, entry));
  }
  await access(path.join(directory, manifest.agentServerDir, 'app/main.py'));
  await access(path.join(directory, manifest.homeDir, 'index.html'));
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await validateRuntime(process.argv[2], process.argv[3]);
  console.log(`Validated runtime ${manifest.version} (${manifest.target})`);
}
