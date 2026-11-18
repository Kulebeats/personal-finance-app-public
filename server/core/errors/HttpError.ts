/**
 * HTTP Error - Base Class
 *
 * Abstract base class for all HTTP/API errors.
 * Separate from CalculationError which handles domain-specific calculation errors.
 *
 * @module core/errors/HttpError
 */

export abstract class HttpError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;
  readonly isOperational: boolean = true;
  readonly timestamp: string = new Date().toISOString();

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        timestamp: this.timestamp,
      },
    };
  }
}
