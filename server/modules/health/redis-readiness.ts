import { randomUUID } from 'node:crypto';
import type { ReadinessProbe } from '../../core/readiness';

/** Operations supplied by an admitted profile binding or the ordinary probe client. */
export interface RedisReadinessOperations {
  assertCurrent(): void;
  setExpiring(key: string, value: string, ttlMs: number): Promise<void>;
  get(key: string): Promise<string | null>;
  deleteKey(key: string): Promise<number>;
}

export function createRedisReadinessProbe(operations: RedisReadinessOperations): ReadinessProbe {
  return async (signal) => {
    const check = () => {
      if (signal.aborted) throw new Error('REDIS_READINESS_REFUSED');
      operations.assertCurrent();
    };
    check();
    const value = randomUUID(), key = `health:readiness:${value}`;
    await operations.setExpiring(key, value, 5000); check();
    const observed = await operations.get(key); check();
    if (observed !== value) throw new Error('REDIS_READINESS_REFUSED');
    const deleted = await operations.deleteKey(key); check();
    if (deleted !== 1) throw new Error('REDIS_READINESS_REFUSED');
  };
}
