import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { AnalyticsCacheBackend } from '../analytics-cache-backend';

const redisMock = vi.hoisted(() => ({ get: vi.fn(), setex: vi.fn(), scan: vi.fn(), del: vi.fn(), scanStream: vi.fn(), pipeline: vi.fn(), duplicate: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), on: vi.fn() }));
vi.mock('../../config/redis', () => ({ redis: redisMock, productionRedis: null }));
import { AnalyticsCache } from '../AnalyticsCache';

const legacy = 'analytics:dashboard:household-1:v1:abcdef123456';
const current = 'analytics:dashboard:household-1:user-7:v1:abcdef123456';
const other = 'analytics:dashboard:other-household:household-1:v1:abcdef123456';
beforeEach(() => {
  vi.clearAllMocks(); redisMock.get.mockResolvedValue(null); redisMock.setex.mockResolvedValue('OK');
  redisMock.scan.mockResolvedValue(['0', [legacy, current, other]]); redisMock.del.mockResolvedValue(2);
  redisMock.duplicate.mockReturnValue(redisMock); redisMock.connect.mockResolvedValue(undefined);
  redisMock.scanStream.mockReturnValue(new EventEmitter()); redisMock.pipeline.mockReturnValue({ del: vi.fn(), exec: vi.fn().mockResolvedValue([]) });
});

function useInMemoryRedis() {
  const entries = new Map<string, string>();
  redisMock.get.mockImplementation(async (key: string) => entries.get(key) ?? null);
  redisMock.setex.mockImplementation(async (key: string, _ttl: number, value: string) => {
    entries.set(key, value);
    return 'OK';
  });
  redisMock.scan.mockImplementation(async () => ['0', [...entries.keys()]]);
  redisMock.del.mockImplementation(async (...keys: string[]) => keys.filter(key => entries.delete(key)).length);
  return entries;
}

describe('actual AnalyticsCache invalidation completion', () => {
  it.each(['household', 'endpoint'] as const)('%s invalidation waits for confirmed deletes and excludes an overmatching other household', async scope => {
    let release: ((count: number) => void) | undefined;
    redisMock.del.mockImplementation(() => new Promise<number>(resolve => { release = resolve; }));
    const cache = new AnalyticsCache(); let settled = false;
    const pending = (scope === 'household' ? cache.invalidateHousehold('household-1') : cache.invalidateEndpoint('dashboard', 'household-1')).then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    await vi.waitFor(() => expect(redisMock.del).toHaveBeenCalledOnce());
    expect(redisMock.del.mock.calls[0]).toEqual([legacy, current]);
    release?.(2); await pending; expect(settled).toBe(true);
  });
  it('scan and delete failures reject actual invalidation instead of reporting completion', async () => {
    redisMock.scan.mockRejectedValueOnce(new Error('scan failed'));
    await expect(new AnalyticsCache().invalidateHousehold('household-1')).rejects.toMatchObject({ name: 'OrdinaryAnalyticsInvalidationError', cause: { message: 'scan failed' } });
    redisMock.del.mockRejectedValueOnce(new Error('delete failed'));
    await expect(new AnalyticsCache().invalidateEndpoint('dashboard', 'household-1')).rejects.toMatchObject({ name: 'OrdinaryAnalyticsInvalidationError', cause: { message: 'delete failed' } });
  });
  it('an injected required binding cannot turn a cache failure into a compute callback', async () => {
    const backend: AnalyticsCacheBackend = { assertCurrent() {}, getJson: async () => { throw new Error('required cache unavailable'); }, setJson: async () => {}, invalidate: async () => 0 };
    const compute = vi.fn(async () => ({ total: '1.00' }));
    await expect(new AnalyticsCache(backend).getOrCompute('dashboard', 'household-1', { userId: 'user-1' }, compute)).rejects.toThrow('required cache unavailable');
    expect(compute).not.toHaveBeenCalled();
  });
  it('revocation while compute is pending prevents cache writes and old-generation success', async () => {
    let live = true, release: ((value: { total: string }) => void) | undefined;
    const setJson = vi.fn(async () => {});
    const backend: AnalyticsCacheBackend = { assertCurrent() { if (!live) throw new Error('revoked'); }, getJson: async () => null, setJson, invalidate: async () => 0 };
    const compute = vi.fn(() => new Promise<{ total: string }>(resolve => { release = resolve; }));
    const pending = new AnalyticsCache(backend).getOrCompute('dashboard', 'household-1', { userId: 'user-1' }, compute);
    await vi.waitFor(() => expect(compute).toHaveBeenCalledOnce()); live = false; release?.({ total: '1.00' });
    await expect(pending).rejects.toThrow('revoked'); expect(setJson).not.toHaveBeenCalled();
  });
  it('ordinary read/set errors retain optional cache fallback', async () => {
    redisMock.get.mockRejectedValueOnce(new Error('optional get failed')); redisMock.setex.mockRejectedValueOnce(new Error('optional set failed'));
    const compute = vi.fn(async () => ({ total: '1.00' }));
    await expect(new AnalyticsCache().getOrCompute('dashboard', 'household-1', { userId: 'user-1' }, compute)).resolves.toMatchObject({ total: '1.00' });
    expect(compute).toHaveBeenCalledOnce();
  });

  it('does not reuse net-worth changes computed before an account visibility change', async () => {
    const entries = useInMemoryRedis();
    const cache = new AnalyticsCache();
    const params = { userId: 'viewer', from: '2026-01-01', to: '2026-02-28' };
    const computationStarted = Promise.withResolvers<void>();
    const finishComputation = Promise.withResolvers<void>();
    let currentTotal = '550.00';
    const compute = vi.fn(async () => {
      const endNetWorth = currentTotal;
      computationStarted.resolve();
      await finishComputation.promise;
      return { periods: [{ endNetWorth }] };
    });

    const earlier = cache.getOrCompute('netWorthChanges', 'household-1', params, compute);
    await computationStarted.promise;
    currentTotal = '100.00';
    await cache.invalidateEndpoint('netWorthChanges', 'household-1');
    finishComputation.resolve();
    await expect(earlier).resolves.toMatchObject({ periods: [{ endNetWorth: '550.00' }] });

    await expect(cache.getOrCompute('netWorthChanges', 'household-1', params, compute))
      .resolves.toMatchObject({ periods: [{ endNetWorth: '100.00' }] });
    expect(compute).toHaveBeenCalledTimes(2);
    expect(redisMock.get).not.toHaveBeenCalled();
    expect(redisMock.setex).not.toHaveBeenCalled();
    expect(entries.size).toBe(0);
  });

  it('continues to read and populate the ordinary cache for unrelated dashboard results', async () => {
    const entries = useInMemoryRedis();
    const cache = new AnalyticsCache();
    const params = { userId: 'viewer' };
    const compute = vi.fn(async () => ({ amount: '100.00' }));

    const first = await cache.getOrCompute('dashboard', 'household-1', params, compute);
    await cache.invalidateEndpoint('netWorthChanges', 'household-1');
    expect(await cache.getOrCompute('dashboard', 'household-1', params, compute)).toEqual(first);
    expect(compute).toHaveBeenCalledOnce();
    expect(redisMock.setex).toHaveBeenCalledOnce();
    expect(entries.size).toBe(1);
  });
});
