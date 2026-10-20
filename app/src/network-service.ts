import type { StartupState } from './lifecycle.js';
import {
  defaultPublicUrl,
  draftFromSettings,
  effectivePublicUrl,
  plainTextWarning,
  toSettingsChanges,
  type NetworkDraft,
  type NetworkWarning,
} from './network-settings.js';
import type { StackSettings, SupervisorApi } from './supervisor-types.js';

/** The slice of StackController the service needs. */
export interface StackControl {
  readonly state: StartupState;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export type StackMode = 'owned' | 'attached' | 'not-running';

export interface NetworkView {
  draft: NetworkDraft;
  defaultPublicUrl: string;
  accessUrl: string;
  warning: NetworkWarning | null;
  stackMode: StackMode;
}

export type SaveApplied = 'restarted' | 'next-start';

export type SaveResult =
  | {
      ok: true;
      applied: SaveApplied;
      view: NetworkView;
      /** Set when the restart after saving failed; the settings are saved either way. */
      restartError?: string;
    }
  | { ok: false; error: string };

export interface NetworkServiceOptions {
  supervisor: SupervisorApi;
  controller: StackControl;
  machineName: string;
  dataDir?: string | undefined;
  /** Called once the new settings are on disk, before the stack restarts. */
  onSaved?: (settings: StackSettings) => void;
}

export class NetworkSettingsService {
  constructor(private readonly options: NetworkServiceOptions) {}

  async view(): Promise<NetworkView> {
    return this.toView(await this.options.supervisor.readStackSettings(this.dataDirOption()));
  }

  evaluate(draft: NetworkDraft): NetworkWarning | null {
    return plainTextWarning(draft, defaultPublicUrl(draft, this.options.machineName));
  }

  async save(draft: NetworkDraft): Promise<SaveResult> {
    const { supervisor, controller, machineName } = this.options;
    let settings: StackSettings;
    try {
      settings = await supervisor.writeStackSettings(
        toSettingsChanges(draft, machineName),
        this.dataDirOption(),
      );
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    this.options.onSaved?.(settings);

    if (this.mode() !== 'owned') {
      return { ok: true, applied: 'next-start', view: this.toView(settings) };
    }
    await controller.stop();
    await controller.start();
    const after = controller.state;
    return {
      ok: true,
      applied: 'restarted',
      view: this.toView(settings),
      ...(after.phase === 'failed'
        ? { restartError: after.error ?? 'The stack did not start' }
        : {}),
    };
  }

  private mode(): StackMode {
    const { phase, attached } = this.options.controller.state;
    if (phase !== 'ready' && phase !== 'starting') return 'not-running';
    return attached === true ? 'attached' : 'owned';
  }

  private toView(settings: StackSettings): NetworkView {
    const draft = draftFromSettings(settings);
    const { machineName } = this.options;
    return {
      draft,
      defaultPublicUrl: defaultPublicUrl(draft, machineName),
      accessUrl: effectivePublicUrl(draft, machineName),
      warning: this.evaluate(draft),
      stackMode: this.mode(),
    };
  }

  private dataDirOption(): { dataDir?: string } {
    return this.options.dataDir === undefined ? {} : { dataDir: this.options.dataDir };
  }
}
