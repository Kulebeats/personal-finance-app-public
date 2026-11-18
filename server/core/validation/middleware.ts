/**
 * Validation Middleware Factory
 *
 * Creates Express middleware for validating request data using Zod schemas.
 * Provides consistent error formatting across all endpoints.
 *
 * @module core/validation/middleware
 */

import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { ValidationError } from "../errors";

/**
 * Source of data to validate
 */
export type ValidationSource = "body" | "query" | "params";

/**
 * Validation middleware options
 */
export interface ValidateOptions {
  /** Strip unknown properties (default: true) */
  stripUnknown?: boolean;
  /** Abort early on first error (default: false) */
  abortEarly?: boolean;
}

/**
 * Create validation middleware for a Zod schema
 *
 * @example
 * router.post('/transactions',
 *   validate(createTransactionSchema, 'body'),
 *   transactionController.create
 * );
 *
 * @example
 * router.get('/transactions',
 *   validate(transactionQuerySchema, 'query'),
 *   transactionController.list
 * );
 */
export function validate<T>(
  schema: ZodSchema<T>,
  source: ValidationSource = "body",
  options: ValidateOptions = {}
) {
  const { stripUnknown = true } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = req[source];

      // Parse and validate (Zod's parse() already strips unknown by default)
      const result = schema.parse(data);

      // Replace request data with validated/transformed data
      (req as Request & { [key: string]: unknown })[source] = result;

      // Also store validated data in a predictable location
      (req as Request & { validated?: Record<string, unknown> }).validated = {
        ...(req as Request & { validated?: Record<string, unknown> }).validated,
        [source]: result,
      };

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // Convert to standardized ValidationError
        const validationError = new ValidationError(
          "Validation failed",
          error.errors
        );
        return next(validationError);
      }
      next(error);
    }
  };
}

/**
 * Validate multiple sources at once
 *
 * @example
 * router.put('/transactions/:id',
 *   validateMultiple({
 *     params: transactionIdSchema,
 *     body: updateTransactionSchema,
 *   }),
 *   transactionController.update
 * );
 */
export function validateMultiple(
  schemas: Partial<Record<ValidationSource, ZodSchema>>,
  options: ValidateOptions = {}
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated: Record<string, unknown> = {};

      for (const [source, schema] of Object.entries(schemas)) {
        if (schema) {
          const data = req[source as ValidationSource];
          validated[source] = schema.parse(data);
          (req as Request & { [key: string]: unknown })[source] = validated[source];
        }
      }

      (req as Request & { validated: Record<string, unknown> }).validated = validated;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = new ValidationError(
          "Validation failed",
          error.errors
        );
        return next(validationError);
      }
      next(error);
    }
  };
}

/**
 * Type helper to extract validated data from request
 */
export type ValidatedRequest<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown
> = Request & {
  validated: {
    body?: TBody;
    query?: TQuery;
    params?: TParams;
  };
};
