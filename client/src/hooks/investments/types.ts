/**
 * Investment Types
 *
 * TypeScript interfaces for investment-related data structures.
 *
 * @module hooks/investments/types
 */

import type { MoneyDto } from "@shared/money";

export interface Security {
  id: string;
  symbol: string;
  name: string;
  type: string;
  currency: string;
  exchange: string | null;
  isOffshore: boolean;
  sector: string | null;
  cusipIsin: string | null;
  currentPrice: string | null;
  lastPriceUpdate: string | null;
  valuationPrice?: {
    source: "manual";
    effectiveDate: string;
    validThrough: string;
    recordedAt: string;
  } | null;
  withholdingTaxRate: string;
  createdAt: string;
  updatedAt: string;
}

export interface Holding {
  id: string;
  householdId: string;
  accountId: string;
  securityId: string;
  quantity: string;
  costBasis: string | null;
  costBasisZmw: string | null;
  acquiredDate: string | null;
  acquisitionFxRate: string | null;
  createdAt: string;
  updatedAt: string;
  security?: Security;
  // Holdings list valuation, MoneyDto in the base currency; costBasis above
  // stays the stored local-currency string.
  currentValue?: MoneyDto;
  costBasisBase?: MoneyDto | null;
  baseCurrency?: string;
  fxRateUsed?: number | null;
  gainLoss?: MoneyDto | null;
  gainLossPercent?: number | null;
}

export interface FxRate {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  date: string;
  source: string;
  createdAt: string;
}

export interface InvestmentTransaction {
  id: string;
  householdId: string;
  accountId: string;
  holdingId: string | null;
  securityId: string | null;
  type: string;
  quantity: string | null;
  price: string | null;
  amount: string;
  currency: string;
  fxRate?: string | null;
  amountZmw?: string | null;
  fees?: string | null;
  withholdingTax?: string | null;
  linkedTransactionId?: string | null;
  transactionDate: string;
  notes?: string | null;
  createdAt: string;
}

export interface PortfolioSummary {
  baseCurrency?: string;
  totalValue: MoneyDto;
  totalCostBasis: MoneyDto | null;
  totalGainLoss: MoneyDto | null;
  totalGainLossPercent: number | null;
  holdingsCount: number;
  byType?: Record<string, MoneyDto>;
  tbillsValue?: MoneyDto;
  pensionValue?: MoneyDto;
  totalIncludingAlternatives?: MoneyDto;
}

/**
 * The unit of every AttributionResult amount (A-31): the server's FX base,
 * BASE_CURRENCY in server/services/FXAttributionService.ts. `currency` on a
 * result is the security's own currency, not the unit of its amounts.
 */
export const FX_ATTRIBUTION_CURRENCY = "ZMW";

export interface AttributionResult {
  holdingId: string;
  securityName: string;
  symbol: string;
  currency: string;
  // ZMW MoneyDto decimal strings (defect 10); total them with Decimal, never floats.
  currentValue: MoneyDto;
  costBasis: MoneyDto;
  totalGain: MoneyDto;
  assetReturn: MoneyDto;
  fxReturn: MoneyDto;
  totalReturnPercent: number;
  assetReturnPercent: number;
  fxReturnPercent: number;
}

export interface PensionHolding {
  id: string;
  householdId: string;
  accountId: string | null;
  providerName: string;
  accountNumber: string | null;
  pensionType: string; // 'social_security' | 'private' | 'employer'
  currentBalance: string | null;
  projectedRetirementDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PensionContribution {
  id: string;
  pensionHoldingId: string;
  date: string;
  employeeContribution: string;
  employerContribution: string;
  totalContribution: string;
  createdAt: string;
}

export interface RecurringInvestment {
  id: string;
  householdId: string;
  accountId: string;
  securityId: string | null;
  type: string; // 'sip' | 'rollover'
  frequency: string; // 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'
  amount: string;
  currency: string;
  nextExecutionDate: string;
  isActive: boolean;
  authorizationStatus: "authorization_recorded" | "authorization_required" | "inactive" | "pending_reconciliation";
  authorizationRevision: number;
  authorizationInitialExecutionDate: string | null;
  permittedActions: Array<"authorize" | "deactivate">;
  createdAt?: string | null;
  updatedAt?: string | null;
  // Joined fields from related tables (optional)
  accountName?: string;
  securityName?: string;
}
