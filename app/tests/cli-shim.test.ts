import { describe, expect, it } from 'vitest';
import {
  addToPath,
  appImageLauncher,
  cliArgsFromArgv,
  macLinkOsascriptArgs,
  pathContains,
  planCliLink,
  removeFromPath,
  shimCmd,
  shimSh,
  shQuote,
} from '../src/cli-shim.js';

describe('shims', () => {
  it('sh shim runs the unpacked CLI with ELECTRON_RUN_AS_NODE and the runtime dir', () => {
    const sh = shimSh();
    expect(sh.startsWith('#!/bin/sh\n')).toBe(true);
    expect(sh).toContain('ELECTRON_RUN_AS_NODE=1');
    expect(sh).toContain('ARTEL_RUNTIME_DIR="$resources/runtime"');
    expect(sh).toContain('app.asar.unpacked/node_modules/@project-artel/cli/dist/cli.js');
    expect(sh).toContain('MacOS/ARTEL');
    expect(sh).toContain('artel-desktop');
    expect(sh.endsWith('"$@"\n')).toBe(true);
  });
  it('cmd shim uses backslashes, CRLF and forwards arguments', () => {
    const cmd = shimCmd();
    expect(cmd).toContain('set "ELECTRON_RUN_AS_NODE=1"');
    expect(cmd).toContain('set "ARTEL_RUNTIME_DIR=%RESOURCES%\\runtime"');
    expect(cmd).toContain(
      '"%RESOURCES%\\..\\ARTEL.exe" "%RESOURCES%\\app.asar.unpacked\\node_modules\\@project-artel\\cli\\dist\\cli.js" %*',
    );
    expect(cmd).toContain('\r\n');
    expect(cmd.replace(/\r\n/g, '')).not.toContain('\n');
  });
});

describe('windows PATH', () => {
  const dir = 'C:\\Users\\a\\AppData\\Local\\Programs\\ARTEL\\resources\\bin';
  it('detects an entry regardless of case and trailing slash', () => {
    expect(pathContains(`C:\\x;${dir.toUpperCase()}\\`, dir, 'win32')).toBe(true);
    expect(pathContains('C:\\x;C:\\y', dir, 'win32')).toBe(false);
  });
  it('adds once and removes only that entry', () => {
    const added = addToPath('C:\\x;', dir);
    expect(added).toBe(`C:\\x;${dir}`);
    expect(addToPath(added, dir)).toBe(added);
    expect(addToPath('', dir)).toBe(dir);
    expect(removeFromPath(added, dir)).toBe('C:\\x');
    expect(removeFromPath('C:\\x', dir)).toBe('C:\\x');
  });
  it('is case sensitive on linux', () => {
    expect(pathContains('/usr/bin:/Home/a/bin', '/home/a/bin', 'linux')).toBe(false);
    expect(pathContains('/usr/bin:/home/a/bin/', '/home/a/bin', 'linux')).toBe(true);
  });
});

describe('planCliLink', () => {
  const base = {
    resourcesPath: '/Applications/ARTEL.app/Contents/Resources',
    homeDir: '/home/a',
    pathEnv: '/usr/bin',
  };
  it('links /usr/local/bin/artel on macOS with an administrator prompt', () => {
    const plan = planCliLink({ ...base, platform: 'darwin', appImage: undefined });
    expect(plan).toEqual({
      kind: 'symlink-admin',
      linkPath: '/usr/local/bin/artel',
      targetPath: '/Applications/ARTEL.app/Contents/Resources/bin/artel',
    });
    const args = macLinkOsascriptArgs(plan);
    expect(args[0]).toBe('-e');
    expect(args[1]).toContain('with administrator privileges');
    expect(args[1]).toContain(
      "ln -sf '/Applications/ARTEL.app/Contents/Resources/bin/artel' '/usr/local/bin/artel'",
    );
  });
  it('writes a launcher into ~/.local/bin for an AppImage and hints when it is not on PATH', () => {
    const plan = planCliLink({ ...base, platform: 'linux', appImage: '/opt/ARTEL.AppImage' });
    expect(plan).toMatchObject({
      kind: 'script-user',
      linkPath: '/home/a/.local/bin/artel',
      targetPath: '/opt/ARTEL.AppImage',
      needsPathHint: true,
    });
    const onPath = planCliLink({
      ...base,
      platform: 'linux',
      appImage: '/opt/ARTEL.AppImage',
      pathEnv: '/usr/bin:/home/a/.local/bin',
    });
    expect(onPath.needsPathHint).toBe(false);
  });
  it('offers nothing for deb, NSIS and unknown platforms', () => {
    expect(planCliLink({ ...base, platform: 'linux', appImage: undefined }).kind).toBe('none');
    expect(planCliLink({ ...base, platform: 'win32', appImage: undefined }).kind).toBe('none');
  });
  it('escapes quotes in osascript and sh', () => {
    expect(shQuote("it's")).toBe(`'it'\\''s'`);
    const args = macLinkOsascriptArgs({
      kind: 'symlink-admin',
      linkPath: '/usr/local/bin/artel',
      targetPath: '/A "B"/artel',
    });
    expect(args[1]).toContain('\\"B\\"');
  });
});

describe('AppImage launcher', () => {
  it('starts the AppImage in CLI mode and passes arguments after --', () => {
    const script = appImageLauncher('/opt/ARTEL.AppImage');
    expect(script).toContain(`ARTEL_RUN_CLI=1 exec '/opt/ARTEL.AppImage' -- "$@"`);
  });
  it('takes the CLI arguments after the separator', () => {
    expect(cliArgsFromArgv(['/app', '--', 'server', 'status'])).toEqual(['server', 'status']);
    expect(cliArgsFromArgv(['/app'])).toEqual([]);
  });
});
