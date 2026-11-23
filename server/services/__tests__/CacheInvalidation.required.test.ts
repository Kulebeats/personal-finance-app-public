import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invalidateEndpoint: vi.fn() }));
vi.mock('../AnalyticsCache', () => ({ analyticsCache: mocks }));
import { invalidateOnChangeAfterCommit } from '../CacheInvalidation';
import { OrdinaryAnalyticsInvalidationError } from '../ordinary-analytics-invalidation';

afterEach(() => { vi.resetAllMocks(); });
describe('post-commit ordinary handling does not conceal a required profile refusal', () => {
  it('rejects an injected required generation refusal', async () => {
    const refusal = new Error('required Redis generation revoked');
    mocks.invalidateEndpoint.mockRejectedValue(refusal);
    await expect(invalidateOnChangeAfterCommit('transaction', 'hh')).rejects.toBe(refusal);
  });
  it('waits for all dispatched invalidations before propagating a refusal', async () => {
    let release: (() => void) | undefined;
    const refusal = new Error('required Redis generation revoked');
    mocks.invalidateEndpoint.mockRejectedValue(refusal).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    let settled = false;
    const pending = invalidateOnChangeAfterCommit('transaction', 'hh').catch(error => { settled = true; return error; });
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false);
    release?.(); expect(await pending).toBe(refusal);
  });
  it('an early ordinary failure cannot conceal a later required profile refusal', async () => {
    const refusal = new Error('required Redis generation revoked');
    mocks.invalidateEndpoint.mockResolvedValue(undefined)
      .mockRejectedValueOnce(new OrdinaryAnalyticsInvalidationError(new Error('ordinary outage')))
      .mockRejectedValueOnce(refusal);
    await expect(invalidateOnChangeAfterCommit('transaction', 'hh')).rejects.toBe(refusal);
  });
});
