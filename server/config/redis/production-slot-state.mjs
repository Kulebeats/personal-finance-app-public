import { requireProductionRedis, onProductionRedisRevoked } from './production.mjs';

let phase = 'never-installed', admission, unsubscribe;
const refused = () => new Error('REDIS_SLOT_REFUSED');
const terminate = () => {
  phase = 'revoked'; admission = undefined;
  const detach = unsubscribe; unsubscribe = undefined; detach?.();
};

/** Private shared cell. The parent loader excludes direct app/package imports. */
export function readInstalledProductionRedis() {
  if (phase === 'never-installed') return null;
  if (phase !== 'installed') throw refused();
  try { return requireProductionRedis(admission); }
  catch { terminate(); throw refused(); }
}

/** Only a genuine factory admission can install; attempted installation is one-shot. */
export function installInPrivateProductionRedisCell(value) {
  if (phase !== 'never-installed') throw refused();
  phase = 'revoked';
  let lost = false;
  try {
    requireProductionRedis(value);
    const detach = onProductionRedisRevoked(value, () => { lost = true; terminate(); });
    unsubscribe = detach;
    requireProductionRedis(value);
    if (lost) throw refused();
    admission = value; phase = 'installed';
  } catch {
    terminate(); throw refused();
  }
}
