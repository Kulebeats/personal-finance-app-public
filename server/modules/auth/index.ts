/**
 * Module Template - Auth Module
 *
 * This is a template demonstrating the modular monolith pattern.
 * Each module follows this structure:
 * - controller.ts - Route handlers (thin, orchestration only)
 * - service.ts - Business logic and invariants
 * - repository.ts - Data access layer
 * - validation.ts - Zod schemas for input validation
 * - types.ts - Module-specific types
 * - routes.ts - Express route definitions
 * - __tests__/ - Module tests
 */

export * from "./auth.routes";
export * from "./auth.types";
