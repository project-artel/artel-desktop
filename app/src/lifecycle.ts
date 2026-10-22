import type {
  RunningStack,
  ServiceName,
  ServiceState,
  SupervisorApi,
  SupervisorEvent,
} from './supervisor-types.js';

export const SERVICE_ORDER: readonly ServiceName[] = [
  'postgres',
  'orchestration',
  'agent-server',
  'proxy',
];

export type Phase = 'idle' | 'starting' | 'ready' | 'failed' | 'stopped';

export interface ServiceView {
  state: ServiceState;
  detail?: string;
}

export interface StartupState {
  phase: Phase;
  services: Record<ServiceName, ServiceView>;
  url?: string;
  attached?: boolean;
  error?: string;
}

export interface StackControllerOptions {
  supervisor: SupervisorApi;
  runtimeDir?: string | undefined;
  dataDir?: string | undefined;
  onChange?: (state: StartupState) => void;
}

function initialServices(): Record<ServiceName, ServiceView> {
  return {
    postgres: { state: 'stopped' },
    orchestration: { state: 'stopped' },
    'agent-server': { state: 'stopped' },
    proxy: { state: 'stopped' },
  };
}

/**
 * Owns the supervisor handle. The one rule that matters: a stack this app started is
 * stopped on quit, a stack that was already running (`attached`, started by the CLI)
 * is left running.
 */
export class StackController {
  private handle: RunningStack | undefined;
  private starting: Promise<void> | undefined;
  private maintenance = false;
  private current: StartupState = { phase: 'idle', services: initialServices() };

  constructor(private readonly options: StackControllerOptions) {}

  get state(): StartupState {
    return this.current;
  }

  get url(): string | undefined {
    return this.current.phase === 'ready' ? this.current.url : undefined;
  }

  /** Starts the stack. Calls made while a start is in progress share that start. */
  start(): Promise<void> {
    if (this.maintenance) return Promise.resolve();
    if (this.handle !== undefined) return Promise.resolve();
    this.starting ??= this.runStart().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  /** Stops the stack on the user's explicit request, attached or not. */
  async stop(): Promise<void> {
    await this.starting?.catch(() => undefined);
    const handle = this.handle;
    if (handle === undefined) return;
    if (handle.attached) {
      await this.options.supervisor.stopStack(this.dataDirOption());
    } else {
      await handle.stop();
    }
    this.handle = undefined;
    this.update({ phase: 'stopped', services: initialServices() });
  }

  /** Called on app quit: stops only a stack this app started. */
  async quit(): Promise<void> {
    await this.starting?.catch(() => undefined);
    const handle = this.handle;
    if (handle === undefined || handle.attached) return;
    await handle.stop();
    this.handle = undefined;
  }

  async prepareUpdate(backup: () => Promise<unknown>): Promise<void> {
    if (this.maintenance) throw new Error('An update is already being prepared.');
    this.maintenance = true;
    try {
      await this.starting;
      if (this.handle?.attached) {
        throw new Error('Stop the stack started by the CLI before updating.');
      }
      await this.stop();
      if ((await this.options.supervisor.stackStatus(this.dataDirOption())).running) {
        throw new Error('The stack is still running. Stop it before updating.');
      }
      await backup();
    } catch (error) {
      this.maintenance = false;
      throw error;
    }
  }

  cancelUpdate(): void {
    this.maintenance = false;
  }

  logDir(): string {
    return this.options.supervisor.logDir(this.dataDirOption());
  }

  private dataDirOption(): { dataDir?: string } {
    return this.options.dataDir === undefined ? {} : { dataDir: this.options.dataDir };
  }

  private async runStart(): Promise<void> {
    this.update({ phase: 'starting', services: initialServices() });
    try {
      const { supervisor, runtimeDir, dataDir } = this.options;
      const handle = await supervisor.startStack({
        ...(runtimeDir === undefined ? {} : { runtimeDir }),
        ...(dataDir === undefined ? {} : { dataDir }),
        onEvent: (event) => this.onEvent(event),
      });
      this.handle = handle;
      this.update({ phase: 'ready', url: handle.url, attached: handle.attached });
    } catch (error) {
      this.update({
        phase: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private onEvent(event: SupervisorEvent): void {
    if (event.type !== 'service') return;
    const view: ServiceView =
      event.detail === undefined
        ? { state: event.state }
        : { state: event.state, detail: event.detail };
    this.update({ services: { ...this.current.services, [event.service]: view } });
  }

  private update(patch: Partial<StartupState>): void {
    const next: StartupState = { ...this.current, ...patch };
    if (patch.phase !== undefined && patch.phase !== 'failed') delete next.error;
    this.current = next;
    this.options.onChange?.(next);
  }
}
