import path from 'node:path';

export interface RuntimeDirInput {
  packaged: boolean;
  resourcesPath: string;
  env: Record<string, string | undefined>;
}

/**
 * Packaged apps carry the runtime bundle in `resources/runtime`. In development the
 * directory comes from `ARTEL_RUNTIME_DIR`; undefined lets the supervisor use its own default.
 */
export function resolveRuntimeDir(input: RuntimeDirInput): string | undefined {
  if (input.packaged) return path.join(input.resourcesPath, 'runtime');
  const fromEnv = input.env['ARTEL_RUNTIME_DIR'];
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : undefined;
}
