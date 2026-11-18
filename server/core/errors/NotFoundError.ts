/**
 * Not Found Error (404)
 *
 * @module core/errors/NotFoundError
 */

import { HttpError } from "./HttpError";

export class NotFoundError extends HttpError {
  readonly statusCode = 404;
  readonly code = "NOT_FOUND";

  constructor(resource: string, id?: string | number) {
    super(
      id ? `${resource} with id '${id}' not found` : `${resource} not found`
    );
  }
}
