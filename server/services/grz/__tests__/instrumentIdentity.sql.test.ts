import { drizzle } from "drizzle-orm/node-postgres";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { investmentTransactions, transactions } from "@shared/schema";
import type { HouseholdContext } from "../../../middleware/householdGuard";
import { investmentNotesProjection } from "../instrumentIdentity";
import { protectedTBillInterestName } from "../couponCashDescription";

const actor = { householdId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222",
  role: "member" } as HouseholdContext;

/** R1-05: drizzle leaves a single-table select list unqualified, so an outer "id" inside
 * a correlated subquery would rebind to the inner table's id and the rule would never match. */
describe("GRZ identity projections keep correlated outer references qualified", () => {
  it("activity notes correlate T-bills and bonds to the outer investment row, not their own columns", () => {
    const query = drizzle.mock().select({ ...getTableColumns(investmentTransactions), notes: investmentNotesProjection(actor) })
      .from(investmentTransactions).toSQL().sql;
    expect(query).toContain('"grz_tbills"."maturity_investment_tx_id" = "investment_transactions"."id"');
    expect(query).toContain('"grz_tbills"."household_id" = "investment_transactions"."household_id"');
    expect(query).toContain('"grz_bonds"."sale_cash_transaction_id" = "investment_transactions"."linked_transaction_id"');
    expect(query).not.toMatch(/= "(?:id|household_id|linked_transaction_id)"/);
  });

  it("the ledger T-bill interest rule correlates to the outer transaction in a single-table select", () => {
    const query = drizzle.mock().select({ id: transactions.id, hidden: protectedTBillInterestName() }).from(transactions).toSQL().sql;
    expect(query).toContain('interest_bill.maturity_income_tx_id = "transactions"."id"');
    expect(query).toContain('interest_custody.household_id = "transactions"."household_id"');
  });
});
