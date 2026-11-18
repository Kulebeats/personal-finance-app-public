export interface InvestmentHolding {
  id: string;
  securityId: string;
  quantity: string;
  averageBuyPrice: string;
  currentValue?: number;
  gainLoss?: number;
  gainLossPercent?: number;
  security?: InvestmentSecurity;
}

export interface InvestmentSecurity {
  id: string;
  symbol: string;
  name: string;
  type: SecurityType;
  sector?: string;
  currentPrice: string;
  currency: string;
  lastPriceUpdate?: string;
}

export type SecurityType =
  | "stock"
  | "bond"
  | "tbill"
  | "etf"
  | "mutual_fund"
  | "unit_trust"
  | "term_deposit"
  | "forex"
  | "crypto"
  | "other";

export type SecurityExchange =
  | "luse"
  | "nyse"
  | "nasdaq"
  | "jse"
  | "otc"
  | "boz"
  | "manual";

export interface PortfolioSummary {
  totalValue: number;
  totalGainLoss: number;
  totalGainLossPercent: number;
  currency: string;
}

export interface InvestmentTransaction {
  id: string;
  date: string;
  type: "buy" | "sell" | "dividend" | "interest";
  quantity?: number;
  price?: number;
  amount: number;
  currency: string;
}
