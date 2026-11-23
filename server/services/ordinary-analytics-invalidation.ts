import type Redis from 'ioredis';
import { deleteByPatterns } from '../config/redis/invalidation.mjs';
import { analyticsLogicalPatterns, analyticsLogicalKeyMatches, type AnalyticsInvalidation } from '../config/redis/keys.mjs';

/** Only this optional ordinary backend converts failures to this error. */
export class OrdinaryAnalyticsInvalidationError extends Error {
  constructor(readonly cause: unknown) {
    super('Optional analytics Redis invalidation failed');
    this.name = 'OrdinaryAnalyticsInvalidationError';
  }
}

/** Own a finite connection; never queue or replay deletes on the shared BullMQ client. */
export async function invalidateOrdinaryAnalytics(parent: Redis, filter: AnalyticsInvalidation): Promise<number> {
  let client: Redis | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current = true;
  const assertCurrent = () => { if (!current) throw new Error('Ordinary analytics invalidation deadline exceeded'); };
  try {
    client = parent.duplicate({
      lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0,
      connectTimeout: 400, commandTimeout: 400, retryStrategy: () => null,
      reconnectOnError: () => false, autoResendUnfulfilledCommands: false,
    });
    const connection = client;
    connection.on('error', () => {}); // The rejected connect/command is the outcome.
    const work = (async () => {
      await connection.connect(); assertCurrent();
      return deleteByPatterns({
        assertCurrent,
        validateKey(key) { if (!key.startsWith('analytics:')) throw new Error('REDIS_INVALIDATION_REFUSED'); analyticsLogicalKeyMatches(key, filter); },
        includeKey: key => analyticsLogicalKeyMatches(key, filter),
        scan: (cursor, pattern, count) => connection.scan(cursor, 'MATCH', pattern, 'COUNT', count),
        deleteBatch: keys => connection.del(...keys),
      }, analyticsLogicalPatterns(filter));
    })();
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { current = false; reject(new Error('Ordinary analytics invalidation deadline exceeded')); }, 1000);
    });
    // Promise.race observes late rejection too; binding fences prohibit later commands/results.
    return await Promise.race([work, deadline]);
  } catch (cause) {
    throw new OrdinaryAnalyticsInvalidationError(cause);
  } finally {
    current = false;
    clearTimeout(timer);
    client?.disconnect();
  }
}
