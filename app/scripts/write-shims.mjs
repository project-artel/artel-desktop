// Writes build/bin/artel and build/bin/artel.cmd, which electron-builder copies to resources/bin.
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { shimCmd, shimSh } from '../dist/cli-shim.js';

const outDir = path.join(import.meta.dirname, '..', 'build', 'bin');
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'artel'), shimSh());
await chmod(path.join(outDir, 'artel'), 0o755);
await writeFile(path.join(outDir, 'artel.cmd'), shimCmd());
