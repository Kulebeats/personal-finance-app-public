export type AccountType =
  | "bank"
  | "mobile-money"
  | "cash"
  | "investment"
  | "credit"
  | "loan"
  | "mortgage"
  | "other-liability"
  | "vehicle"
  | "property"
  | "other"
  | null;

export const SUPPORTED_CURRENCIES = [
  { code: "ZMW", name: "Zambian Kwacha", symbol: "K" },
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "ZAR", name: "South African Rand", symbol: "R" },
  { code: "GBP", name: "British Pound", symbol: "Aœ" },
  { code: "EUR", name: "Euro", symbol: "ƒ,ª" },
  { code: "BWP", name: "Botswana Pula", symbol: "P" },
];

export const ZAMBIAN_BANKS = [
  "Absa Bank Zambia",
  "Access Bank Zambia",
  "Atlas Mara (BancABC)",
  "Bank of China (Zambia)",
  "Citibank Zambia",
  "Ecobank Zambia",
  "First Capital Bank",
  "First National Bank (FNB)",
  "Indo-Zambia Bank",
  "Investrust Bank",
  "Stanbic Bank Zambia",
  "Standard Chartered Bank",
  "United Bank for Africa (UBA)",
  "Zambia National Commercial Bank (ZANACO)",
  "Other",
];

export const MOBILE_MONEY_PROVIDERS = [
  "Airtel Money",
  "MTN MoMo",
  "Zamtel Money",
];

export function getPlaceholderName(type: AccountType): string {
  switch (type) {
    case "bank":
      return "e.g. My Checking";
    case "mobile-money":
      return "e.g. Airtel Savings";
    case "cash":
      return "e.g. Wallet Cash";
    case "credit":
      return "e.g. Gold Card";
    case "loan":
      return "e.g. Car Loan";
    case "mortgage":
      return "e.g. Home Mortgage";
    case "other-liability":
      return "e.g. Personal Debt";
    case "investment":
      return "e.g. BOZ Bonds";
    case "vehicle":
      return "e.g. My Car";
    case "property":
      return "e.g. Primary Residence";
    case "other":
      return "e.g. Secret Stash";
    default:
      return "Account Name";
  }
}
