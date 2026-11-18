/**
 * Investment Types
 *
 * TypeScript interfaces for investment-related data structures.
 *
 * @module hooks/investments/types
 */

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
  currentValue?: number;
  currentValueLocal?: number;
  currentValueBase?: number;
  costBasisBase?: number;
  baseCurrency?: string;
  fxRateUsed?: number | null;
  gainLoss?: number;
  gainLossPercent?: number;
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
  totalValue: number;
  totalCostBasis: number;
  totalGainLoss: number;
  totalGainLossPercent: number;
  holdingsCount: number;
}

export interface AttributionResult {
  holdingId: string;
  securityName: string;
  symbol: string;
  currency: string;
  currentValue: number;
  costBasis: number;
  totalGain: number;
  assetReturn: number;
  fxReturn: number;
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
  createdAt: string;
  updatedAt: string;
  // Joined fields from related tables (optional)
  accountName?: string;
  securityName?: string;
}
