// Sandboxed preload: only `electron` may be required here, and the file must be CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import electron = require('electron');

const { contextBridge, ipcRenderer } = electron;

interface StartupStateMessage {
  phase: string;
}

contextBridge.exposeInMainWorld('artelStartup', {
  getState: (): Promise<StartupStateMessage> =>
    ipcRenderer.invoke('artel:get-state') as Promise<StartupStateMessage>,
  onState: (listener: (state: StartupStateMessage) => void): void => {
    ipcRenderer.on('artel:state', (_event, state: StartupStateMessage) => {
      listener(state);
    });
  },
  retry: (): void => {
    ipcRenderer.send('artel:retry');
  },
  openLogs: (): void => {
    ipcRenderer.send('artel:open-logs');
  },
});
