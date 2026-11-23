/**
 * Service Unavailable Error (503)
 *
 * A dependency the request needs (for example outbound email) is not
 * available right now. The caller may retry later.
 *
 * @module core/errors/ServiceUnavailableError
 */

import { HttpError } from "./HttpError";

export class ServiceUnavailableError extends HttpError {
  readonly statusCode = 503;
  readonly code = "SERVICE_UNAVAILABLE";
}
