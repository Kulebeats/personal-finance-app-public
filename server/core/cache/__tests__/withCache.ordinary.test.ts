import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const remote = vi.hoisted(() => ({ enabled: false, values: new Map<string, unknown>() }));
vi.mock('../store', async importOriginal => {
  const actual = await importOriginal<typeof import('../store')>();
  actual.cacheStore.destroy();
  const backend = {
    isEnabled: () => remote.enabled,
    getJson: async <T>(key: string): Promise<T | null> => remote.values.has(key) ? remote.values.get(key) as T : null,
    setJson: async <T>(key: string, value: T) => { remote.values.set(key, value); return true; },
    deleteKey: async (key: string) => remote.values.delete(key),
    deleteByPrefix: async (prefix: string) => {
      let count = 0;
      for (const key of Array.from(remote.values.keys())) if (key.startsWith(prefix)) { remote.values.delete(key); count++; }
      return count;
    },
  };
  return { ...actual, cacheStore: new actual.CacheStore({}, backend) };
});
import { cacheStore } from '../store';
import { withCache, invalidatePrefix, invalidateTag } from '../withCache';

beforeEach(() => { remote.enabled = false; remote.values.clear(); cacheStore.clear(); });
afterAll(() => { cacheStore.destroy(); });

describe('actual ordinary cache helpers preserve outage fallback invalidation', () => {
  it.each(['prefix', 'tag'] as const)('%s removes stale Map data even when recovered Redis confirms a delete', async scope => {
    const key = `reports:${scope}`, tag = `ordinary-recovery-${scope}`;
    const cached = withCache(async () => 'STALE', 'reports', { keyGenerator: () => key, tags: [tag] });
    await expect(cached()).resolves.toBe('STALE');
    await expect(cacheStore.getAsync(key)).resolves.toBe('STALE');
    remote.enabled = true; remote.values.set(`core-cache:${key}`, 'STALE');
    await expect(scope === 'prefix' ? invalidatePrefix('reports') : invalidateTag(tag)).resolves.toBe(1);
    expect(remote.values.size).toBe(0);
    remote.enabled = false;
    await expect(cacheStore.getAsync(key)).resolves.toBeUndefined();
  });
});
