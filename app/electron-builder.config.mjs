// Signing and notarization are driven by environment variables and skipped when absent.
//   macOS:   CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
//   Windows: WIN_CSC_LINK, WIN_CSC_KEY_PASSWORD
// Runtime bundle: ARTEL_RUNTIME_SOURCE overrides the directory copied into resources/runtime.

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
    category: 'public.app-category.developer-tools',
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
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
    target: [{ target: 'nsis', arch: ['x64', 'arm64'] }],
    extraResources: [
      {
        from: process.env.ARTEL_RUNTIME_SOURCE ?? '../runtime/build/unpacked/win32-${arch}',
        to: 'runtime',
      },
    ],
    signAndEditExecutable: winSigned,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    include: 'installer/installer.nsh',
  },
  linux: {
    category: 'Development',
    executableName: 'artel-desktop',
    target: [
      { target: 'AppImage', arch: ['x64', 'arm64'] },
      { target: 'deb', arch: ['x64', 'arm64'] },
    ],
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
