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
export { InvalidCredentialsError } from "./InvalidCredentialsError";
export { ForbiddenError } from "./ForbiddenError";
export { EmailVerificationRequiredError } from "./EmailVerificationRequiredError";
export { MfaEnrolmentRequiredError, MfaRequiredError } from "./MfaErrors";
export { ForbiddenError as AuthorizationError } from "./ForbiddenError";
export { ConflictError } from "./ConflictError";
export { RateLimitError } from "./RateLimitError";
export { InternalError } from "./InternalError";
export { ServiceUnavailableError } from "./ServiceUnavailableError";
export { errorHandler } from "./errorHandler";
export { getErrorMessage } from "./getErrorMessage";

// Re-export calculation errors for convenience
export { CalculationError, isCalculationError } from "../calculations/errors";
