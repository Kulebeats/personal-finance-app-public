/**
 * NEW-28: another member's write must reach this member without a reload.
 *
 * Each member's own mutations invalidate their queries, but nothing tells this
 * browser about a write made by another member of the household. With
 * `staleTime: Infinity` and no refetch on focus, cached data never went stale,
 * so a shared transaction added by a partner stayed invisible until reload.
 */
import { focusManager, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDataQueryClient } from "../queryClient";

// Thirty seconds: long enough to share one fetch across a screen, short
// enough that a partner's write shows on the next visit or focus.
const WITHIN_STALE_TIME = new Date("2026-11-17T09:00:20Z");
const AFTER_STALE_TIME = new Date("2026-11-17T09:00:31Z");

describe("default data freshness", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T09:00:00Z"));
  });

  afterEach(() => {
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  });

  it("serves the cache within the stale time and refetches after it", async () => {
    const client = createDataQueryClient();
    const queryFn = vi.fn(async () => ["txn"]);
    await client.fetchQuery({ queryKey: ["transactions"], queryFn });
    vi.setSystemTime(WITHIN_STALE_TIME);
    await client.fetchQuery({ queryKey: ["transactions"], queryFn });
    expect(queryFn).toHaveBeenCalledTimes(1);

    vi.setSystemTime(AFTER_STALE_TIME);
    await client.fetchQuery({ queryKey: ["transactions"], queryFn });
    expect(queryFn).toHaveBeenCalledTimes(2);
    client.clear();
  });

  it("refetches a stale on-screen query when the window regains focus", async () => {
    const client = createDataQueryClient();
    // QueryClientProvider mounts the client, which subscribes it to focus.
    client.mount();
    const queryFn = vi.fn(async () => ["txn"]);
    const observer = new QueryObserver(client, { queryKey: ["accounts"], queryFn });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
    expect(queryFn).toHaveBeenCalledTimes(1);

    vi.setSystemTime(AFTER_STALE_TIME);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    unsubscribe();
    client.unmount();
    client.clear();
  });
});
