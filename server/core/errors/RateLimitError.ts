/**
 * Rate Limit Error (429)
 *
 * @module core/errors/RateLimitError
 */

import { HttpError } from "./HttpError";

export class RateLimitError extends HttpError {
  readonly statusCode = 429;
  readonly code = "RATE_LIMIT_EXCEEDED";
  readonly retryAfter: number;

  constructor(retryAfter: number = 60) {
    super("Too many requests. Please try again later.");
    this.retryAfter = retryAfter;
  }
}
