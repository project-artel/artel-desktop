// Stand-in for `@project-artel/cli/supervisor`, copied from section 3 of
// .plan/general/2026-10-20-package-artel-as-headless-and-desktop-app.md.
// Delete this file once the published package ships its own declarations.

export type ServiceName = 'postgres' | 'orchestration' | 'agent-server' | 'proxy';
export type ServiceState = 'stopped' | 'starting' | 'ready' | 'crashed';

export interface StackTls {
  certFile: string;
  keyFile: string;
}

/** What `config.json` holds. `host` is `0.0.0.0` to accept other machines. */
export interface StackSettings {
  host: string;
  port: number;
  publicUrl: string;
  tls: StackTls | null;
}

export interface SupervisorOptions {
  runtimeDir?: string;
  dataDir?: string;
  host?: string;
  port?: number;
  publicUrl?: string;
  tls?: StackTls | null;
  onEvent?: (event: SupervisorEvent) => void;
}

export type SupervisorEvent =
  | { type: 'service'; service: ServiceName; state: ServiceState; detail?: string }
  | { type: 'log'; service: ServiceName; line: string }
  | { type: 'ready'; url: string };

export interface RunningStack {
  url: string;
  attached: boolean;
  stop(): Promise<void>;
}

export interface StackStatus {
  running: boolean;
  url?: string;
  pid?: number;
  services: Record<ServiceName, ServiceState>;
}

export interface SupervisorApi {
  defaultDataDir(): string;
  startStack(options?: SupervisorOptions): Promise<RunningStack>;
  stopStack(options?: Pick<SupervisorOptions, 'dataDir'>): Promise<void>;
  stackStatus(options?: Pick<SupervisorOptions, 'dataDir'>): Promise<StackStatus>;
  readStackSettings(options?: Pick<SupervisorOptions, 'dataDir'>): Promise<StackSettings>;
  /** Validates, writes config.json, returns merged settings. Takes effect on the next start. Throws on invalid input. */
  writeStackSettings(
    changes: Partial<StackSettings>,
    options?: Pick<SupervisorOptions, 'dataDir'>,
  ): Promise<StackSettings>;
  logDir(options?: Pick<SupervisorOptions, 'dataDir'>): string;
}
