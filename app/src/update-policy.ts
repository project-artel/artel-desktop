export interface UpdatePolicyInput {
  packaged: boolean;
  /** Written into package.json by electron-builder when signing credentials were present. */
  signed: boolean;
  env: Record<string, string | undefined>;
}

/** Update checks run only in a packaged, signed build, and can be switched off by `ARTEL_DISABLE_UPDATES`. */
export function shouldCheckForUpdates(input: UpdatePolicyInput): boolean {
  if (!input.packaged || !input.signed) return false;
  const off = input.env['ARTEL_DISABLE_UPDATES'];
  return off === undefined || off === '' || off === '0' || off === 'false';
}
