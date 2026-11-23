import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ amount: "1.00", visible: true }));
vi.mock("../../repositories/TransactionSummaryInputs", () => ({
  readTransactionSummaryInputs: async () => ({ currency: "ZMW", rows: state.visible
    ? [{ type: "expense", date: "2026-10-01", amount: state.amount, currency: "ZMW" }] : [] }),
}));
import { getTransactionSummary } from "../transaction/queries";
describe("C2 summary reflects current repository state (UNIT real summary/cache)", () => {
  it("does not serve a cached amount or visibility snapshot on the next request", async () => {
    const read = () => getTransactionSummary("synthetic-c2-household", "synthetic-user", "2026-10-01", "2026-10-31");
    expect((await read()).totalExpenses).toBe("1.00");
    state.amount = "2.00";
    expect((await read()).totalExpenses).toBe("2.00");
    state.visible = false;
    expect((await read()).transactionCount).toBe(0);
  });
});
