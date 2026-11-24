/**
 * OPS-007 P2: why building one recap digest failed, and whether a later tick
 * may try it again.
 *
 * Only an error the recap's own data raises is `unbuildable`: the household
 * has no currency, the recipient may no longer read the household, or a
 * calculation refused its inputs (such as a missing FX rate). Those fail the
 * same way on every tick, so the digest is settled for the week.
 *
 * Anything else stays `failed` and is retried. That includes Postgres and
 * network errors, which Drizzle wraps (DrizzleQueryError) and pg-pool raises
 * without a code ("Connection terminated unexpectedly"). A data error caused
 * by a database or network fault is also retried.
 *
 * @module modules/weekly-recap/recap-failure
 */
import { CalculationError } from "../../core/calculations/errors";
import { ForbiddenError } from "../../core/errors";
import { getPostgresError } from "../../utils/postgresError";

const MAX_CAUSE_DEPTH = 4;
/** A Node system error code, such as ECONNRESET, ETIMEDOUT or EPIPE. */
const NODE_SYSTEM_CODE = /^E[A-Z0-9_]+$/;

/** The household has no currency, so its digest has no unit to report in. */
export class RecapCurrencyMissingError extends Error {
  constructor() {
    super("Missing household currency for recap");
    this.name = "RecapCurrencyMissingError";
  }
}

function readField(value: object, field: string): unknown {
  try {
    return Reflect.get(value, field);
  } catch {
    return undefined;
  }
}

/** The error and its causes, outermost first, bounded and cycle-safe. */
function causeChain(error: unknown): object[] {
  const chain: object[] = [];
  let current = error;
  while (typeof current === "object" && current !== null && !chain.includes(current) && chain.length < MAX_CAUSE_DEPTH) {
    chain.push(current);
    current = readField(current, "cause");
  }
  return chain;
}

/** A database or network fault anywhere in the cause chain: it may pass by the next tick. */
export function isTransientRecapFailure(error: unknown): boolean {
  if (getPostgresError(error) !== undefined) return true;
  return causeChain(error).some((link) => {
    const code = readField(link, "code");
    return typeof readField(link, "errno") === "number" || (typeof code === "string" && NODE_SYSTEM_CODE.test(code));
  });
}

function isRecapDataError(error: unknown): boolean {
  return error instanceof RecapCurrencyMissingError || error instanceof ForbiddenError || error instanceof CalculationError;
}

/** `unbuildable` only for a known data error with no fault beneath it; everything else is retried. */
export function classifyRecapBuildFailure(error: unknown): "unbuildable" | "failed" {
  return isRecapDataError(error) && !isTransientRecapFailure(error) ? "unbuildable" : "failed";
}
