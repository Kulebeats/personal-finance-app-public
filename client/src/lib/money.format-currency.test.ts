import { describe, expect, it } from "vitest";
import { formatCurrency } from "./money";

// Intl separates the symbol with a no-break space for some currencies.
const shown = (text: string) => text.replace(/ /g, " ");

describe("formatCurrency shows each currency's own minor units", () => {
  it("keeps kwacha to the ngwee", () => {
    expect(shown(formatCurrency({ amount: "42.50", currency: "ZMW" }))).toBe("K 42.50");
  });

  it("shows yen with no decimals", () => {
    expect(formatCurrency({ amount: "4250", currency: "JPY" })).toBe("JP¥4,250");
  });

  it("shows Kuwaiti dinar to three decimals", () => {
    expect(shown(formatCurrency({ amount: "12.5", currency: "KWD" }))).toBe("KWD 12.500");
    expect(shown(formatCurrency({ amount: "1.234", currency: "KWD" }))).toBe("KWD 1.234");
  });

  it("uses the currency passed with a bare amount", () => {
    expect(formatCurrency(4250, "JPY")).toBe("JP¥4,250");
    expect(formatCurrency("42.5", "USD")).toBe("US$42.50");
  });

  it("shows an amount with no known currency as a plain number to the cent", () => {
    expect(formatCurrency({ amount: "42.5", currency: null as unknown as string })).toBe("42.50");
  });
});
