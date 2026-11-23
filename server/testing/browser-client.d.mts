import type { TestTarget } from './test-target.mjs';
export function prepareBrowserClient(baseURL: string, env?: NodeJS.ProcessEnv): Promise<TestTarget>;
