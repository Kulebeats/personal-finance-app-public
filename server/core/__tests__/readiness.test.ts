import { afterEach, expect, it, vi } from "vitest";
import { createReadinessCheck } from "../readiness";

afterEach(() => vi.useRealTimers());

it("bounds concurrent hanging probes, aborts them and does not multiply stuck work", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal;
  let finish!: () => void;
  const probe = vi.fn((input: AbortSignal) => { signal = input; return new Promise<void>((resolve) => { finish = resolve; }); });
  const check = createReadinessCheck({ database: probe, cache: async () => {} });
  const first = check();
  const concurrent = check();
  await vi.advanceTimersByTimeAsync(1500);
  expect(await first).toMatchObject({ status: "unhealthy", checks: { database: { status: "unhealthy" } } });
  expect(await concurrent).toEqual(await first);
  expect(signal!.aborted).toBe(true);
  expect(probe).toHaveBeenCalledOnce();
  await check();
  expect(probe).toHaveBeenCalledOnce();
  finish();
  await vi.advanceTimersByTimeAsync(0);
  const retry = check();
  await vi.advanceTimersByTimeAsync(1500);
  await retry;
  expect(probe).toHaveBeenCalledTimes(2);
  finish();
});

it("recovers on a later probe and turns synchronous throw/rejection into unhealthy", async () => {
  const database = vi.fn().mockRejectedValueOnce(new Error("private driver payload")).mockResolvedValue(undefined);
  const check = createReadinessCheck({ database });
  expect((await check()).status).toBe("unhealthy");
  expect((await check()).status).toBe("healthy");
  const synchronous = createReadinessCheck({ database: () => { throw new Error("private"); } });
  expect(await synchronous()).toEqual({ status: "unhealthy", checks: { database: { status: "unhealthy" } } });
});

it("does not allow configured probe deadlines above the two-second response budget", () => {
  for (const timeout of [0, -1, Infinity, NaN, 2000]) expect(() => createReadinessCheck({}, timeout)).toThrow();
});
