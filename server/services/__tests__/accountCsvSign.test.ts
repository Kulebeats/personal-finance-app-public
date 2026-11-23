import { describe, expect, it } from "vitest";
import { Money } from "../../core/money";
import {
  calculateSignedAccountEffect,
  type PostingAccount,
  type PostingInput,
} from "../../repositories/TransactionPostingEffect";
import { accountCsvAmount, importDirection } from "../account/accountCsvSign";

// FIN-04: the account export writes a signed amount that the account import
// turns back into a row with the same effect on the same account.
const asset: PostingAccount = { id: "a", householdId: "h", currency: "ZMW", isAsset: true };
const liability: PostingAccount = { id: "l", householdId: "h", currency: "ZMW", isAsset: false };

const rows: Array<[string, PostingInput, string, string]> = [
  // [label, stored row, CSV amount on an asset, CSV amount on a liability]
  ["income", { type: "income", amount: "1500.00" }, "1500.00", "1500.00"],
  ["expense", { type: "expense", amount: "58.12" }, "-58.12", "-58.12"],
  ["transfer in", { type: "transfer", amount: "20.00", isTransferIn: true }, "20.00", "20.00"],
  ["transfer out", { type: "transfer", amount: "20.00", isTransferIn: false }, "-20.00", "-20.00"],
  ["asset settlement", { type: "asset_settlement", amount: "300.00" }, "300.00", "300.00"],
  ["balance increase", { type: "balance_adjustment", amount: "7.00", isBalanceAdjustmentIncrease: true }, "7.00", "-7.00"],
  ["balance decrease", { type: "balance_adjustment", amount: "7.00", isBalanceAdjustmentIncrease: false }, "-7.00", "7.00"],
];

describe("FIN-04 account CSV sign rule", () => {
  it.each(rows)("writes %s by direction, whatever the account class", (_label, row, onAsset, onLiability) => {
    expect(accountCsvAmount(asset, row).toString()).toBe(onAsset);
    expect(accountCsvAmount(liability, row).toString()).toBe(onLiability);
  });

  it("imports a negative amount as an expense and a positive one as income", () => {
    expect(importDirection(new Money("-58.12", "ZMW"))).toBe("expense");
    expect(importDirection(new Money("1500.00", "ZMW"))).toBe("income");
  });

  it.each(rows)("re-imports an exported %s with the same effect on asset and liability accounts", (_label, row) => {
    for (const account of [asset, liability]) {
      const csv = accountCsvAmount(account, row);
      const reimported: PostingInput = { type: importDirection(csv), amount: csv.abs().toString() };
      expect(calculateSignedAccountEffect(account, reimported).toString())
        .toBe(calculateSignedAccountEffect(account, row).toString());
    }
  });
});
