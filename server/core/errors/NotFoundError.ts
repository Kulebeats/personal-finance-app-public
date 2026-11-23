/**
 * Not Found Error (404)
 *
 * @module core/errors/NotFoundError
 */

import { HttpError } from "./HttpError";

export class NotFoundError extends HttpError {
  readonly statusCode = 404;
  readonly code = "NOT_FOUND";

  /** `resource` names the thing ("Goal"); a full sentence that already says "not found" is kept as it is. */
  constructor(resource: string, id?: string | number) {
    super(
      /not found/i.test(resource)
        ? resource
        : id ? `${resource} with id '${id}' not found` : `${resource} not found`
    );
  }
}
