import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyCliLink, isLinked, planFor, type LinkEnv } from './cli-link.js';
import { cliArgsFromArgv } from './cli-shim.js';
import { StackController } from './lifecycle.js';
import { resolveRuntimeDir } from './runtime-dir.js';
import { loadSupervisor } from './supervisor.js';
import { shouldCheckForUpdates } from './update-policy.js';
import { decideNavigation, decideWindowOpen } from './url-policy.js';

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
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  const controller = new StackController({
    supervisor: await loadSupervisor(),
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
  let mainWindow: BrowserWindow | undefined;
  // Assigned after the app is ready, but read earlier by refreshTray.
  // eslint-disable-next-line prefer-const
  let tray: Tray | undefined;
  let quitting = false;

  const iconPath = path.join(here, '..', 'assets', 'icon.png');

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

  function openExternal(target: string): void {
    void shell.openExternal(target);
  }

  function showConsole(url: string): void {
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      void mainWindow.loadURL(url);
      mainWindow.show();
      return;
    }
    const origin = new URL(url).origin;
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
      const decision = decideNavigation(target, origin);
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
        { label: 'Stop stack', enabled: running, click: () => void controller.stop() },
        { label: 'Open log folder', click: () => void shell.openPath(controller.logDir()) },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ]),
    );
  }

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
    quitting = true;
    void controller.quit().finally(() => app.quit());
  });

  await app.whenReady();
  applicationMenu();
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 }));
  tray.setToolTip('ARTEL');
  tray.on('click', openConsole);
  refreshTray();
  openStartupWindow();
  void controller.start();
  void offerCliLinkOnFirstRun();
  void checkForUpdates();
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

async function checkForUpdates(): Promise<void> {
  if (
    !shouldCheckForUpdates({ packaged: app.isPackaged, signed: readSigned(), env: process.env })
  ) {
    return;
  }
  const { autoUpdater } = await import('electron-updater');
  await autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
}
