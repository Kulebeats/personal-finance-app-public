import type { TestTarget } from './test-target.mjs';
export function installPostgresGuard(environment: { mode: 'unit' | 'database'; target?: TestTarget }): Promise<void>;
