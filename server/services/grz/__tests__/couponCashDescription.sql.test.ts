import { drizzle } from "drizzle-orm/node-postgres";
import type { SQL } from "drizzle-orm";
import type { SelectedFields } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { transactions } from "@shared/schema";
import type { TransactionType } from "../../../utils/withTransaction";
import { identifiedCouponCashForAudit } from "../couponCashDescription";

/** Compile the actual helper's selection using the installed Drizzle builder.
 * The terminal adapter returns rows without invoking a PostgreSQL session.
 */
function compiler(rows: Array<{ id: string; identified: boolean }>) {
  const database = drizzle.mock();
  let generated = "";
  const tx = { select: (fields: SelectedFields) => ({
    from: () => ({ where: (predicate: SQL | undefined) => ({
      limit: (limit: number) => {
        generated = database.select(fields).from(transactions).where(predicate).limit(limit).toSQL().sql;
        return Promise.resolve(rows);
      },
    }) }),
  }) } as unknown as TransactionType;
  return { tx, sql: () => generated };
}

describe("coupon audit identification keeps correlated outer references qualified", () => {
  it("compiles the actual row-locked audit helper without rebinding its outer id or household", async () => {
    const id = "11111111-1111-4111-8111-111111111111", fixture = compiler([{ id, identified: true }]);
    expect(await identifiedCouponCashForAudit(fixture.tx, id)).toBe(true);
    expect(fixture.sql()).toContain('coupon_origin.transaction_id = "transactions"."id"');
    expect(fixture.sql()).toContain('coupon_link.income_transaction_id = "transactions"."id"');
    expect(fixture.sql()).toContain('coupon_bond.household_id = "transactions"."household_id"');
    expect(fixture.sql()).not.toMatch(/coupon_(?:origin|link)\.(?:transaction_id|income_transaction_id) = "id"/);
  });
  it("keeps ordinary unmatched cash outside coupon audit classification", async () => {
    const fixture = compiler([]);
    expect(await identifiedCouponCashForAudit(fixture.tx, "11111111-1111-4111-8111-111111111111")).toBe(false);
  });
});
