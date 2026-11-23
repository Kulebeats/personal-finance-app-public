import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ store: {
  assertCurrent: vi.fn(), getAsync: vi.fn(), setAsync: vi.fn(), deleteAsync: vi.fn(), deletePatternAsync: vi.fn(),
  delete: vi.fn(), deletePattern: vi.fn(),
} }));
vi.mock('../store', () => ({ cacheStore: mocks.store }));
import { withCache, invalidatePrefix, invalidateTag, invalidateTags } from '../withCache';

beforeEach(() => {
  vi.resetAllMocks(); mocks.store.getAsync.mockResolvedValue(undefined);
  mocks.store.setAsync.mockResolvedValue(undefined); mocks.store.deleteAsync.mockResolvedValue(true);
});
describe('actual cache higher-order functions await and fence required work', () => {
  it('prefix invalidation returns only the awaited remote confirmation', async () => {
    let release: ((count: number) => void) | undefined;
    mocks.store.deletePatternAsync.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = invalidatePrefix('reports');
    expect(pending).toBeInstanceOf(Promise); expect(mocks.store.deletePattern).not.toHaveBeenCalled();
    release?.(3); await expect(pending).resolves.toBe(3);
  });
  it('prefix errors reject instead of returning a local count', async () => {
    mocks.store.deletePatternAsync.mockRejectedValue(new Error('remote failed'));
    await expect(invalidatePrefix('reports')).rejects.toThrow('remote failed');
    expect(mocks.store.deletePattern).not.toHaveBeenCalled();
  });
  it('tag invalidation awaits actual deletes before clearing membership and reports confirmed count', async () => {
    await withCache(async () => 'value', 'report', { keyGenerator: () => 'report:key', tags: ['required-test-tag'] })();
    let release: ((deleted: boolean) => void) | undefined;
    mocks.store.deleteAsync.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = invalidateTag('required-test-tag'); expect(pending).toBeInstanceOf(Promise);
    expect(mocks.store.delete).not.toHaveBeenCalled(); release?.(true); await expect(pending).resolves.toBe(1);
    await expect(invalidateTag('required-test-tag')).resolves.toBe(0);
  });
  it('a tag registration made during deletion is retained for the next invalidation', async () => {
    const cached = withCache(async () => 'value', 'report', { keyGenerator: () => 'report:concurrent', tags: ['required-concurrent-tag'] });
    await cached();
    let release: ((deleted: boolean) => void) | undefined;
    mocks.store.deleteAsync.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = invalidateTag('required-concurrent-tag'); await cached(); release?.(true);
    await expect(pending).resolves.toBe(1);
    await expect(invalidateTag('required-concurrent-tag')).resolves.toBe(1);
    await expect(invalidateTag('required-concurrent-tag')).resolves.toBe(0);
  });
  it('a failed tag delete preserves membership and its rejection reaches an awaited caller', async () => {
    await withCache(async () => 'value', 'report', { keyGenerator: () => 'report:retry', tags: ['required-failed-tag'] })();
    mocks.store.deleteAsync.mockRejectedValueOnce(new Error('delete refused'));
    await expect(invalidateTags(['required-failed-tag'])).rejects.toThrow('delete refused');
    await expect(invalidateTag('required-failed-tag')).resolves.toBe(1);
  });
  it('revocation after a cache read blocks a protected compute callback', async () => {
    let current = true;
    mocks.store.assertCurrent.mockImplementation(() => { if (!current) throw new Error('revoked'); });
    mocks.store.getAsync.mockImplementation(async () => { current = false; return undefined; });
    const compute = vi.fn(async () => 'must not run');
    await expect(withCache(compute, 'report')()).rejects.toThrow('revoked'); expect(compute).not.toHaveBeenCalled();
  });
  it('revocation during compute prevents set and success', async () => {
    let current = true;
    mocks.store.assertCurrent.mockImplementation(() => { if (!current) throw new Error('revoked'); });
    const compute = vi.fn(async () => { current = false; return 'late'; });
    await expect(withCache(compute, 'report')()).rejects.toThrow('revoked'); expect(mocks.store.setAsync).not.toHaveBeenCalled();
  });
  it('skip-cache still fences before and after a required compute callback', async () => {
    let current = false;
    mocks.store.assertCurrent.mockImplementation(() => { if (!current) throw new Error('revoked'); });
    const compute = vi.fn(async () => { current = false; return 'late'; });
    const cached = withCache(compute, 'report', { skipCache: () => true });
    await expect(cached()).rejects.toThrow('revoked'); expect(compute).not.toHaveBeenCalled();
    current = true; await expect(cached()).rejects.toThrow('revoked'); expect(compute).toHaveBeenCalledOnce();
  });
});
