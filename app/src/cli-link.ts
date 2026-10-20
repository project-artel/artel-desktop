import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  appImageLauncher,
  macLinkOsascriptArgs,
  planCliLink,
  type CliLinkPlan,
} from './cli-shim.js';

const run = promisify(execFile);

export interface LinkEnv {
  platform: NodeJS.Platform;
  resourcesPath: string;
  homeDir: string;
  appImage: string | undefined;
  pathEnv: string;
}

export function planFor(env: LinkEnv): CliLinkPlan {
  return planCliLink(env);
}

/** Performs the link. The macOS path shows the system administrator prompt. */
export async function applyCliLink(plan: CliLinkPlan): Promise<void> {
  if (plan.kind === 'symlink-admin') {
    await run('osascript', macLinkOsascriptArgs(plan));
  } else if (
    plan.kind === 'script-user' &&
    plan.linkPath !== undefined &&
    plan.targetPath !== undefined
  ) {
    await fs.mkdir(path.dirname(plan.linkPath), { recursive: true });
    await fs.writeFile(plan.linkPath, appImageLauncher(plan.targetPath), { mode: 0o755 });
  }
}

export async function isLinked(plan: CliLinkPlan): Promise<boolean> {
  if (plan.linkPath === undefined) return false;
  try {
    await fs.lstat(plan.linkPath);
    return true;
  } catch {
    return false;
  }
}
