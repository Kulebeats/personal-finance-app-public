import type { TestTarget, TargetEnvironment } from './test-target.mjs';
export function verifyBrowserTarget(baseURL: string, env?: NodeJS.ProcessEnv, dependencies?: {
  verifyDatabase?: (env: NodeJS.ProcessEnv) => Promise<TestTarget>;
  fetch?: typeof globalThis.fetch;
}): Promise<TestTarget>;
