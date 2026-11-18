/**
 * Error Handler Middleware
 *
 * Express error handling middleware that converts errors to standardized responses.
 * Handles HttpError, CalculationError, and unknown errors.
 *
 * @module core/errors/errorHandler
 */

import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { HttpError } from "./HttpError";
import { CalculationError } from "../calculations/errors";
import { logger } from "../../utils/logger";

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Handle known HTTP errors
  if (err instanceof HttpError) {
    if (!err.isOperational) {
      logger.error("Non-operational error", { route: req.path }, err);
    }
    res.status(err.statusCode).json(err.toJSON());
    return;
  }

  // Handle calculation errors (convert to HTTP 400)
  if (err instanceof CalculationError) {
    res.status(400).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        context: err.context,
      },
    });
    return;
  }

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request data",
        details: err.errors,
      },
    });
    return;
  }

  // Body-parser failures (e.g. malformed JSON) arrive as a SyntaxError with a
  // 4xx status set by express.json(); honour that status instead of masking it
  // as a 500.
  const bodyParserStatus =
    (err as { status?: number; statusCode?: number }).status ??
    (err as { statusCode?: number }).statusCode;
  if (
    err instanceof SyntaxError &&
    typeof bodyParserStatus === "number" &&
    bodyParserStatus >= 400 &&
    bodyParserStatus < 500
  ) {
    res.status(bodyParserStatus).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Malformed request body",
      },
    });
    return;
  }

  // Unknown errors - log and return generic message.
  // Pass the Error as the 4th arg so createLogEntry serializes name/message
  // (and stack in development); previously it was placed in the context object
  // and silently dropped, leaving every 500 logged with no cause.
  logger.error("Unhandled error", { route: req.path }, err);

  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    },
  });
}
