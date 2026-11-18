/**
 * Validation Error (400)
 *
 * @module core/errors/ValidationError
 */

import { HttpError } from "./HttpError";
import { ZodIssue } from "zod";

export interface FieldError {
  field: string;
  message: string;
  code?: string;
}

export class ValidationError extends HttpError {
  readonly statusCode = 400;
  readonly code = "VALIDATION_ERROR";
  readonly fields: FieldError[];

  constructor(message: string, errors: FieldError[] | ZodIssue[] = []) {
    super(message);
    // Convert ZodIssue to FieldError if needed
    this.fields = errors.map((e) => {
      if ("path" in e) {
        // ZodIssue format
        return {
          field: e.path.join(".") || "unknown",
          message: e.message,
          code: e.code,
        };
      }
      // Already FieldError format
      return e as FieldError;
    });
  }

  toJSON() {
    return {
      ...super.toJSON(),
      error: {
        ...super.toJSON().error,
        fields: this.fields,
      },
    };
  }
}
