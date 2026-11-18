/**
 * Receipt Parser - Extract structured data from OCR text
 * This runs on client-side with Tesseract.js results
 */

export interface OcrExtractedData {
  merchantName?: string;
  amount?: string;
  date?: string;
  subtotal?: string;
  tax?: string;
  tip?: string;
  lineItems?: OcrLineItem[];
  rawText?: string;
  currency?: string;
  paymentMethod?: string;
}

export interface OcrLineItem {
  description: string;
  amount: string;
  quantity?: number;
  suggestedCategoryId?: string;
}

import { Money } from "../core/money";

/**
 * Parse structured data from raw OCR text
 * @param rawText - The raw OCR text to parse
 * @param householdCurrency - Optional fallback currency if detection fails (default: "USD")
 */
export function parseReceiptText(rawText: string, householdCurrency?: string): OcrExtractedData {
  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const detectedCurrency = detectCurrency(lines);

  return {
    merchantName: extractMerchantName(lines),
    amount: extractTotal(lines),
    date: extractDate(lines),
    subtotal: extractSubtotal(lines),
    tax: extractTax(lines),
    tip: extractTip(lines),
    lineItems: extractLineItems(lines),
    rawText,
    currency: detectedCurrency || householdCurrency || "USD",
  };
}

/**
 * Detect currency from OCR text based on common patterns
 */
function detectCurrency(lines: string[]): string | undefined {
  const text = lines.join(" ");

  // Currency detection patterns (order matters - more specific first)
  const currencyPatterns: Array<{ pattern: RegExp; currency: string }> = [
    // Zambian Kwacha
    { pattern: /\bZMW\b/i, currency: "ZMW" },
    { pattern: /\bK\s*\d/i, currency: "ZMW" },
    { pattern: /\bKwacha\b/i, currency: "ZMW" },
    // Euro
    { pattern: /\bEUR\b/i, currency: "EUR" },
    { pattern: /€\s*\d/, currency: "EUR" },
    // British Pound
    { pattern: /\bGBP\b/i, currency: "GBP" },
    { pattern: /£\s*\d/, currency: "GBP" },
    // US Dollar (check last as $ is common)
    { pattern: /\bUSD\b/i, currency: "USD" },
    { pattern: /\$\s*\d/, currency: "USD" },
    // South African Rand
    { pattern: /\bZAR\b/i, currency: "ZAR" },
    { pattern: /\bR\s*\d/, currency: "ZAR" },
  ];

  for (const { pattern, currency } of currencyPatterns) {
    if (pattern.test(text)) {
      return currency;
    }
  }

  return undefined;
}

function extractMerchantName(lines: string[]): string | undefined {
  for (const line of lines.slice(0, 5)) {
    // Skip date/time lines
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(line)) continue;
    if (/^\d{1,2}:\d{2}/.test(line)) continue;

    if (line.length > 3 && line.length < 50) {
      const upperRatio = (line.match(/[A-Z]/g) || []).length / line.length;
      if (upperRatio > 0.3 || /^[A-Z]/.test(line)) {
        return line.replace(/[#*]/g, "").trim();
      }
    }
  }
  return lines[0]?.slice(0, 50);
}

function extractTotal(lines: string[]): string | undefined {
  const totalPatterns = [
    /(?:grand\s*)?total\s*[:\$]?\s*\$?(\d+\.?\d*)/i,
    /(?:amount\s*(?:due|paid)?)\s*[:\$]?\s*\$?(\d+\.?\d*)/i,
    /balance\s*[:\$]?\s*\$?(\d+\.?\d*)/i,
  ];

  // Search from bottom up (total usually at end)
  for (let i = lines.length - 1; i >= 0; i--) {
    for (const pattern of totalPatterns) {
      const match = lines[i].match(pattern);
      if (match) {
        return new Money(match[1]).toString();
      }
    }
  }

  // Fallback: find largest dollar amount
  const amounts = lines
    .join(" ")
    .match(/\$?\d+\.\d{2}/g)
    ?.map((a) => new Money(a.replace("$", "")))
    .filter((m) => m.isPositive() && m.toNumber() < 10000);

  if (amounts?.length) {
    // Find max amount
    let max = amounts[0];
    for (const amt of amounts) {
      if (amt.gt(max)) max = amt;
    }
    return max.toString();
  }

  return undefined;
}

function extractDate(lines: string[]): string | undefined {
  const datePatterns = [
    // MM/DD/YYYY or MM-DD-YYYY
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,
    // MM/DD/YY
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})\b/,
    // Month DD, YYYY
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i,
  ];

  const monthMap: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };

  for (const line of lines) {
    // Pattern 1: MM/DD/YYYY
    let match = line.match(datePatterns[0]);
    if (match) {
      const [, month, day, year] = match;
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }

    // Pattern 2: MM/DD/YY
    match = line.match(datePatterns[1]);
    if (match) {
      const [, month, day, year] = match;
      const fullYear = parseInt(year) > 50 ? `19${year}` : `20${year}`;
      return `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }

    // Pattern 3: Month DD, YYYY
    match = line.match(datePatterns[2]);
    if (match) {
      const [, monthName, day, year] = match;
      const month = monthMap[monthName.toLowerCase().slice(0, 3)];
      return `${year}-${month}-${day.padStart(2, "0")}`;
    }
  }

  return undefined;
}

function extractSubtotal(lines: string[]): string | undefined {
  const pattern = /sub\s*total\s*[:\$]?\s*\$?(\d+\.?\d*)/i;
  for (const line of lines) {
    const match = line.match(pattern);
    if (match) {
      return new Money(match[1]).toString();
    }
  }
  return undefined;
}

function extractTax(lines: string[]): string | undefined {
  const patterns = [
    /(?:sales\s*)?tax\s*[:\$]?\s*\$?(\d+\.?\d*)/i,
    /(?:hst|gst|pst|vat)\s*[:\$]?\s*\$?(\d+\.?\d*)/i,
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        return new Money(match[1]).toString();
      }
    }
  }
  return undefined;
}

function extractTip(lines: string[]): string | undefined {
  const patterns = [/(?:tip|gratuity)\s*[:\$]?\s*\$?(\d+\.?\d*)/i];

  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        const amount = new Money(match[1]);
        if (amount.isPositive()) {
          return amount.toString();
        }
      }
    }
  }
  return undefined;
}

function extractLineItems(lines: string[]): OcrLineItem[] {
  const items: OcrLineItem[] = [];
  const itemPattern = /^(.+?)\s+\$?(\d+\.\d{2})\s*$/;
  const qtyPattern = /^(\d+)\s*[x×@]\s*(.+?)\s+\$?(\d+\.\d{2})\s*$/i;

  for (const line of lines) {
    // Skip total/subtotal/tax lines
    if (
      /total|subtotal|tax|tip|balance|change|cash|card|visa|master/i.test(line)
    ) {
      continue;
    }

    // Try quantity pattern first
    let match = line.match(qtyPattern);
    if (match) {
      items.push({
        description: match[2].trim(),
        amount: match[3],
        quantity: parseInt(match[1]),
      });
      continue;
    }

    // Try simple item pattern
    match = line.match(itemPattern);
    if (match) {
      const desc = match[1].trim();
      if (desc.length > 2 && desc.length < 50 && !/^\d+$/.test(desc)) {
        items.push({
          description: desc,
          amount: match[2],
        });
      }
    }
  }

  return items;
}

/**
 * Calculate confidence score based on extracted data quality
 */
export function calculateConfidence(data: OcrExtractedData): number {
  let score = 0;
  let maxScore = 0;

  // Merchant name (20 points)
  maxScore += 20;
  if (data.merchantName && data.merchantName.length > 2) {
    score += 20;
  }

  // Amount (30 points)
  maxScore += 30;
  if (data.amount) {
    const amount = new Money(data.amount);
    if (amount.isPositive() && amount.toNumber() < 10000) {
      score += 30;
    } else if (amount.isPositive()) {
      score += 15;
    }
  }

  // Date (25 points)
  maxScore += 25;
  if (data.date) {
    const date = new Date(data.date);
    const now = new Date();
    const daysDiff = Math.abs(
      (now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000)
    );

    if (daysDiff <= 30) {
      score += 25;
    } else if (daysDiff <= 365) {
      score += 15;
    } else {
      score += 5;
    }
  }

  // Line items (15 points)
  maxScore += 15;
  if (data.lineItems && data.lineItems.length > 0) {
    score += Math.min(15, data.lineItems.length * 3);
  }

  // Tax/subtotal consistency (10 points)
  maxScore += 10;
  if (data.subtotal && data.tax && data.amount) {
    const subtotal = new Money(data.subtotal);
    const tax = new Money(data.tax);
    const total = new Money(data.amount);
    const tip = data.tip ? new Money(data.tip) : Money.zero();

    const calculated = subtotal.add(tax).add(tip);
    const diff = calculated.subtract(total).abs();

    if (diff.lt(0.02)) {
      score += 10;
    }
  }

  return Math.round((score / maxScore) * 100);
}
