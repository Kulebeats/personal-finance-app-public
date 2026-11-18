import { TrendingUp, Building2 } from "lucide-react";

export const SECURITY_TYPES = [
  { value: "stock", label: "Stock", icon: TrendingUp },
  { value: "bond", label: "Bond", icon: Building2 },
  { value: "etf", label: "ETF", icon: TrendingUp },
  { value: "mutual_fund", label: "Mutual Fund", icon: Building2 },
  { value: "unit_trust", label: "Unit Trust", icon: Building2 },
];

export const EXCHANGES = [
  { value: "luse", label: "LuSE (Zambia)" },
  { value: "nyse", label: "NYSE" },
  { value: "nasdaq", label: "NASDAQ" },
  { value: "jse", label: "JSE (South Africa)" },
  { value: "boz", label: "BoZ (Government Securities)" },
  { value: "manual", label: "Manual Entry" },
];
