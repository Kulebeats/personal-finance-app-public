/**
 * FIN-05: a transaction DTO carries the row's real currency. When neither the
 * row nor its account names one, the DTO says the unit is unknown; it never
 * defaults to ZMW. Splits use the same unit as their parent.
 */
import { describe, expect, it } from "vitest";
import { mapTransactionMoney } from "../transactions.helpers";

describe("FIN-05 transaction DTO currency", () => {
  it("labels the amount and splits with the row's own currency", () => {
    const dto = mapTransactionMoney({ amount: "12.50", currency: "USD", splits: [{ amount: "2.50" }] });
    expect(dto.amount).toEqual({ amount: "12.50", currency: "USD" });
    expect(dto.splits?.[0].amount).toEqual({ amount: "2.50", currency: "USD" });
  });

  it("falls back to the account currency for the amount and its splits", () => {
    const dto = mapTransactionMoney({ amount: "12.50", currency: null, accountCurrency: "USD", splits: [{ amount: "2.50" }] });
    expect(dto.amount).toEqual({ amount: "12.50", currency: "USD" });
    expect(dto.splits?.[0].amount).toEqual({ amount: "2.50", currency: "USD" });
  });

  it("never invents ZMW when no currency is known", () => {
    const dto = mapTransactionMoney({ amount: "12.50", currency: null, accountCurrency: null, splits: [{ amount: "2.50" }] });
    expect(dto.amount).toEqual({ amount: "12.50", currency: null });
    expect(dto.splits?.[0].amount).toEqual({ amount: "2.50", currency: null });
  });
});
