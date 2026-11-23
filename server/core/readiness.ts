export type DependencyStatus = "healthy" | "unhealthy" | "not_configured";
export type ReadinessProbe = (signal: AbortSignal) => Promise<void | "not_configured">;
export type ReadinessResult = {
  status: "healthy" | "unhealthy";
  checks: Record<string, { status: DependencyStatus }>;
};

// Leave 500ms for HTTP handling within the specification's two-second budget.
export const READINESS_TIMEOUT_MS = 1500;

/** A stalled adapter cannot create an unbounded queue of repeated probe work. */
function boundedProbe(probe: ReadinessProbe, timeoutMs: number) {
  let inFlight: Promise<{ status: DependencyStatus }> | undefined;
  return () => {
    if (inFlight) return inFlight;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const task = Promise.resolve().then(() => probe(controller.signal));
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Readiness deadline exceeded"));
      }, timeoutMs);
    });
    inFlight = Promise.race([task, deadline])
      .then((status) => ({ status: status ?? "healthy" } as const), () => ({ status: "unhealthy" } as const))
      .finally(() => clearTimeout(timer));
    // Retain the settled unhealthy result while the underlying work is stuck.
    // Once it settles, later requests can retry and observe recovery.
    task.finally(() => { inFlight = undefined; }).catch(() => {});
    return inFlight;
  };
}

export function createReadinessCheck(
  probes: Record<string, ReadinessProbe>,
  timeoutMs = READINESS_TIMEOUT_MS,
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > READINESS_TIMEOUT_MS) {
    throw new Error("Readiness timeout must be within the 1500ms probe budget");
  }
  const checks = Object.entries(probes).map(([name, probe]) => [name, boundedProbe(probe, timeoutMs)] as const);
  return async (): Promise<ReadinessResult> => {
    const results = await Promise.all(checks.map(async ([name, probe]) => [name, await probe()] as const));
    return {
      status: results.some(([, check]) => check.status === "unhealthy") ? "unhealthy" : "healthy",
      checks: Object.fromEntries(results),
    };
  };
}
