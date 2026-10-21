import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveRuntimeDir } from '../src/runtime-dir.js';
import { shouldCheckForUpdates } from '../src/update-policy.js';

describe('resolveRuntimeDir', () => {
  it('uses resources/runtime when packaged, ignoring the env var', () => {
    expect(
      resolveRuntimeDir({
        packaged: true,
        resourcesPath: '/app/resources',
        env: { ARTEL_RUNTIME_DIR: '/x' },
      }),
    ).toBe(path.join('/app/resources', 'runtime'));
  });
  it('uses ARTEL_RUNTIME_DIR in development', () => {
    expect(
      resolveRuntimeDir({
        packaged: false,
        resourcesPath: '/r',
        env: { ARTEL_RUNTIME_DIR: '/dev/rt' },
      }),
    ).toBe('/dev/rt');
  });
  it('leaves the default to the supervisor when unset or empty', () => {
    expect(resolveRuntimeDir({ packaged: false, resourcesPath: '/r', env: {} })).toBeUndefined();
    expect(
      resolveRuntimeDir({ packaged: false, resourcesPath: '/r', env: { ARTEL_RUNTIME_DIR: '' } }),
    ).toBeUndefined();
  });
});

describe('shouldCheckForUpdates', () => {
  it('requires a packaged, signed build', () => {
    expect(shouldCheckForUpdates({ packaged: true, signed: true, env: {} })).toBe(true);
    expect(shouldCheckForUpdates({ packaged: true, signed: false, env: {} })).toBe(false);
    expect(shouldCheckForUpdates({ packaged: false, signed: true, env: {} })).toBe(false);
  });
  it('can be switched off by the environment', () => {
    expect(
      shouldCheckForUpdates({ packaged: true, signed: true, env: { ARTEL_DISABLE_UPDATES: '1' } }),
    ).toBe(false);
    expect(
      shouldCheckForUpdates({ packaged: true, signed: true, env: { ARTEL_DISABLE_UPDATES: '0' } }),
    ).toBe(true);
  });
});
