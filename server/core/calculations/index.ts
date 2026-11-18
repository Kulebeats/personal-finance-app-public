/**
 * Centralized Calculation Engine
 *
 * This module consolidates all financial calculations into a single,
 * auditable, and testable library.
 *
 * @module core/calculations
 */

export { toMoney, type Money } from "./types";
// export * from "./types";
export * from "./errors";
export * from "./helpers";

// Module exports
export * from "./currency";
export * from "./cashflow";
export * from "./goals";
export * from "./budget";
export * from "./investments";
export * from "./debt";
export * from "./ratios";
export * from "./dates";
export * from "./recurring";

// New modules (Phase 5B & 7)
export * as projections from "./projections";
export * as design from "./design";
export * as monitor from "./monitor";
