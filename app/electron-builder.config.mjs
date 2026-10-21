// Signing and notarization are driven by environment variables and skipped when absent.
//   macOS:   CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
//   Windows: WIN_CSC_LINK, WIN_CSC_KEY_PASSWORD
// Runtime bundle: ARTEL_RUNTIME_SOURCE overrides the directory copied into resources/runtime.

import { validateRuntime } from './scripts/validate-runtime.mjs';

const macSigned = Boolean(process.env.CSC_LINK);
const winSigned = Boolean(process.env.WIN_CSC_LINK || process.env.CSC_LINK);
const notarize =
  macSigned &&
  Boolean(
    process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID,
  );
const signed = macSigned || winSigned;

/** @type {import('electron-builder').Configuration} */
export default {
  appId: 'kr.artel.desktop',
  productName: 'ARTEL',
  beforePack: async (context) => {
    // Nsis7z cannot decode the ARM64 filter selected by newer 7za versions.
    // https://github.com/electron-userland/electron-builder/issues/9983
    if (context.electronPlatformName === 'win32') {
      process.env.ELECTRON_BUILDER_7Z_FILTER = 'BCJ';
    }
    const arch = { 1: 'x64', 3: 'arm64' }[context.arch];
    const target = `${context.electronPlatformName}-${arch}`;
    await validateRuntime(
      process.env.ARTEL_RUNTIME_SOURCE ?? `../runtime/build/unpacked/${target}`,
      target,
    );
  },
  copyright: 'ARTEL',
  directories: { output: 'release', buildResources: 'assets' },
  files: ['dist/**', 'static/**', 'assets/**', 'package.json'],
  // The bundled CLI runs under ELECTRON_RUN_AS_NODE from resources/app.asar.unpacked, and Node
  // there resolves its dependencies next to it, so every dependency is unpacked, not only the CLI.
  asarUnpack: ['node_modules/**'],
  extraMetadata: { artelSigned: signed },
  extraResources: [{ from: 'build/bin', to: 'bin', filter: ['artel', 'artel.cmd'] }],
  publish: [{ provider: 'github', owner: 'project-artel', repo: 'artel-desktop' }],
  mac: {
    artifactName: 'ARTEL-${version}-macOS-${arch}.${ext}',
    category: 'public.app-category.developer-tools',
    target: ['dmg', 'zip'],
    extraResources: [
      {
        from: process.env.ARTEL_RUNTIME_SOURCE ?? '../runtime/build/unpacked/darwin-${arch}',
        to: 'runtime',
      },
    ],
    hardenedRuntime: macSigned,
    gatekeeperAssess: false,
    identity: macSigned ? undefined : null,
    notarize,
  },
  win: {
    executableName: 'artel',
    artifactName: 'ARTEL-Setup-${version}-${arch}.${ext}',
    target: ['nsis'],
    extraResources: [
      {
        from: process.env.ARTEL_RUNTIME_SOURCE ?? '../runtime/build/unpacked/win32-${arch}',
        to: 'runtime',
      },
    ],
    signExecutable: winSigned,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'ARTEL',
    runAfterFinish: true,
    include: 'installer/installer.nsh',
  },
  linux: {
    artifactName: 'ARTEL-${version}-Linux-${arch}.${ext}',
    category: 'Development',
    executableName: 'artel-desktop',
    target: ['AppImage', 'deb'],
    extraResources: [
      {
        from: process.env.ARTEL_RUNTIME_SOURCE ?? '../runtime/build/unpacked/linux-${arch}',
        to: 'runtime',
      },
    ],
  },
  deb: {
    afterInstall: 'installer/deb-after-install.sh',
    afterRemove: 'installer/deb-after-remove.sh',
  },
};
