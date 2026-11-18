/**
 * Authorization Module
 *
 * Exports object-level authorization utilities.
 */

export {
  assertOwnership,
  checkOwnership,
  requireOwnership,
  ForbiddenError,
} from "./ownership";
