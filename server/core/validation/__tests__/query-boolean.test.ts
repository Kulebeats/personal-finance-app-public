/**
 * NEW-36: every boolean flag parsed from a query string (or a form body) reads "false" as
 * false and refuses anything that is not a boolean. `z.coerce.boolean()` turned "false"
 * into true. Each case is a real schema used by a route.
 */
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import {
  accountQuerySchema, balanceAdjustmentSchema, transactionImportSchema,
} from "../../../modules/accounts/accounts.validation";
import { categoryQuerySchema } from "../../../modules/categories/categories.validation";
import { listTaxLotsQuerySchema } from "../../../modules/investments/investments.validation";
import { notificationQuerySchema } from "../../../modules/notifications/notifications.validation";

const UUID = "00000000-0000-4000-8000-000000000001";
const cases: Array<{ name: string; schema: ZodTypeAny; field: string; base: Record<string, unknown> }> = [
  { name: "accounts includeArchived", schema: accountQuerySchema, field: "includeArchived", base: {} },
  { name: "accounts includeHidden", schema: accountQuerySchema, field: "includeHidden", base: {} },
  { name: "accounts adjust isIncrease", schema: balanceAdjustmentSchema, field: "isIncrease", base: { amount: "10.00" } },
  { name: "accounts import adjustBalance", schema: transactionImportSchema, field: "adjustBalance", base: { transactions: [] } },
  { name: "categories includeArchived", schema: categoryQuerySchema, field: "includeArchived", base: {} },
  { name: "investments includeDisposals", schema: listTaxLotsQuerySchema, field: "includeDisposals", base: { holdingId: UUID } },
  { name: "notifications unreadOnly", schema: notificationQuerySchema, field: "unreadOnly", base: {} },
];

describe("NEW-36 strict boolean flags", () => {
  it.each(cases)("$name: \"false\" is false, \"true\" is true, booleans pass", ({ schema, field, base }) => {
    const parse = (value: unknown) => schema.parse({ ...base, [field]: value })[field];
    expect(parse("false")).toBe(false);
    expect(parse("true")).toBe(true);
    expect(parse(false)).toBe(false);
    expect(parse(true)).toBe(true);
  });

  it.each(cases)("$name: refuses a value that is not a boolean", ({ schema, field, base }) => {
    for (const value of ["yes", "", "False", "2"]) {
      expect(schema.safeParse({ ...base, [field]: value }).success).toBe(false);
    }
  });
});
