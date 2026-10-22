import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
} from 'electron';
import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyCliLink, isLinked, planFor, type LinkEnv } from './cli-link.js';
import { cliArgsFromArgv } from './cli-shim.js';
import { StackController } from './lifecycle.js';
import { NetworkSettingsService } from './network-service.js';
import { parseNetworkDraft } from './network-settings.js';
import { resolveRuntimeDir } from './runtime-dir.js';
import { loadSupervisor } from './supervisor.js';
import { shouldCheckForUpdates } from './update-policy.js';
import {
  acquireUpdateLock,
  backupForUpdate,
  validateDataLocation,
  validateExistingData,
} from './update-backup.js';
import { UpdateService } from './update-service.js';
import { allowedOrigins, decideNavigationAmong, decideWindowOpen } from './url-policy.js';

const here = import.meta.dirname;

// AppImage mount paths change on every run, so its launcher starts the app in CLI mode instead.
if (process.env['ARTEL_RUN_CLI'] === '1') {
  const cliPath = path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@project-artel',
    'cli',
    'dist',
    'cli.js',
  );
  process.env['ARTEL_RUNTIME_DIR'] = path.join(process.resourcesPath, 'runtime');
  process.argv = [process.execPath, cliPath, ...cliArgsFromArgv(process.argv)];
  await import(cliPath);
} else {
  // Not awaited: Electron emits `ready` only after the ESM main module's top-level await settles,
  // and startDesktop waits for `ready`, so awaiting it here never opens a window.
  startDesktop().catch((error: unknown) => {
    dialog.showErrorBox('ARTEL', error instanceof Error ? error.message : String(error));
    app.exit(1);
  });
}

async function startDesktop(): Promise<void> {
  const dataDir = process.env['ARTEL_DATA_DIR'];
  if (dataDir) {
    const desktopData = path.join(path.resolve(dataDir), 'desktop');
    await fs.mkdir(desktopData, { recursive: true });
    app.setPath('userData', desktopData);
  }
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  const supervisor = await loadSupervisor();
  const resolvedDataDir = path.resolve(dataDir?.trim() || supervisor.defaultDataDir());
  const runtimeDir = resolveRuntimeDir({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    env: process.env,
  });
  await validateExistingData(resolvedDataDir, runtimeDir);
  const controller = new StackController({
    supervisor,
    dataDir,
    runtimeDir: resolveRuntimeDir({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      env: process.env,
    }),
    onChange: (state) => {
      startupWindow?.webContents.send('artel:state', state);
      if (state.phase === 'ready' && state.url !== undefined) showConsole(state.url);
      refreshTray();
    },
  });

  let startupWindow: BrowserWindow | undefined;
  let networkWindow: BrowserWindow | undefined;
  // The public URL last saved or read; the main window's navigation policy allows its origin.
  let publicUrl: string | undefined;
  let appOrigins: string[] = [];
  let mainWindow: BrowserWindow | undefined;
  // Assigned after the app is ready, but read earlier by refreshTray.
  // eslint-disable-next-line prefer-const
  let tray: Tray | undefined;
  let quitting = false;
  let updates: UpdateService | undefined;
  let updateError: string | undefined;
  let releaseUpdateLock: (() => Promise<void>) | undefined;

  const localText = (ko: string, en: string): string =>
    app.getLocale().toLowerCase().startsWith('ko') ? ko : en;

  function updateMenuItem(): Electron.MenuItemConstructorOptions {
    const phase = updates?.phase ?? 'idle';
    const labels = {
      idle: localText('업데이트 확인', 'Check for updates'),
      checking: localText('업데이트 확인 중…', 'Checking for updates…'),
      available: localText('업데이트 다운로드', 'Download update'),
      downloading: localText('업데이트 다운로드 중…', 'Downloading update…'),
      downloaded: localText('재시작하여 업데이트', 'Restart to update'),
      installing: localText('업데이트 준비 중…', 'Preparing update…'),
    };
    return {
      label: labels[phase],
      enabled: !['checking', 'downloading', 'installing'].includes(phase),
      click: () => void runUpdateAction(),
    };
  }

  async function runUpdateAction(): Promise<void> {
    try {
      if (!updates) {
        await dialog
          .showMessageBox({
            message: localText('설치 파일로 업데이트해 주세요.', 'Update using the installer.'),
            detail: localText(
              '릴리스 페이지에서 새 설치 파일을 받을 수 있어요.',
              'Download the new installer from the releases page.',
            ),
            buttons: [
              localText('릴리스 페이지 열기', 'Open releases'),
              localText('취소', 'Cancel'),
            ],
            cancelId: 1,
          })
          .then(({ response }) => {
            if (response === 0)
              openExternal('https://github.com/project-artel/artel-desktop/releases/latest');
          });
        return;
      }
      if (updates.phase === 'available') await updates.download();
      else if (updates.phase === 'downloaded') {
        const { response } = await dialog.showMessageBox({
          type: 'question',
          message: localText('ARTEL을 재시작하여 업데이트할까요?', 'Restart ARTEL to update?'),
          detail: localText(
            '진행 중인 작업을 마친 뒤 업데이트해 주세요.',
            'Finish any running work before updating.',
          ),
          buttons: [localText('업데이트', 'Update'), localText('나중에', 'Later')],
          defaultId: 1,
          cancelId: 1,
        });
        if (response === 0) await updates.install();
      } else if (updates.phase === 'idle') {
        updateError = undefined;
        await updates.check();
        if (updateError) throw new Error(updateError);
        if (updates.phase === 'idle')
          await dialog.showMessageBox({
            message: localText('최신 버전입니다.', 'ARTEL is up to date.'),
          });
      }
    } catch (error) {
      quitting = false;
      controller.cancelUpdate();
      await releaseUpdateLock?.();
      releaseUpdateLock = undefined;
      await dialog.showMessageBox({
        type: 'error',
        message: localText(
          '업데이트하지 못했어요. 다시 시도해 주세요.',
          'Could not update. Please try again.',
        ),
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function initializeUpdates(): Promise<void> {
    if (
      !shouldCheckForUpdates({
        packaged: app.isPackaged,
        signed: readSigned(),
        platform: process.platform,
        env: process.env,
      })
    )
      return;
    const { default: updater } = await import('electron-updater');
    const { autoUpdater } = updater;
    updates = new UpdateService(
      autoUpdater,
      async () => {
        validateDataLocation(resolvedDataDir, path.dirname(process.resourcesPath));
        await controller.prepareUpdate(async () => {
          releaseUpdateLock = await acquireUpdateLock(resolvedDataDir);
          await backupForUpdate(resolvedDataDir, app.getVersion());
        });
        quitting = true;
      },
      () => {
        applicationMenu();
        refreshTray();
      },
    );
    autoUpdater.on('update-available', () => updates?.setPhase('available'));
    autoUpdater.on('update-not-available', () => updates?.setPhase('idle'));
    autoUpdater.on('error', (error) => {
      updateError = error.message;
      if (updates?.phase === 'installing') {
        quitting = false;
        controller.cancelUpdate();
        const release = releaseUpdateLock;
        releaseUpdateLock = undefined;
        void Promise.resolve(release?.()).then(() => {
          updates?.setPhase('downloaded');
          dialog.showErrorBox('ARTEL', error.message);
        });
      }
    });
    await updates.check().catch(() => undefined);
  }

  const iconPath = path.join(here, '..', 'assets', 'icon.png');
  // The tray shows the mark at 16 to 22 px, where the app icon's padding would shrink it further.
  const trayIconPath = path.join(here, '..', 'assets', 'tray.png');

  const hardenedPreferences = {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  } as const;

  function openStartupWindow(): void {
    if (startupWindow !== undefined && !startupWindow.isDestroyed()) {
      startupWindow.show();
      startupWindow.focus();
      return;
    }
    startupWindow = new BrowserWindow({
      width: 560,
      height: 560,
      resizable: false,
      show: false,
      backgroundColor: '#090C10',
      title: 'ARTEL',
      icon: iconPath,
      webPreferences: { ...hardenedPreferences, preload: path.join(here, 'preload.cjs') },
    });
    startupWindow.setMenuBarVisibility(false);
    startupWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    startupWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    startupWindow.once('ready-to-show', () => startupWindow?.show());
    startupWindow.on('closed', () => {
      startupWindow = undefined;
    });
    void startupWindow.loadFile(path.join(here, '..', 'static', 'startup.html'));
  }

  const networkService = new NetworkSettingsService({
    supervisor,
    dataDir,
    controller,
    machineName: os.hostname(),
    onSaved: (settings) => {
      publicUrl = settings.publicUrl;
    },
  });
  // Paths the renderer may send back: the ones in the saved settings and the ones it picked.
  const allowedPaths = new Set<string>();

  function openNetworkWindow(): void {
    if (networkWindow !== undefined && !networkWindow.isDestroyed()) {
      networkWindow.show();
      networkWindow.focus();
      return;
    }
    networkWindow = new BrowserWindow({
      width: 600,
      height: 760,
      minWidth: 480,
      minHeight: 560,
      show: false,
      backgroundColor: '#090C10',
      title: 'ARTEL',
      icon: iconPath,
      webPreferences: { ...hardenedPreferences, preload: path.join(here, 'network-preload.cjs') },
    });
    networkWindow.setMenuBarVisibility(false);
    networkWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    networkWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    networkWindow.once('ready-to-show', () => networkWindow?.show());
    networkWindow.on('closed', () => {
      networkWindow = undefined;
    });
    void networkWindow.loadFile(path.join(here, '..', 'static', 'network.html'));
  }

  function fromNetworkWindow(event: Electron.IpcMainInvokeEvent): boolean {
    return (
      networkWindow !== undefined &&
      !networkWindow.isDestroyed() &&
      event.sender === networkWindow.webContents
    );
  }

  function rememberPaths(draft: { certFile: string | null; keyFile: string | null }): void {
    for (const file of [draft.certFile, draft.keyFile]) if (file !== null) allowedPaths.add(file);
  }

  function openExternal(target: string): void {
    void shell.openExternal(target);
  }

  function showConsole(url: string): void {
    appOrigins = allowedOrigins(url, publicUrl);
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      void mainWindow.loadURL(url);
      mainWindow.show();
      return;
    }
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 640,
      show: false,
      backgroundColor: '#090C10',
      title: 'ARTEL',
      icon: iconPath,
      webPreferences: hardenedPreferences,
    });
    const contents = mainWindow.webContents;
    const guard = (event: { preventDefault(): void }, target: string): void => {
      const decision = decideNavigationAmong(target, appOrigins);
      if (decision === 'allow') return;
      event.preventDefault();
      if (decision === 'open-external') openExternal(target);
    };
    contents.on('will-navigate', (event) => guard(event, event.url));
    contents.on('will-redirect', (event) => guard(event, event.url));
    contents.setWindowOpenHandler(({ url: target }) => {
      if (decideWindowOpen(target) === 'open-external') openExternal(target);
      return { action: 'deny' };
    });
    mainWindow.once('ready-to-show', () => {
      mainWindow?.show();
      startupWindow?.close();
    });
    // Closing the window keeps the app in the tray.
    mainWindow.on('close', (event) => {
      if (quitting) return;
      event.preventDefault();
      mainWindow?.hide();
    });
    void mainWindow.loadURL(url);
  }

  function focusExisting(): void {
    const window =
      mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : startupWindow;
    if (window === undefined || window.isDestroyed()) {
      openStartupWindow();
      return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  function openConsole(): void {
    if (controller.state.phase === 'ready') {
      focusExisting();
    } else {
      openStartupWindow();
      if (controller.state.phase !== 'starting') void controller.start();
    }
  }

  const linkEnv = (): LinkEnv => ({
    platform: process.platform,
    resourcesPath: process.resourcesPath,
    homeDir: os.homedir(),
    appImage: process.env['APPIMAGE'],
    pathEnv: process.env['PATH'] ?? '',
  });

  async function installCliLink(): Promise<void> {
    const plan = planFor(linkEnv());
    if (plan.kind === 'none') return;
    try {
      await applyCliLink(plan);
      const hint =
        plan.needsPathHint === true
          ? `\n\nAdd ${path.dirname(plan.linkPath ?? '')} to your PATH.`
          : '';
      await dialog.showMessageBox({
        type: 'info',
        message: 'The artel command is installed.',
        detail: `${plan.linkPath ?? ''}${hint}`,
      });
    } catch (error) {
      await dialog.showMessageBox({
        type: 'error',
        message: 'Could not install the artel command.',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function offerCliLinkOnFirstRun(): Promise<void> {
    const plan = planFor(linkEnv());
    if (plan.kind === 'none') return;
    const marker = path.join(app.getPath('userData'), 'cli-link-offered');
    try {
      await fs.access(marker);
      return;
    } catch {
      // Not offered yet.
    }
    await fs.mkdir(path.dirname(marker), { recursive: true });
    await fs.writeFile(marker, new Date().toISOString());
    if (await isLinked(plan)) return;
    const { response } = await dialog.showMessageBox({
      type: 'question',
      message: 'Install the artel command?',
      detail: `Lets you run artel in a terminal. This creates ${plan.linkPath ?? ''}.`,
      buttons: ['Install', 'Not now'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) await installCliLink();
  }

  function applicationMenu(): void {
    const canLink = planFor(linkEnv()).kind !== 'none';
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'ARTEL',
        submenu: [
          ...(canLink
            ? [{ label: 'Install the artel command…', click: () => void installCliLink() }]
            : []),
          { label: networkLabel(), click: openNetworkWindow },
          updateMenuItem(),
          { label: 'Open log folder', click: () => void shell.openPath(controller.logDir()) },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  function refreshTray(): void {
    if (tray === undefined) return;
    const running = controller.state.phase === 'ready' || controller.state.phase === 'starting';
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open ARTEL', click: openConsole },
        { label: networkLabel(), click: openNetworkWindow },
        updateMenuItem(),
        { label: 'Stop stack', enabled: running, click: () => void controller.stop() },
        { label: 'Open log folder', click: () => void shell.openPath(controller.logDir()) },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ]),
    );
  }

  const networkLabel = (): string =>
    app.getLocale().toLowerCase().startsWith('ko') ? '네트워크 공유' : 'Network sharing';

  ipcMain.handle('artel:network:get', async (event) => {
    if (!fromNetworkWindow(event)) throw new Error('Untrusted sender');
    const view = await networkService.view();
    rememberPaths(view.draft);
    return view;
  });
  ipcMain.handle('artel:network:evaluate', (event, payload: unknown) => {
    if (!fromNetworkWindow(event)) throw new Error('Untrusted sender');
    const parsed = parseNetworkDraft(payload, allowedPaths);
    return parsed.ok ? networkService.evaluate(parsed.draft) : null;
  });
  ipcMain.handle('artel:network:save', async (event, payload: unknown) => {
    if (!fromNetworkWindow(event)) throw new Error('Untrusted sender');
    const parsed = parseNetworkDraft(payload, allowedPaths);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    return networkService.save(parsed.draft);
  });
  ipcMain.handle('artel:network:pick-file', async (event, kind: unknown) => {
    if (!fromNetworkWindow(event) || networkWindow === undefined)
      throw new Error('Untrusted sender');
    if (kind !== 'certificate' && kind !== 'key') throw new Error('Unknown file kind');
    const result = await dialog.showOpenDialog(networkWindow, {
      properties: ['openFile'],
      filters:
        kind === 'certificate'
          ? [{ name: 'Certificate', extensions: ['pem', 'crt', 'cer'] }]
          : [{ name: 'Private key', extensions: ['pem', 'key'] }],
    });
    const chosen = result.filePaths[0];
    if (result.canceled || chosen === undefined) return null;
    allowedPaths.add(chosen);
    return chosen;
  });
  ipcMain.handle('artel:network:copy-access-url', async (event) => {
    if (!fromNetworkWindow(event)) throw new Error('Untrusted sender');
    const view = await networkService.view();
    await clipboard.writeText(view.accessUrl);
    return true;
  });
  ipcMain.handle('artel:get-state', () => controller.state);
  ipcMain.on('artel:retry', () => void controller.start());
  ipcMain.on('artel:open-logs', () => void shell.openPath(controller.logDir()));

  app.on('second-instance', focusExisting);
  app.on('window-all-closed', () => {
    // Stay in the tray.
  });
  app.on('activate', focusExisting);
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    if (updates?.phase === 'installing') return;
    quitting = true;
    void controller.quit().finally(() => app.quit());
  });

  await app.whenReady();
  applicationMenu();
  tray = new Tray(nativeImage.createFromPath(trayIconPath).resize({ width: 18, height: 18 }));
  tray.setToolTip('ARTEL');
  tray.on('click', openConsole);
  refreshTray();
  openStartupWindow();
  void supervisor.readStackSettings().then(
    (settings) => {
      publicUrl ??= settings.publicUrl;
    },
    () => undefined,
  );
  void controller.start();
  void offerCliLinkOnFirstRun();
  void initializeUpdates().catch(() => undefined);
}

function readSigned(): boolean {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'),
    ) as { artelSigned?: boolean };
    return manifest.artelSigned === true;
  } catch {
    return false;
  }
}
