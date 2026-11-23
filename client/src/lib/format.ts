/**
 * Currency symbol mapping for supported currencies
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  ZMW: "K",    // Zambian Kwacha
  USD: "$",    // US Dollar
  ZAR: "R",    // South African Rand
  GBP: "£",    // British Pound
  EUR: "€",    // Euro
  BWP: "P",    // Botswana Pula
};

/**
 * Get the display symbol for a currency code
 */
export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] || currency;
}

/**
 * Format a number as currency based on user settings
 */
export function formatCurrency(
  amount: number,
  currency: string = "ZMW",
  numberFormat: string = "US"
): string {
  const absAmount = Math.abs(amount);
  const symbol = getCurrencySymbol(currency);

  const formatted = absAmount.toLocaleString(numberFormat === "EU" ? "de-DE" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // Add currency symbol
  const sign = amount < 0 ? "-" : "";
  return `${sign}${symbol}${formatted}`;
}

/**
 * Format a date based on user settings
 */
export function formatDate(
  date: Date | string,
  dateFormat: string = "MM/DD/YYYY"
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  
  switch (dateFormat) {
    case "DD/MM/YYYY":
      return `${day}/${month}/${year}`;
    case "YYYY-MM-DD":
      return `${year}-${month}-${day}`;
    case "MM/DD/YYYY":
    default:
      return `${month}/${day}/${year}`;
  }
}

/**
 * Format a date and time based on user settings
 */
export function formatDateTime(
  date: Date | string,
  dateFormat: string = "MM/DD/YYYY"
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  
  const dateStr = formatDate(d, dateFormat);
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  
  return `${dateStr} ${hours}:${minutes}`;
}

/**
 * Parse a number string based on user's number format
 */
export function parseNumber(value: string, numberFormat: string = "US"): number {
  if (numberFormat === "EU") {
    // European format: 1.000,00 -> 1000.00
    return parseFloat(value.replace(/\./g, "").replace(",", "."));
  } else {
    // US format: 1,000.00 -> 1000.00
    return parseFloat(value.replace(/,/g, ""));
  }
}
