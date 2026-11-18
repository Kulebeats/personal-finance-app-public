/**
 * Core Errors Module
 *
 * Standardized HTTP/API error classes for the application.
 * Separate from CalculationError in core/calculations which handles domain errors.
 *
 * @module core/errors
 */

export { HttpError } from "./HttpError";
export { NotFoundError } from "./NotFoundError";
export { HouseholdNotFoundError } from "./HouseholdNotFoundError";
export { ValidationError, type FieldError } from "./ValidationError";
export { UnauthorizedError } from "./UnauthorizedError";
export { ForbiddenError } from "./ForbiddenError";
export { ForbiddenError as AuthorizationError } from "./ForbiddenError";
export { ConflictError } from "./ConflictError";
export { RateLimitError } from "./RateLimitError";
export { InternalError } from "./InternalError";
export { errorHandler } from "./errorHandler";
export { getErrorMessage } from "./getErrorMessage";

// Re-export calculation errors for convenience
export { CalculationError, isCalculationError } from "../calculations/errors";
