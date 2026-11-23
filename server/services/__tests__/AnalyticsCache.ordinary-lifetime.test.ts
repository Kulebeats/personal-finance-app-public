import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  parent: { duplicate: vi.fn(), scan: vi.fn(), del: vi.fn() },
  child: { on: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), scan: vi.fn(), del: vi.fn() },
}));
vi.mock('../../config/redis', () => ({ redis: mocks.parent, productionRedis: null }));
import { AnalyticsCache } from '../AnalyticsCache';

const key = 'analytics:dashboard:hh:user:v1:abcdef123456';
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers();
  mocks.parent.duplicate.mockReturnValue(mocks.child);
  mocks.child.connect.mockResolvedValue(undefined);
  mocks.child.scan.mockResolvedValue(['0', [key]]);
  mocks.child.del.mockResolvedValue(1);
  mocks.parent.scan.mockResolvedValue(['0', [key]]);
  mocks.parent.del.mockResolvedValue(1);
});
afterEach(() => { vi.useRealTimers(); });

describe('ordinary analytics invalidation owns a finite Redis lifetime', () => {
  it('uses a dedicated non-reconnecting, non-queued client and disconnects after success', async () => {
    await new AnalyticsCache().invalidateHousehold('hh');
    const [options] = mocks.parent.duplicate.mock.calls[0];
    expect(options).toMatchObject({ lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0, connectTimeout: 400, commandTimeout: 400, autoResendUnfulfilledCommands: false });
    expect(options.retryStrategy(1)).toBeNull();
    expect(options.reconnectOnError(new Error('READONLY'))).toBe(false);
    expect(mocks.child.del).toHaveBeenCalledWith(key);
    expect(mocks.child.disconnect).toHaveBeenCalledOnce();
    expect(mocks.parent.scan).not.toHaveBeenCalled(); expect(mocks.parent.del).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  for (const phase of ['connect', 'scan', 'del'] as const) {
    it(`${phase} stalls are bounded, disconnected and cannot dispatch work after a late result`, async () => {
      let resolve: ((value: unknown) => void) | undefined;
      const stall = () => new Promise(value => { resolve = value; });
      mocks.child[phase].mockImplementationOnce(stall);
      if (phase !== 'connect') mocks.parent[phase].mockImplementationOnce(stall);
      const outcome = new AnalyticsCache().invalidateHousehold('hh').then(() => 'success', error => error.name);
      const bounded = Promise.race([outcome, new Promise(value => setTimeout(() => value('still-pending'), 1200))]);
      await vi.advanceTimersByTimeAsync(1200);
      expect(await bounded).toBe('OrdinaryAnalyticsInvalidationError');
      const scans = mocks.child.scan.mock.calls.length, deletes = mocks.child.del.mock.calls.length;
      expect(mocks.child.disconnect).toHaveBeenCalled();
      resolve?.(phase === 'scan' ? ['0', [key]] : phase === 'del' ? 1 : undefined);
      await vi.advanceTimersByTimeAsync(200);
      expect(await outcome).toBe('OrdinaryAnalyticsInvalidationError');
      expect(mocks.child.scan).toHaveBeenCalledTimes(scans); expect(mocks.child.del).toHaveBeenCalledTimes(deletes);
      expect(mocks.parent.scan).not.toHaveBeenCalled(); expect(mocks.parent.del).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  it('observes a late command rejection after timeout without retry or unhandled failure', async () => {
    let reject: ((reason: Error) => void) | undefined;
    const stall = () => new Promise((_resolve, failure) => { reject = failure; });
    mocks.child.scan.mockImplementationOnce(stall); mocks.parent.scan.mockImplementationOnce(stall);
    const outcome = new AnalyticsCache().invalidateHousehold('hh').then(() => 'success', error => error.name);
    const bounded = Promise.race([outcome, new Promise(value => setTimeout(() => value('still-pending'), 1200))]);
    await vi.advanceTimersByTimeAsync(1200);
    expect(await bounded).toBe('OrdinaryAnalyticsInvalidationError');
    reject?.(new Error('late scan rejection'));
    await vi.advanceTimersByTimeAsync(200);
    expect(mocks.child.scan).toHaveBeenCalledOnce(); expect(mocks.child.del).not.toHaveBeenCalled();
    expect(await outcome).toBe('OrdinaryAnalyticsInvalidationError');
    expect(vi.getTimerCount()).toBe(0);
  });
});
