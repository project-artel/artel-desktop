export interface UpdatePolicyInput {
  packaged: boolean;
  /** Written into package.json by electron-builder when signing credentials were present. */
  signed: boolean;
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
}

/** macOS는 서명된 앱, Linux는 AppImage에서 앱 내 업데이트를 지원한다. */
export function shouldCheckForUpdates(input: UpdatePolicyInput): boolean {
  if (!input.packaged) return false;
  if (input.platform === 'darwin' && !input.signed) return false;
  if (input.platform === 'linux' && !input.env['APPIMAGE']) return false;
  if (!['win32', 'darwin', 'linux'].includes(input.platform)) return false;
  const off = input.env['ARTEL_DISABLE_UPDATES'];
  return off === undefined || off === '' || off === '0' || off === 'false';
}
