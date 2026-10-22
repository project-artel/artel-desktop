export interface UpdateClient {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export type UpdatePhase =
  'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing';

export class UpdateService {
  phase: UpdatePhase = 'idle';

  constructor(
    private readonly client: UpdateClient,
    private readonly prepare: () => Promise<void>,
    private readonly changed: () => void,
  ) {
    client.autoDownload = false;
    // DB 종료와 백업을 거치지 않는 자동 설치를 막는다.
    client.autoInstallOnAppQuit = false;
  }

  setPhase(phase: UpdatePhase): void {
    this.phase = phase;
    this.changed();
  }

  async check(): Promise<void> {
    if (this.phase !== 'idle' && this.phase !== 'available') return;
    this.setPhase('checking');
    try {
      await this.client.checkForUpdates();
    } catch (error) {
      this.setPhase('idle');
      throw error;
    }
  }

  async download(): Promise<void> {
    if (this.phase !== 'available') return;
    this.setPhase('downloading');
    try {
      await this.client.downloadUpdate();
      this.setPhase('downloaded');
    } catch (error) {
      this.setPhase('available');
      throw error;
    }
  }

  async install(): Promise<void> {
    if (this.phase !== 'downloaded') return;
    this.setPhase('installing');
    try {
      await this.prepare();
      this.client.quitAndInstall(false, true);
    } catch (error) {
      this.setPhase('downloaded');
      throw error;
    }
  }
}
