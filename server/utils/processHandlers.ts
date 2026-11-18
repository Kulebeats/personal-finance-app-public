/**
 * Process-level error handlers (SCP-325).
 *
 * Without these, a fire-and-forget async rejection or an uncaught exception can
 * crash (or silently destabilise) the Node process with no logged context. These
 * log with context and, for an uncaught exception — which leaves the process in an
 * undefined state — exit cleanly so the supervisor/host can restart it.
 */
import { logger } from "./logger";

let registered = false;

export function registerProcessErrorHandlers(): void {
  // Idempotent: registering twice would duplicate listeners and the exit logic.
  if (registered) return;
  registered = true;

  process.on(
    "unhandledRejection",
    (reason: unknown, promise: Promise<unknown>) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      logger.error(
        "Unhandled promise rejection",
        { promise: String(promise) },
        error,
      );
    },
  );

  process.on("uncaughtException", (error: Error) => {
    logger.error("Uncaught exception - exiting for restart", {}, error);
    // The process is in an undefined state; exit so the supervisor restarts it.
    // Brief delay lets the logger flush first.
    setTimeout(() => process.exit(1), 100);
  });
}
