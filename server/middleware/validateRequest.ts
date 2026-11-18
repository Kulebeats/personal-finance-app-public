/**
 * Request Validation Middleware
 *
 * Provides Zod-based validation for request body, query, and params.
 * Replaces inline safeParse calls in controllers with declarative middleware.
 *
 * @example
 * // Validate request body
 * router.post('/transactions', validateBody(createTransactionSchema), handler);
 *
 * // Validate query params
 * router.get('/transactions', validateQuery(listTransactionsSchema), handler);
 *
 * // Validate route params
 * router.get('/transactions/:id', validateParams(idParamSchema), handler);
 *
 * @module middleware/validateRequest
 */

import { type Request, type Response, type NextFunction } from "express";
import { type ZodSchema, type ZodError } from "zod";
import { ValidationError } from "../core/errors";

/**
 * Transform Zod errors into a structured format for the API response.
 */
function formatZodErrors(
  error: ZodError
): Array<{ field: string; message: string }> {
  return error.errors.map((err) => ({
    field: err.path.join("."),
    message: err.message,
  }));
}

/**
 * Validate request body against a Zod schema.
 * Parsed data is attached to req.body.
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const errors = formatZodErrors(result.error);
      return next(new ValidationError("Validation failed", errors));
    }

    // Attach parsed data back to req.body
    req.body = result.data;
    next();
  };
}

/**
 * Validate query parameters against a Zod schema.
 * Parsed data is attached to req.query.
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      const errors = formatZodErrors(result.error);
      return next(new ValidationError("Query validation failed", errors));
    }

    // Attach parsed data - cast needed for Express compatibility
    (req as Request & { validatedQuery: T }).validatedQuery = result.data;
    next();
  };
}

/**
 * Validate route parameters against a Zod schema.
 * Parsed data is attached to req.params.
 */
export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      const errors = formatZodErrors(result.error);
      return next(new ValidationError("Parameter validation failed", errors));
    }

    // Attach parsed data - cast needed for Express compatibility
    (req as Request & { validatedParams: T }).validatedParams = result.data;
    next();
  };
}

/**
 * Combined validator for body and query in a single middleware.
 */
export function validateRequest<TBody, TQuery>(options: {
  body?: ZodSchema<TBody>;
  query?: ZodSchema<TQuery>;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Validate body if schema provided
    if (options.body) {
      const bodyResult = options.body.safeParse(req.body);
      if (!bodyResult.success) {
        const errors = formatZodErrors(bodyResult.error);
        return next(new ValidationError("Body validation failed", errors));
      }
      req.body = bodyResult.data;
    }

    // Validate query if schema provided
    if (options.query) {
      const queryResult = options.query.safeParse(req.query);
      if (!queryResult.success) {
        const errors = formatZodErrors(queryResult.error);
        return next(new ValidationError("Query validation failed", errors));
      }
      (req as Request & { validatedQuery: TQuery }).validatedQuery = queryResult.data;
    }

    next();
  };
}
