import type { PostHogOptions } from 'posthog-node';
import { logger } from '../../utils/logger';

type AnalyticsFetch = NonNullable<PostHogOptions['fetch']>;

function emptyWriteResponse(status: number, retryAfter: string | null): Awaited<ReturnType<AnalyticsFetch>> {
  return {
    status,
    text: async () => '',
    json: async () => ({}),
    headers: { get: name => name.toLowerCase() === 'retry-after' ? retryAfter : null },
  };
}

/** Capture-only client: SDK diagnostics must never retain transport bodies/errors. */
export const posthogAnalyticsFetch: AnalyticsFetch = async (url, options) => {
  let response: Response | undefined;
  try {
    response = await fetch(url, options);
    const status = response.status;
    if (!Number.isInteger(status) || status < 0 || status > 599) throw new Error('Invalid analytics status');
    const rawRetryAfter = response.headers.get('retry-after');
    const seconds = typeof rawRetryAfter === 'string' && /^\d{1,9}$/.test(rawRetryAfter.trim())
      ? Number(rawRetryAfter.trim()) : 0;
    // Match the SDK's five-minute throttle bound; omit dates and invalid values.
    const retryAfter = seconds > 0 ? String(Math.min(seconds, 300)) : null;
    if (status < 200 || status >= 300) logger.warn('Posthog analytics HTTP request failed', { statusCode: status, count: 1 });
    return emptyWriteResponse(status, retryAfter);
  } catch {
    logger.warn('Posthog analytics transport failed', { count: 1 });
    throw new Error('Posthog analytics transport failed');
  } finally {
    try {
      // Do not read a response body. Cancellation failures contain no diagnostics.
      void Promise.resolve(response?.body?.cancel()).catch(() => {});
    } catch {}
  }
};
