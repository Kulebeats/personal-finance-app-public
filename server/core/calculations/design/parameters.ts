/**
 * Calculation Engine - Parameter Definitions
 *
 * Defines the configuration parameters that drive the calculation engine.
 * These parameters are version-controlled and can be adjusted by admins/analysts.
 *
 * @module core/calculations/design/parameters
 */

import { Percentage, toPercentage } from "../types";

export interface TaxParameters {
  defaultTaxRate: Percentage;
  socialSecurityRate: Percentage;
  medicareRate: Percentage;
}

export interface InflationParameters {
  defaultRate: Percentage;
  educationRate: Percentage;
  healthcareRate: Percentage;
}

export interface RetirementParameters {
  defaultWithdrawalRate: Percentage;
  retirementAge: number;
  lifeExpectancy: number;
}

export interface CalculationParameters {
  version: string;
  effectiveDate: string; // ISO Date YYYY-MM-DD
  tax: TaxParameters;
  inflation: InflationParameters;
  retirement: RetirementParameters;
  rounding: {
    mode: "half_up" | "half_even"; // banker's rounding
    decimals: number;
  };
}

/**
 * Default parameters to use when no specific version is loaded.
 * Serves as the fallback configuration.
 */
export const DEFAULT_PARAMETERS: CalculationParameters = {
  version: "1.0.0",
  effectiveDate: "2024-01-01",
  tax: {
    defaultTaxRate: toPercentage(25),
    socialSecurityRate: toPercentage(6.2),
    medicareRate: toPercentage(1.45),
  },
  inflation: {
    defaultRate: toPercentage(3),
    educationRate: toPercentage(5),
    healthcareRate: toPercentage(5),
  },
  retirement: {
    defaultWithdrawalRate: toPercentage(4),
    retirementAge: 65,
    lifeExpectancy: 90,
  },
  rounding: {
    mode: "half_up",
    decimals: 2,
  },
};
