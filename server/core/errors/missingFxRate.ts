/**
 * Missing exchange rate → HTTP 422 (R12, NEW-34).
 *
 * A required monetary operation with no rate for a currency pair is missing
 * financial data, not a server fault: the client gets a 422 naming the pair
 * (and the date when one applies) so the household can record the rate.
 *
 * @module core/errors/missingFxRate
 */

import { CalculationError } from "../calculations/errors";
import { logger } from "../../utils/logger";

export const MISSING_FX_RATE_STATUS = 422;

/** A mount-path segment written by a developer: lowercase words only. */
const STATIC_SEGMENT = /^[a-z][a-z0-9-]*$/;
/** Template syntax that can match a variable number of URL segments. */
const VARIABLE_LENGTH = /[*?(+]/;

/** What an error handler can see of the request that failed. */
export interface FailedRequest {
  originalUrl: string;
  route?: { path?: unknown };
}

/**
 * The trusted route template of a failed request, never the client's URL
 * (#254 review). The matched route's own path is the developer's template
 * ("/recurring/:planId/..."). Express restores baseUrl before a top-level
 * error handler runs, so the mount prefix is the leading URL segments the
 * template does not cover; only plain lowercase words are kept, and anything
 * else (an id, a percent-encoded or free-text segment) becomes ":param".
 * A wildcard or optional template covers a variable number of segments, so
 * its whole prefix is masked.
 */
export function routeTemplate(req: FailedRequest): string {
  const template = req.route?.path;
  if (typeof template !== "string") return "unmatched";
  const routeSegments = template.split("/").filter(Boolean);
  const urlSegments = req.originalUrl.split("?")[0].split("/").filter(Boolean);
  const prefix = urlSegments.slice(0, Math.max(0, urlSegments.length - routeSegments.length))
    .map(segment => !VARIABLE_LENGTH.test(template) && STATIC_SEGMENT.test(segment) ? segment : ":param");
  return `/${[...prefix, ...routeSegments].join("/")}`;
}

/** Warn about a missing rate with the route template, pair and date only:
 * never the amount, account or holding. */
export function logMissingFxRate(req: FailedRequest, body: MissingFxRateBody): void {
  logger.warn("Missing exchange rate", { route: routeTemplate(req), ...body.error.details });
}

export interface MissingFxRateBody {
  success: false;
  error: {
    code: "MISSING_FX_RATE";
    message: string;
    details: { from?: string; to?: string; date?: string };
  };
}

/** The 422 body for a missing-rate CalculationError, or null for any other error. */
export function missingFxRateBody(error: unknown): MissingFxRateBody | null {
  if (!(error instanceof CalculationError) || error.code !== "MISSING_FX_RATE") return null;
  const { from, to, date } = error.context;
  const pair = from && to ? `${from} to ${to}` : "a required currency pair";
  return {
    success: false,
    error: {
      code: "MISSING_FX_RATE",
      message: `No exchange rate is available for ${pair}${date ? ` on ${date}` : ""}. An owner or admin can record one.`,
      details: { from, to, date },
    },
  };
}
