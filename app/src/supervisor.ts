// The only module that names `@project-artel/cli/supervisor`.
//
// The published package does not export it yet (ARTEL-1144), so the specifier is
// kept in a variable and the result is typed by the local stand-in. To switch:
//   1. delete `supervisor-types.ts`,
//   2. replace the body below with
//        import * as supervisor from '@project-artel/cli/supervisor';
//        export const loadSupervisor = (): Promise<SupervisorApi> => Promise.resolve(supervisor);
//      and import the types from '@project-artel/cli/supervisor' in the other files.
import type { SupervisorApi } from './supervisor-types.js';

const SUPERVISOR_SPECIFIER = '@project-artel/cli/supervisor';

export async function loadSupervisor(): Promise<SupervisorApi> {
  return (await import(SUPERVISOR_SPECIFIER)) as SupervisorApi;
}
