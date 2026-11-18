/**
 * Receipt parser money-precision tests.
 *
 * The amounts extracted here become persisted pending-receipt/transaction
 * values, so extraction must go through Decimal parsing (parseMoneyString)
 * and produce exact 2-dp money strings.
 */
import { describe, expect, it } from "vitest";
import { calculateConfidence, parseReceiptText } from "./receiptParser";

const RECEIPT = [
  "SHOPRITE LUSAKA",
  "07/01/2026 14:32",
  "Bread 12.50",
  "Milk 18.75",
  "2 x Eggs 30.00",
  "Subtotal: 61.25",
  "VAT: 9.80",
  "Tip: 5.00",
  "Total: 76.05",
].join("\n");

describe("parseReceiptText", () => {
  it("extracts total, subtotal, tax, and tip as canonical 2-dp strings", () => {
    const parsed = parseReceiptText(RECEIPT);

    expect(parsed.amount).toBe("76.05");
    expect(parsed.subtotal).toBe("61.25");
    expect(parsed.tax).toBe("9.80");
    expect(parsed.tip).toBe("5.00");
  });

  it("handles a trailing decimal point captured by the amount regex", () => {
    // (\d+\.?\d*) can capture "76." when OCR drops the cents.
    const parsed = parseReceiptText("STORE\nTotal: 76.");
    expect(parsed.amount).toBe("76.00");
  });

  it("falls back to the largest scanned amount when no total line exists", () => {
    const parsed = parseReceiptText(
      ["CORNER SHOP", "Item A 12.99", "Item B 45.10", "Item C 7.25"].join("\n"),
    );
    expect(parsed.amount).toBe("45.10");
  });

  it("extracts the merchant and line items", () => {
    const parsed = parseReceiptText(RECEIPT);
    expect(parsed.merchantName).toBe("SHOPRITE LUSAKA");
    expect(parsed.lineItems?.length).toBeGreaterThanOrEqual(2);
    expect(parsed.lineItems?.[0]).toMatchObject({
      description: "Bread",
      amount: "12.50",
    });
  });
});

describe("calculateConfidence", () => {
  it("awards the consistency bonus when subtotal + tax + tip equals total", () => {
    const consistent = calculateConfidence({
      merchantName: "SHOPRITE LUSAKA",
      amount: "76.05",
      subtotal: "61.25",
      tax: "9.80",
      tip: "5.00",
      date: new Date().toISOString().slice(0, 10),
      lineItems: [{ description: "Bread", amount: "12.50" }],
    });
    const inconsistent = calculateConfidence({
      merchantName: "SHOPRITE LUSAKA",
      amount: "99.99",
      subtotal: "61.25",
      tax: "9.80",
      tip: "5.00",
      date: new Date().toISOString().slice(0, 10),
      lineItems: [{ description: "Bread", amount: "12.50" }],
    });

    expect(consistent).toBeGreaterThan(inconsistent);
  });

  it("does not lose the bonus to float drift (0.1 + 0.2 class sums)", () => {
    // 10.10 + 0.30 + 0.00 = 10.40 exactly in Decimal; float math gives
    // 10.400000000000002 and a naive Math.abs comparison can leak past 0.02
    // in adversarial cases. The Decimal path must award the bonus.
    const score = calculateConfidence({
      merchantName: "FLOAT MART",
      amount: "10.40",
      subtotal: "10.10",
      tax: "0.30",
      date: new Date().toISOString().slice(0, 10),
    });
    const withoutBonus = calculateConfidence({
      merchantName: "FLOAT MART",
      amount: "10.99",
      subtotal: "10.10",
      tax: "0.30",
      date: new Date().toISOString().slice(0, 10),
    });
    expect(score).toBeGreaterThan(withoutBonus);
  });
});
