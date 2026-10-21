import * as supervisor from '@project-artel/cli/supervisor';
import type { SupervisorApi } from './supervisor-types.js';

export function loadSupervisor(): Promise<SupervisorApi> {
  return Promise.resolve(supervisor);
}
