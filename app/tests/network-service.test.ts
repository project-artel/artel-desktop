import { describe, expect, it, vi } from 'vitest';
import type { StartupState } from '../src/lifecycle.js';
import { NetworkSettingsService, type StackControl } from '../src/network-service.js';
import type { NetworkDraft } from '../src/network-settings.js';
import { allowedOrigins, decideNavigationAmong } from '../src/url-policy.js';
import type { StackSettings, SupervisorApi } from '../src/supervisor-types.js';

const stored: StackSettings = {
  host: '127.0.0.1',
  port: 8088,
  publicUrl: 'http://127.0.0.1:8088',
  tls: null,
};

const draft: NetworkDraft = {
  shared: true,
  port: 8088,
  publicUrl: 'https://artel.example.com',
  useTls: false,
  certFile: null,
  keyFile: null,
};

function setup(
  state: Partial<StartupState>,
  write: (changes: Partial<StackSettings>) => Promise<StackSettings> = (changes) =>
    Promise.resolve({ ...stored, ...changes }),
) {
  const calls: string[] = [];
  const controller: StackControl & { state: StartupState } = {
    state: { phase: 'idle', services: {} as StartupState['services'], ...state },
    stop: vi.fn(() => {
      calls.push('stop');
      return Promise.resolve();
    }),
    start: vi.fn(() => {
      calls.push('start');
      return Promise.resolve();
    }),
  };
  const writeStackSettings = vi.fn(write);
  const supervisor = {
    readStackSettings: () => Promise.resolve(stored),
    writeStackSettings,
  } as unknown as SupervisorApi;
  const onSaved = vi.fn();
  const service = new NetworkSettingsService({
    supervisor,
    controller,
    machineName: 'box',
    onSaved,
  });
  return { service, controller, calls, writeStackSettings, onSaved };
}

describe('NetworkSettingsService.save', () => {
  it('restarts a stack the app owns: stop, then start', async () => {
    const { service, calls, writeStackSettings, onSaved } = setup({ phase: 'ready' });
    const result = await service.save(draft);
    expect(writeStackSettings).toHaveBeenCalledWith(
      { host: '0.0.0.0', port: 8088, publicUrl: 'https://artel.example.com', tls: null },
      {},
    );
    expect(calls).toEqual(['stop', 'start']);
    expect(result).toMatchObject({ ok: true, applied: 'restarted' });
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('saves but never stops an attached stack', async () => {
    const { service, calls } = setup({ phase: 'ready', attached: true });
    const result = await service.save(draft);
    expect(calls).toEqual([]);
    expect(result).toMatchObject({ ok: true, applied: 'next-start' });
    if (result.ok) expect(result.view.stackMode).toBe('attached');
  });

  it('only saves when no stack is running', async () => {
    const { service, calls } = setup({ phase: 'stopped' });
    expect(await service.save(draft)).toMatchObject({ ok: true, applied: 'next-start' });
    expect(calls).toEqual([]);
  });

  it('returns the supervisor validation error and does not restart', async () => {
    const { service, calls, onSaved } = setup({ phase: 'ready' }, () =>
      Promise.reject(new Error('port must be between 1 and 65535')),
    );
    const result = await service.save({ ...draft, port: 0 });
    expect(result).toEqual({ ok: false, error: 'port must be between 1 and 65535' });
    expect(calls).toEqual([]);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('reports a failed restart while keeping the saved settings', async () => {
    const { service, controller } = setup({ phase: 'ready' });
    controller.stop = vi.fn(() => Promise.resolve());
    controller.start = vi.fn(() => {
      controller.state = { ...controller.state, phase: 'failed', error: 'port in use' };
      return Promise.resolve();
    });
    expect(await service.save(draft)).toMatchObject({
      ok: true,
      applied: 'restarted',
      restartError: 'port in use',
    });
  });
});

describe('navigation origin after the public URL changes', () => {
  it('allows the loaded origin and the new public origin only', () => {
    const before = allowedOrigins('http://127.0.0.1:8088', 'http://127.0.0.1:8088');
    expect(decideNavigationAmong('https://artel.example.com/x', before)).toBe('open-external');
    const after = allowedOrigins('http://127.0.0.1:8088', 'https://artel.example.com');
    expect(decideNavigationAmong('https://artel.example.com/x', after)).toBe('allow');
    expect(decideNavigationAmong('http://127.0.0.1:8088/', after)).toBe('allow');
    expect(decideNavigationAmong('https://evil.example.org/', after)).toBe('open-external');
    expect(decideNavigationAmong('file:///etc/passwd', after)).toBe('block');
  });

  it('ignores an unparsable public URL', () => {
    expect(allowedOrigins('http://127.0.0.1:8088', 'nope')).toEqual(['http://127.0.0.1:8088']);
  });
});
