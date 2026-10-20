import type { StackSettings } from './supervisor-types.js';

export const LOOPBACK_HOST = '127.0.0.1';
export const SHARED_HOST = '0.0.0.0';

/** What the settings window edits. File paths are only ever the ones the user picked. */
export interface NetworkDraft {
  shared: boolean;
  port: number;
  /** Blank means "derive from host and port". */
  publicUrl: string;
  useTls: boolean;
  certFile: string | null;
  keyFile: string | null;
}

export type NetworkWarning = 'plain-text';

export type ParseResult = { ok: true; draft: NetworkDraft } | { ok: false; error: string };

const MAX_URL_LENGTH = 2048;
const MAX_PATH_LENGTH = 4096;

export function draftFromSettings(settings: StackSettings): NetworkDraft {
  return {
    shared: settings.host !== LOOPBACK_HOST && settings.host !== 'localhost',
    port: settings.port,
    publicUrl: settings.publicUrl,
    useTls: settings.tls !== null,
    certFile: settings.tls?.certFile ?? null,
    keyFile: settings.tls?.keyFile ?? null,
  };
}

/** The address derived from host, port and TLS when the user leaves the public URL blank. */
export function defaultPublicUrl(
  draft: Pick<NetworkDraft, 'shared' | 'port' | 'useTls'>,
  machineName: string,
): string {
  const scheme = draft.useTls ? 'https' : 'http';
  const host = draft.shared && machineName !== '' ? machineName : LOOPBACK_HOST;
  return `${scheme}://${host}:${String(draft.port)}`;
}

export function effectivePublicUrl(draft: NetworkDraft, machineName: string): string {
  const typed = draft.publicUrl.trim();
  return typed === '' ? defaultPublicUrl(draft, machineName) : typed;
}

/** Sharing over http sends passwords and session cookies in plain text. */
export function plainTextWarning(
  draft: Pick<NetworkDraft, 'shared' | 'publicUrl'>,
  fallbackPublicUrl: string,
): NetworkWarning | null {
  if (!draft.shared) return null;
  const typed = draft.publicUrl.trim();
  const target = typed === '' ? fallbackPublicUrl : typed;
  try {
    return new URL(target).protocol === 'http:' ? 'plain-text' : null;
  } catch {
    return null;
  }
}

export function toSettingsChanges(draft: NetworkDraft, machineName: string): StackSettings {
  const tls =
    draft.useTls && draft.certFile !== null && draft.keyFile !== null
      ? { certFile: draft.certFile, keyFile: draft.keyFile }
      : null;
  return {
    host: draft.shared ? SHARED_HOST : LOOPBACK_HOST,
    port: draft.port,
    publicUrl: effectivePublicUrl(draft, machineName),
    tls,
  };
}

function pathOrNull(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): string | null | Error {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LENGTH) {
    return new Error(`${label} must be a file path or null`);
  }
  if (value.includes('\0')) return new Error(`${label} contains a NUL character`);
  if (!allowed.has(value)) return new Error(`${label} was not chosen with the file picker`);
  return value;
}

/**
 * Checks an untrusted renderer payload. The shape is strict; deeper validation
 * (port range, URL scheme, readable files) belongs to the supervisor and is shown inline.
 * File paths are accepted only when they came from the picker or the saved settings.
 */
export function parseNetworkDraft(
  payload: unknown,
  allowedPaths: ReadonlySet<string>,
): ParseResult {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, error: 'payload must be an object' };
  }
  const record = payload as Record<string, unknown>;
  const expected = ['shared', 'port', 'publicUrl', 'useTls', 'certFile', 'keyFile'];
  const keys = Object.keys(record);
  if (keys.length !== expected.length || !expected.every((key) => keys.includes(key))) {
    return { ok: false, error: 'payload has unexpected fields' };
  }
  const { shared, port, publicUrl, useTls } = record;
  if (typeof shared !== 'boolean') return { ok: false, error: 'shared must be a boolean' };
  if (typeof useTls !== 'boolean') return { ok: false, error: 'useTls must be a boolean' };
  if (typeof port !== 'number' || !Number.isInteger(port)) {
    return { ok: false, error: 'port must be an integer' };
  }
  if (typeof publicUrl !== 'string' || publicUrl.length > MAX_URL_LENGTH) {
    return { ok: false, error: 'publicUrl must be a string of at most 2048 characters' };
  }
  const certFile = pathOrNull(record['certFile'], allowedPaths, 'certFile');
  if (certFile instanceof Error) return { ok: false, error: certFile.message };
  const keyFile = pathOrNull(record['keyFile'], allowedPaths, 'keyFile');
  if (keyFile instanceof Error) return { ok: false, error: keyFile.message };
  return { ok: true, draft: { shared, port, publicUrl, useTls, certFile, keyFile } };
}
