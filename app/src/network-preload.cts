// Sandboxed preload: only `electron` may be required here, and the file must be CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import electron = require('electron');

const { contextBridge, ipcRenderer } = electron;

type PickKind = 'certificate' | 'key';

contextBridge.exposeInMainWorld('artelNetwork', {
  get: (): Promise<unknown> => ipcRenderer.invoke('artel:network:get') as Promise<unknown>,
  evaluate: (draft: unknown): Promise<unknown> =>
    ipcRenderer.invoke('artel:network:evaluate', draft) as Promise<unknown>,
  save: (draft: unknown): Promise<unknown> =>
    ipcRenderer.invoke('artel:network:save', draft) as Promise<unknown>,
  pickFile: (kind: PickKind): Promise<string | null> =>
    ipcRenderer.invoke('artel:network:pick-file', kind) as Promise<string | null>,
  copyAccessUrl: (): Promise<boolean> =>
    ipcRenderer.invoke('artel:network:copy-access-url') as Promise<boolean>,
});
