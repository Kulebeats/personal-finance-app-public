/**
 * Calculation Engine - Currency Module Index
 *
 * Re-exports all currency-related functionality.
 *
 * @module core/calculations/currency
 */

export {
  // Types
  type FXRate,
  type FXServiceConfig,
  type FXRateRepository,
  type FXRateService,
  // Constants
  DEFAULT_FX_CONFIG,
  // Factory functions
  createFXRateRepository,
  createFXRateService,
  // Global singleton helpers
  setGlobalFXService,
  getGlobalFXService,
  // Compatibility function
  getLatestFxRates,
} from "./fxRates";

export {
  convertToDisplayCurrency,
  convertBatchToDisplayCurrency,
  aggregateMultiCurrency,
  type MultiCurrencyTotal,
} from "./conversion";
