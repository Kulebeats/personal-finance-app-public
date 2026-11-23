import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheStore, type CacheRedisBackend } from '../store';

let current = true;
const backend: CacheRedisBackend & { assertCurrent(): void } = {
  assertCurrent() { if (!current) throw new Error('required generation revoked'); },
  isEnabled: vi.fn(() => true), getJson: vi.fn(async () => null),
  setJson: vi.fn(async () => true), deleteKey: vi.fn(async () => false), deleteByPrefix: vi.fn(async () => 0),
};
const stores: CacheStore[] = [];
function store() { const value = new CacheStore({}, backend); stores.push(value); return value; }
beforeEach(() => {
  current = true; vi.mocked(backend.isEnabled).mockReturnValue(true);
  vi.mocked(backend.getJson).mockResolvedValue(null); vi.mocked(backend.setJson).mockResolvedValue(true);
  vi.mocked(backend.deleteKey).mockResolvedValue(false); vi.mocked(backend.deleteByPrefix).mockResolvedValue(0);
  vi.clearAllMocks();
});
afterEach(() => { stores.splice(0).forEach(value => value.destroy()); });

describe('actual CacheStore required backend semantics', () => {
  it('revocation refuses before any backend call instead of selecting local fallback', async () => {
    const cache = store(); current = false;
    await expect(cache.getAsync('x')).rejects.toThrow('required generation revoked');
    expect(backend.getJson).not.toHaveBeenCalled();
  });
  it('a required disabled sentinel cannot switch the instance to a Map', async () => {
    const cache = store(); vi.mocked(backend.isEnabled).mockReturnValue(false);
    await expect(cache.setAsync('x', 'value')).rejects.toThrow();
    expect(cache.getStats().size).toBe(0); expect(backend.setJson).not.toHaveBeenCalled();
  });
  it('required policy cannot be erased from an already constructed component', async () => {
    const mutable = { ...backend }, cache = new CacheStore({}, mutable); stores.push(cache);
    Reflect.deleteProperty(mutable, 'assertCurrent'); vi.mocked(mutable.isEnabled).mockReturnValue(false);
    await expect(cache.setAsync('x', 'value')).rejects.toThrow(); expect(cache.getStats().size).toBe(0);
  });
  it('a false SET confirmation rejects without populating a local Map', async () => {
    const cache = store(); vi.mocked(backend.setJson).mockResolvedValue(false);
    await expect(cache.setAsync('x', 'value')).rejects.toThrow(); expect(cache.getStats().size).toBe(0);
  });
  it('confirmed remote deletion absence stays false/0 without invoking local deletion', async () => {
    const cache = store(), localDelete = vi.spyOn(cache, 'delete'), localPattern = vi.spyOn(cache, 'deletePattern');
    await expect(cache.deleteAsync('x')).resolves.toBe(false);
    await expect(cache.deletePatternAsync('^reports:')).resolves.toBe(0);
    expect(localDelete).not.toHaveBeenCalled(); expect(localPattern).not.toHaveBeenCalled();
  });
  it.each(['^reports:*:suffix', '^reports:.*suffix', '^reports:[ab]', 'reports:*', '^reports:?'])('refuses unsupported %s without widening or local deletion', async pattern => {
    const cache = store(), local = vi.spyOn(cache, 'deletePattern');
    await expect(cache.deletePatternAsync(pattern)).rejects.toThrow();
    expect(backend.deleteByPrefix).not.toHaveBeenCalled(); expect(local).not.toHaveBeenCalled();
  });
  it.each(['^reports:', '^reports:*', '^reports:.*'])('supports exact prefix grammar %s', async pattern => {
    const cache = store(); vi.mocked(backend.deleteByPrefix).mockResolvedValue(2);
    await expect(cache.deletePatternAsync(pattern)).resolves.toBe(2);
    expect(backend.deleteByPrefix).toHaveBeenCalledWith('core-cache:reports:');
  });
  it('late remote success cannot release an old generation result or increment hit stats', async () => {
    const cache = store(); let release: ((value: unknown) => void) | undefined;
    vi.mocked(backend.getJson).mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = cache.getAsync('x'); current = false; release?.('late');
    await expect(pending).rejects.toThrow('required generation revoked'); expect(cache.getStats().hits).toBe(0);
  });
  it('required sync Map APIs refuse while cleanup/statistics remain available', () => {
    const cache = store();
    for (const operation of [() => cache.get('x'), () => cache.has('x'), () => cache.set('x', 1), () => cache.delete('x'), () => cache.deletePattern('.*'), () => cache.clear(), () => cache.ping()]) expect(operation).toThrow();
    expect(() => cache.getStats()).not.toThrow(); expect(() => cache.destroy()).not.toThrow();
  });
});
