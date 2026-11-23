import { prepareTestEnvironment } from './test-target.mjs';
import { installNetworkGuard } from './network-guard.mjs';
import { installPostgresGuard } from './postgres-guard.mjs';
import { verifyBrowserTarget } from './browser-target.mjs';

/** Install both guards synchronously before the first await or application import. */
export async function prepareBrowserClient(baseURL, env = process.env) {
  const environment = prepareTestEnvironment(env);
  if (environment.mode !== 'database' || !environment.target?.server || baseURL !== environment.target.server.origin) {
    throw new Error('E2E setup requires the exact manifest database and owned server origin');
  }
  // The bootstrap HTTP request reads identity only. No fixture operation is
  // released until both DB and HTTP identity verification complete below.
  installNetworkGuard({ ...environment, browserOrigin: baseURL });
  const guarded = installPostgresGuard(environment);
  await guarded;
  return verifyBrowserTarget(baseURL, env);
}
