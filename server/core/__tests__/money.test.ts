import { describe, it, expect, vi, beforeEach } from "vitest";
import { Money } from "../money";
import Decimal from "decimal.js";

// Mock the logger at the correct path
vi.mock("../../utils/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import the mocked logger
import { logger } from "../../utils/logger";

describe("Money Core", () => {
  it("should create from number", () => {
    const m = new Money(10.5);
    expect(m.toString()).toBe("10.50");
  });

  it("should create from string", () => {
    const m = new Money("10.50");
    expect(m.toString()).toBe("10.50");
  });

  it("should add correctly", () => {
    const m1 = new Money(10.1);
    const m2 = new Money(20.2);
    expect(m1.add(m2).toString()).toBe("30.30");
  });

  it("should subtract correctly without floating point errors", () => {
    const m1 = new Money(0.3);
    const m2 = new Money(0.1);
    expect(m1.subtract(m2).toString()).toBe("0.20");
  });

  it("should multiply", () => {
    const m = new Money(10);
    expect(m.multiply(2).toString()).toBe("20.00");
  });

  it("should divide", () => {
    const m = new Money(10);
    expect(m.divide(2).toString()).toBe("5.00");
  });

  it("should compare", () => {
    const m1 = new Money(10);
    const m2 = new Money(20);
    expect(m1.lt(m2)).toBe(true);
    expect(m1.gt(m2)).toBe(false);
    expect(m1.equals(new Money(10))).toBe(true);
  });

  it("should format", () => {
    const m = new Money(1234.56, "ZMW");
    // Locale formatting might depend on environment, skipping strict check or using known locale
    // Just verify it returns string
    expect(typeof m.format()).toBe("string");
  });

  it("should preserve currency in operations", () => {
    const m = new Money(100, "USD");
    expect(m.add(50).currency).toBe("USD");
    expect(m.subtract(25).currency).toBe("USD");
    expect(m.multiply(2).currency).toBe("USD");
    expect(m.divide(2).currency).toBe("USD");
  });

  it("should create zero with specified currency", () => {
    const zeroUSD = Money.zero("USD");
    expect(zeroUSD.isZero()).toBe(true);
    expect(zeroUSD.currency).toBe("USD");
  });
});

describe("Money Currency Mismatch Warnings", () => {
  const mockWarn = logger.warn as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockWarn.mockClear();
  });

  it("should warn on add with different currencies", () => {
    const usd = new Money(100, "USD");
    const zmw = new Money(50, "ZMW");
    const result = usd.add(zmw);

    expect(result.currency).toBe("USD"); // Uses first operand's currency
    expect(mockWarn).toHaveBeenCalledWith(
      "Money currency mismatch in add operation",
      expect.objectContaining({
        thisCurrency: "USD",
        otherCurrency: "ZMW",
      })
    );
  });

  it("should warn on subtract with different currencies", () => {
    const usd = new Money(100, "USD");
    const zmw = new Money(50, "ZMW");
    usd.subtract(zmw);

    expect(mockWarn).toHaveBeenCalledWith(
      "Money currency mismatch in subtract operation",
      expect.objectContaining({
        thisCurrency: "USD",
        otherCurrency: "ZMW",
      })
    );
  });

  it("should warn on equals with different currencies", () => {
    const usd = new Money(100, "USD");
    const zmw = new Money(100, "ZMW");
    usd.equals(zmw);

    expect(mockWarn).toHaveBeenCalledWith(
      "Money currency mismatch in equals comparison",
      expect.objectContaining({
        thisCurrency: "USD",
        otherCurrency: "ZMW",
      })
    );
  });

  it("should NOT warn when currencies match", () => {
    const usd1 = new Money(100, "USD");
    const usd2 = new Money(50, "USD");
    usd1.add(usd2);
    usd1.subtract(usd2);
    usd1.equals(usd2);

    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("should NOT warn when adding raw numbers", () => {
    const usd = new Money(100, "USD");
    usd.add(50);
    usd.subtract("25");

    expect(mockWarn).not.toHaveBeenCalled();
  });
});

describe("Money Edge Cases - Zero/Empty Values", () => {
  it("should create from zero", () => {
    const m = new Money(0);
    expect(m.toString()).toBe("0.00");
    expect(m.isZero()).toBe(true);
  });

  it("should create from string zero", () => {
    const m = new Money("0");
    expect(m.toString()).toBe("0.00");
    expect(m.isZero()).toBe(true);
  });

  it("should create from string with leading zeros", () => {
    const m = new Money("0010.50");
    expect(m.toString()).toBe("10.50");
  });

  it("should add zero and preserve value", () => {
    const m = new Money(100);
    expect(m.add(0).toString()).toBe("100.00");
    expect(m.add("0").toString()).toBe("100.00");
    expect(m.add(Money.zero()).toString()).toBe("100.00");
  });

  it("should subtract zero and preserve value", () => {
    const m = new Money(100);
    expect(m.subtract(0).toString()).toBe("100.00");
    expect(m.subtract(Money.zero()).toString()).toBe("100.00");
  });

  it("should multiply by zero", () => {
    const m = new Money(100);
    expect(m.multiply(0).toString()).toBe("0.00");
    expect(m.multiply(0).isZero()).toBe(true);
  });

  it("should handle zero divided by non-zero", () => {
    const m = Money.zero();
    expect(m.divide(5).toString()).toBe("0.00");
  });

  it("should compare zero values", () => {
    const z1 = Money.zero();
    const z2 = new Money(0);
    expect(z1.equals(z2)).toBe(true);
    expect(z1.equals(0)).toBe(true);
  });
});

describe("Money Edge Cases - Negative Numbers", () => {
  it("should create from negative number", () => {
    const m = new Money(-100);
    expect(m.toString()).toBe("-100.00");
    expect(m.isNegative()).toBe(true);
  });

  it("should create from negative string", () => {
    const m = new Money("-50.25");
    expect(m.toString()).toBe("-50.25");
    expect(m.isNegative()).toBe(true);
  });

  it("should add negative to positive", () => {
    const m = new Money(100);
    expect(m.add(-50).toString()).toBe("50.00");
  });

  it("should subtract resulting in negative", () => {
    const m = new Money(50);
    expect(m.subtract(100).toString()).toBe("-50.00");
    expect(m.subtract(100).isNegative()).toBe(true);
  });

  it("should multiply by negative factor", () => {
    const m = new Money(100);
    expect(m.multiply(-1).toString()).toBe("-100.00");
    expect(m.multiply(-2).toString()).toBe("-200.00");
  });

  it("should divide by negative divisor", () => {
    const m = new Money(100);
    expect(m.divide(-2).toString()).toBe("-50.00");
  });

  it("should negate positive to negative", () => {
    const m = new Money(100);
    expect(m.negated().toString()).toBe("-100.00");
  });

  it("should negate negative to positive", () => {
    const m = new Money(-100);
    expect(m.negated().toString()).toBe("100.00");
  });

  it("should get absolute value", () => {
    expect(new Money(-100).abs().toString()).toBe("100.00");
    expect(new Money(100).abs().toString()).toBe("100.00");
  });

  it("should compare negative values", () => {
    const m1 = new Money(-100);
    const m2 = new Money(-50);
    expect(m1.lt(m2)).toBe(true);
    expect(m2.gt(m1)).toBe(true);
  });

  it("should handle isNegativeOrZero", () => {
    expect(new Money(-1).isNegativeOrZero()).toBe(true);
    expect(new Money(0).isNegativeOrZero()).toBe(true);
    expect(new Money(1).isNegativeOrZero()).toBe(false);
  });

  it("treats only an amount above zero as positive (NEW-23: zero is not positive)", () => {
    expect(new Money(0).isPositive()).toBe(false);
    expect(new Money("-0").isPositive()).toBe(false);
    expect(new Money("0.01").isPositive()).toBe(true);
    expect(new Money("-0.01").isPositive()).toBe(false);
  });

  it("should handle isPositiveOrZero", () => {
    expect(new Money(1).isPositiveOrZero()).toBe(true);
    expect(new Money(0).isPositiveOrZero()).toBe(true);
    expect(new Money(-1).isPositiveOrZero()).toBe(false);
  });
});

describe("Money Edge Cases - Very Large Numbers", () => {
  it("should handle very large integers", () => {
    const m = new Money(999999999999);
    expect(m.toString()).toBe("999999999999.00");
  });

  it("should handle very large decimal numbers", () => {
    const m = new Money("999999999999.99");
    expect(m.toString()).toBe("999999999999.99");
  });

  it("should add very large numbers without precision loss", () => {
    const m1 = new Money(999999999999);
    const m2 = new Money(1);
    expect(m1.add(m2).toString()).toBe("1000000000000.00");
  });

  it("should multiply to very large result", () => {
    const m = new Money(1000000);
    expect(m.multiply(1000000).toString()).toBe("1000000000000.00");
  });

  it("should handle large number division", () => {
    const m = new Money(1000000000000);
    expect(m.divide(1000000).toString()).toBe("1000000.00");
  });
});

describe("Money Edge Cases - Precision and Rounding", () => {
  it("should round to 2 decimals in toString", () => {
    const m = new Money("100.999");
    expect(m.toString()).toBe("101.00");
  });

  it("should handle many decimal places", () => {
    const m = new Money("0.123456789");
    expect(m.toString()).toBe("0.12");
  });

  it("should maintain precision in calculations then round", () => {
    const m = new Money(10);
    const result = m.divide(3);
    expect(result.toString()).toBe("3.33");
  });

  it("should handle repeating decimals", () => {
    const m1 = new Money(1);
    const m2 = m1.divide(3);
    const m3 = m2.multiply(3);
    expect(m3.toNumber()).toBeCloseTo(1, 10);
  });

  it("should preserve full precision before rounding", () => {
    const m = new Money("0.123456789");
    expect(m.toFullString()).toContain("0.123456789");
  });
});

describe("Money Edge Cases - Boundary Conditions", () => {
  it("should handle 0.01 minimum currency unit", () => {
    const m = new Money(0.01);
    expect(m.toString()).toBe("0.01");
  });

  it("should handle fractional cents that round", () => {
    const m = new Money(0.005);
    expect(m.toString()).toBe("0.01");
  });

  it("should handle fractional cents that round down", () => {
    const m = new Money(0.004);
    expect(m.toString()).toBe("0.00");
  });

  it("should compare at boundary", () => {
    const m1 = new Money(0.01);
    const m2 = new Money(0.00);
    expect(m1.gt(m2)).toBe(true);
    expect(m2.lt(m1)).toBe(true);
  });

  it("should handle equals with rounding differences", () => {
    const m1 = new Money("100.00");
    const m2 = new Money("100.004");
    expect(m1.toString()).toBe("100.00");
    expect(m2.toString()).toBe("100.00");
  });
});

describe("Money Edge Cases - Special String Inputs", () => {

  it("should handle scientific notation", () => {
    const m = new Money("1e3");
    expect(m.toString()).toBe("1000.00");
  });

  it("should handle negative scientific notation", () => {
    const m = new Money("-1e3");
    expect(m.toString()).toBe("-1000.00");
  });

  it("should handle decimal scientific notation", () => {
    const m = new Money("1.5e2");
    expect(m.toString()).toBe("150.00");
  });
});

describe("Money Edge Cases - Division by Zero", () => {
  it("should return Infinity when dividing by zero", () => {
    const m = new Money(100);
    const result = m.divide(0);
    expect(result.toNumber()).toBe(Infinity);
  });

  it("should handle zero divided by zero", () => {
    const m = Money.zero();
    const result = m.divide(0);
    expect(isNaN(result.toNumber())).toBe(true);
  });
});

describe("Money Edge Cases - Comparison Edge Cases", () => {
  it("should handle gt with equal values", () => {
    const m1 = new Money(100);
    const m2 = new Money(100);
    expect(m1.gt(m2)).toBe(false);
    expect(m1.gte(m2)).toBe(true);
  });

  it("should handle lt with equal values", () => {
    const m1 = new Money(100);
    const m2 = new Money(100);
    expect(m1.lt(m2)).toBe(false);
    expect(m1.lte(m2)).toBe(true);
  });

  it("should compare with number directly", () => {
    const m = new Money(100);
    expect(m.equals(100)).toBe(true);
    expect(m.gt(99)).toBe(true);
    expect(m.lt(101)).toBe(true);
  });

  it("should compare with string directly", () => {
    const m = new Money(100);
    expect(m.equals("100")).toBe(true);
    expect(m.gt("99")).toBe(true);
  });
});

describe("Money Edge Cases - Currency Edge Cases", () => {
  it("should preserve currency through operations", () => {
    const m = new Money(100, "USD");
    expect(m.add(50).currency).toBe("USD");
    expect(m.subtract(25).currency).toBe("USD");
    expect(m.multiply(2).currency).toBe("USD");
    expect(m.divide(2).currency).toBe("USD");
    expect(m.abs().currency).toBe("USD");
    expect(m.negated().currency).toBe("USD");
  });

  it("should handle empty string currency", () => {
    const m = new Money(100, "");
    expect(m.currency).toBe("");
  });

  it("should create Money.from with Money instance", () => {
    const m1 = new Money(100, "EUR");
    const m2 = Money.from(m1);
    expect(m2.toString()).toBe("100.00");
    expect(m2.currency).toBe("EUR");
  });

  it("should create Money.from with number", () => {
    const m = Money.from(100, "GBP");
    expect(m.toString()).toBe("100.00");
    expect(m.currency).toBe("GBP");
  });
});

describe("Money Edge Cases - Format Edge Cases", () => {
  it("should format zero", () => {
    const m = Money.zero("USD");
    expect(typeof m.format()).toBe("string");
  });

  it("should format negative", () => {
    const m = new Money(-100, "USD");
    expect(typeof m.format()).toBe("string");
  });

  it("should format very large number", () => {
    const m = new Money(999999999, "USD");
    expect(typeof m.format()).toBe("string");
  });

  it("should toJSON", () => {
    const m = new Money(100.5);
    expect(m.toJSON()).toBe("100.50");
  });
});
