/**
 * Simulated lost acknowledgements for real-DB tests (OPS-001): the statement
 * runs and commits on the real database, then its caller sees a failure, as
 * when a connection drops after the server committed.
 */
import pg from "pg";
import { vi } from "vitest";
import { pool } from "../db";

type Query = (...args: unknown[]) => unknown;

function queryText(args: readonly unknown[]): string {
  const [first] = args;
  if (typeof first === "string") return first;
  return first && typeof first === "object" && "text" in first ? String((first as { text: unknown }).text) : "";
}

/** A code-less connection error: the outcome is unknown to the caller. */
export const connectionLost = () => new Error("Connection terminated unexpectedly");

/** A server answer that says the statement's completion is unknown (SQLSTATE 40003). */
export function completionUnknown(): pg.DatabaseError {
  return Object.assign(new pg.DatabaseError("statement completion unknown", 0, "error"), { code: "40003" });
}

/**
 * The first statement matching `match` runs and commits, then its caller gets
 * `failure()` instead of the result. Restore the returned spy in a finally.
 */
export function loseAcknowledgement(target: "pool" | "client", match: RegExp, failure: () => Error = connectionLost) {
  const host = (target === "pool" ? pool : pg.Client.prototype) as unknown as { query: Query };
  const original = host.query;
  let isArmed = true;
  return vi.spyOn(host, "query").mockImplementation(function (this: unknown, ...args: unknown[]) {
    const result = Reflect.apply(original, this, args);
    if (!isArmed || !match.test(queryText(args).trim())) return result;
    isArmed = false;
    return Promise.resolve(result).then(() => { throw failure(); });
  });
}
