import { prepareTestEnvironment, verifyDatabaseTarget } from './test-target.mjs';

/** Must complete before registration/login reset or any other browser fixture writes. */
export async function verifyBrowserTarget(baseURL, env = process.env, dependencies = {}) {
  const environment = prepareTestEnvironment(env);
  const target = environment.target;
  if (environment.mode !== 'database' || !target?.server || baseURL !== target.server.origin) {
    throw new Error('E2E setup requires the exact manifest database and owned server origin');
  }
  await (dependencies.verifyDatabase ?? verifyDatabaseTarget)(env);
  const response = await (dependencies.fetch ?? globalThis.fetch)(`${baseURL}/__test/identity`, { redirect: 'error' });
  const identity = await response.json();
  if (!response.ok || identity.runId !== target.runId || identity.database !== target.database || identity.origin !== baseURL) {
    throw new Error('E2E server run/database marker mismatch; fixture writes refused');
  }
  return target;
}
