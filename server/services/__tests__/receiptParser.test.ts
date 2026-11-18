import { describe, it, expect } from "vitest";
import { parseReceiptText, calculateConfidence } from "../receiptParser";

describe("Receipt Parser", () => {
  describe("parseReceiptText", () => {
    it("should extract merchant name from simple receipt", () => {
      const text = `
        TARGET
        123 Main St
        Minneapolis, MN
        
        Date: 12/25/2023
        
        Item 1      $10.00
        Item 2      $20.00
        
        Total       $30.00
      `;

      const result = parseReceiptText(text);
      expect(result.merchantName).toBe("TARGET");
    });

    it("should extract date formats correctly", () => {
      const texts = [
        "Date: 12/25/2023",
        "Date: 12-25-2023",
        "Dec 25, 2023",
        "12/25/23",
      ];

      const expectedDate = "2023-12-25";

      texts.forEach((t) => {
        expect(parseReceiptText(t).date).toBe(expectedDate);
      });
    });

    it("should extract total amount", () => {
      const text = `
        Subtotal: $25.00
        Tax: $2.00
        Total: $27.00
      `;
      expect(parseReceiptText(text).amount).toBe("27.00");
    });

    it("should extract line items", () => {
      const text = `
        Milk        $4.00
        Bread       $3.00
        2 x Eggs    $10.00
      `;
      const result = parseReceiptText(text);
      expect(result.lineItems).toHaveLength(3);
      expect(result.lineItems?.[0]).toEqual({
        description: "Milk",
        amount: "4.00",
      });
      expect(result.lineItems?.[1]).toEqual({
        description: "Bread",
        amount: "3.00",
      });
      expect(result.lineItems?.[2]).toEqual({
        description: "Eggs",
        amount: "10.00",
        quantity: 2,
      });
    });
  });

  describe("calculateConfidence", () => {
    it("should calculate high score for complete data", () => {
      const data = {
        merchantName: "Target",
        amount: "50.00",
        date: new Date().toISOString().split("T")[0],
        lineItems: [{ description: "Item", amount: "50.00" }],
        tax: "0.00",
        subtotal: "50.00",
      };

      const score = calculateConfidence(data);
      expect(score).toBeGreaterThan(80);
    });

    it("should return low score for empty data", () => {
      const score = calculateConfidence({});
      expect(score).toBe(0);
    });
  });

  describe("currency detection", () => {
    it("should detect USD from dollar sign", () => {
      const text = `
        STORE NAME
        Item 1      $10.00
        Total       $10.00
      `;
      const result = parseReceiptText(text);
      expect(result.currency).toBe("USD");
    });

    it("should detect USD from USD text", () => {
      const text = `
        STORE NAME
        Item 1      10.00 USD
        Total       10.00
      `;
      const result = parseReceiptText(text);
      expect(result.currency).toBe("USD");
    });

    it("should detect ZMW from K symbol", () => {
      const text = `
        SHOPRITE ZAMBIA
        Item 1      K 150.00
        Total       K 150.00
      `;
      const result = parseReceiptText(text);
      expect(result.currency).toBe("ZMW");
    });

    it("should detect ZMW from ZMW text", () => {
      const text = `
        SHOPRITE ZAMBIA
        Item 1      150.00 ZMW
        Total       150.00
      `;
      const result = parseReceiptText(text);
      expect(result.currency).toBe("ZMW");
    });

    it("should detect ZMW from Kwacha text", () => {
      const text = `
        SHOPRITE ZAMBIA
        Amount: 150 Kwacha
        Total       150.00
      `;
      const result = parseReceiptText(text);
      expect(result.currency).toBe("ZMW");
    });

    it("should detect EUR from euro symbol", () => {
      const text = `
        CARREFOUR PARIS
        Item 1      €10.00
        Total       €10.00
      `;
      const result = parseReceiptText(text);
      expect(result.currency).toBe("EUR");
    });

    it("should detect EUR from EUR text", () => {
      const text = `
        CARREFOUR PARIS
        Item 1      10.00 EUR
        Total       10.00
      `;
      const result = parseReceiptText(text);
      expect(result.currency).toBe("EUR");
    });

    it("should detect GBP from pound symbol", () => {
      const text = `
        TESCO LONDON
        Item 1      £10.00
        Total       £10.00
      `;
      const result = parseReceiptText(text);
      expect(result.currency).toBe("GBP");
    });

    it("should detect GBP from GBP text", () => {
      const text = `
        TESCO LONDON
        Item 1      10.00 GBP
        Total       10.00
      `;
      const result = parseReceiptText(text);
      expect(result.currency).toBe("GBP");
    });

    it("should detect ZAR from R symbol", () => {
      const text = `
        WOOLWORTHS SA
        Item 1      R 150.00
        Total       R 150.00
      `;
      const result = parseReceiptText(text);
      expect(result.currency).toBe("ZAR");
    });

    it("should detect ZAR from ZAR text", () => {
      const text = `
        WOOLWORTHS SA
        Item 1      150.00 ZAR
        Total       150.00
      `;
      const result = parseReceiptText(text);
      expect(result.currency).toBe("ZAR");
    });

    it("should use household currency as fallback when no currency detected", () => {
      const text = `
        STORE NAME
        Item 1      10.00
        Total       10.00
      `;
      const result = parseReceiptText(text, "GBP");
      expect(result.currency).toBe("GBP");
    });

    it("should default to USD when no currency detected and no fallback", () => {
      const text = `
        STORE NAME
        Item 1      10.00
        Total       10.00
      `;
      const result = parseReceiptText(text);
      expect(result.currency).toBe("USD");
    });

    it("should prioritize detected currency over household fallback", () => {
      const text = `
        TESCO LONDON
        Item 1      £10.00
        Total       £10.00
      `;
      const result = parseReceiptText(text, "USD");
      expect(result.currency).toBe("GBP");
    });
  });
});
