import { describe, expect, it, vi } from 'vitest';
import { StackController, type StartupState } from '../src/lifecycle.js';
import type {
  RunningStack,
  SupervisorApi,
  SupervisorEvent,
  SupervisorOptions,
} from '../src/supervisor-types.js';

function fakeSupervisor(
  overrides: { attached?: boolean; fail?: Error; events?: SupervisorEvent[] } = {},
) {
  const stop = vi.fn(() => Promise.resolve());
  const stopStack = vi.fn(() => Promise.resolve());
  const startStack = vi.fn((options?: SupervisorOptions): Promise<RunningStack> => {
    for (const event of overrides.events ?? []) options?.onEvent?.(event);
    if (overrides.fail !== undefined) return Promise.reject(overrides.fail);
    return Promise.resolve({
      url: 'http://127.0.0.1:8088',
      attached: overrides.attached ?? false,
      stop,
    });
  });
  const supervisor: SupervisorApi = {
    defaultDataDir: () => '/data',
    startStack,
    stopStack,
    stackStatus: () => Promise.reject(new Error('unused')),
    readStackSettings: () => Promise.reject(new Error('unused')),
    writeStackSettings: () => Promise.reject(new Error('unused')),
    logDir: () => '/data/logs',
  };
  return { supervisor, stop, stopStack, startStack };
}

describe('StackController', () => {
  it('reports ready with the url and the attached flag', async () => {
    const { supervisor } = fakeSupervisor();
    const controller = new StackController({ supervisor });
    await controller.start();
    expect(controller.state.phase).toBe('ready');
    expect(controller.url).toBe('http://127.0.0.1:8088');
    expect(controller.state.attached).toBe(false);
  });

  it('tracks service events including crash detail', async () => {
    const { supervisor } = fakeSupervisor({
      events: [
        { type: 'service', service: 'postgres', state: 'starting' },
        { type: 'service', service: 'postgres', state: 'crashed', detail: 'port in use' },
      ],
    });
    const controller = new StackController({ supervisor });
    await controller.start();
    expect(controller.state.services.postgres).toEqual({ state: 'crashed', detail: 'port in use' });
    expect(controller.state.services.proxy.state).toBe('stopped');
  });

  it('fails with the error message and allows a retry', async () => {
    const failing = fakeSupervisor({ fail: new Error('runtime missing') });
    const states: StartupState[] = [];
    const controller = new StackController({
      supervisor: failing.supervisor,
      onChange: (s) => states.push(s),
    });
    await controller.start();
    expect(controller.state).toMatchObject({ phase: 'failed', error: 'runtime missing' });
    await controller.start();
    expect(failing.startStack).toHaveBeenCalledTimes(2);
    expect(states.at(-1)?.phase).toBe('failed');
  });

  it('clears the error when a retry starts', async () => {
    const failing = fakeSupervisor({ fail: new Error('boom') });
    const controller = new StackController({ supervisor: failing.supervisor });
    await controller.start();
    const pending = controller.start();
    expect(controller.state.error).toBeUndefined();
    await pending;
  });

  it('shares one start between concurrent calls', async () => {
    const { supervisor, startStack } = fakeSupervisor();
    const controller = new StackController({ supervisor });
    await Promise.all([controller.start(), controller.start()]);
    expect(startStack).toHaveBeenCalledTimes(1);
  });

  it('quit stops a stack the app started', async () => {
    const { supervisor, stop, stopStack } = fakeSupervisor({ attached: false });
    const controller = new StackController({ supervisor });
    await controller.start();
    await controller.quit();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stopStack).not.toHaveBeenCalled();
  });

  it('quit leaves an attached stack running', async () => {
    const { supervisor, stop, stopStack } = fakeSupervisor({ attached: true });
    const controller = new StackController({ supervisor });
    await controller.start();
    await controller.quit();
    expect(stop).not.toHaveBeenCalled();
    expect(stopStack).not.toHaveBeenCalled();
  });

  it('explicit stop of an attached stack calls stopStack with the data directory', async () => {
    const { supervisor, stop, stopStack } = fakeSupervisor({ attached: true });
    const controller = new StackController({ supervisor, dataDir: '/custom' });
    await controller.start();
    await controller.stop();
    expect(stopStack).toHaveBeenCalledWith({ dataDir: '/custom' });
    expect(stop).not.toHaveBeenCalled();
    expect(controller.state.phase).toBe('stopped');
  });

  it('explicit stop of an owned stack uses the handle, then a new start works', async () => {
    const { supervisor, stop, startStack } = fakeSupervisor();
    const controller = new StackController({ supervisor });
    await controller.start();
    await controller.stop();
    expect(stop).toHaveBeenCalledTimes(1);
    await controller.start();
    expect(startStack).toHaveBeenCalledTimes(2);
  });

  it('passes runtimeDir and dataDir to the supervisor only when set', async () => {
    const { supervisor, startStack } = fakeSupervisor();
    await new StackController({ supervisor }).start();
    expect(Object.keys(startStack.mock.calls[0]?.[0] ?? {})).toEqual(['onEvent']);
    await new StackController({ supervisor, runtimeDir: '/rt', dataDir: '/d' }).start();
    expect(startStack.mock.calls[1]?.[0]).toMatchObject({ runtimeDir: '/rt', dataDir: '/d' });
  });

  it('quit while nothing runs does nothing', async () => {
    const { supervisor, stop } = fakeSupervisor();
    await new StackController({ supervisor }).quit();
    expect(stop).not.toHaveBeenCalled();
  });
});
