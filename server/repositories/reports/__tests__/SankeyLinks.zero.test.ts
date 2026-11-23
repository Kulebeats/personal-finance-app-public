/**
 * NEW-23: zero is not positive. A Sankey flow of zero is no flow, so a group or
 * category that nets to zero, zero savings and no refunds draw no node and no
 * zero-value link.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ db: { select: vi.fn(), execute: vi.fn() } }));

import { db } from "../../../db";
import {
  buildAccountToExpenseGroups,
  buildIncomeToCategories,
  buildIncomeToExpenseGroups,
  type SankeyFilters,
} from "../SankeyHelpers";

const filters: SankeyFilters = {
  householdId: "household-1",
  from: "2026-01-01",
  to: "2026-01-31",
  baseCurrency: "ZMW",
  scope: "household",
  includePending: false,
  includeTransfers: false,
};

// A drizzle select chain whose every step returns itself and resolves to rows.
function rows(data: readonly object[]) {
  const chain: Record<string, unknown> = {};
  for (const step of ["from", "leftJoin", "innerJoin", "where", "groupBy", "orderBy", "limit"]) {
    chain[step] = () => chain;
  }
  chain.then = (resolve: (value: readonly object[]) => unknown) => Promise.resolve(data).then(resolve);
  return chain;
}

function selectReturns(...results: readonly (readonly object[])[]) {
  const select = vi.mocked(db.select);
  for (const result of results) select.mockReturnValueOnce(rows(result) as never);
}

const ids = (nodes: readonly { id: string }[]) => nodes.map((node) => node.id);

describe("Sankey builders draw no zero flow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("draws no node for an expense group that nets to zero", async () => {
    selectReturns([{ amountBase: "500.00" }], [
      { groupId: "housing", groupName: "Housing", groupColor: null, amountBase: "200.00" },
      { groupId: "fees", groupName: "Fees", groupColor: null, amountBase: "0.00" },
    ]);

    const { nodes, links } = await buildIncomeToExpenseGroups(filters, 10, false);

    expect(ids(nodes)).toEqual(["synthetic:income", "categoryGroup:housing"]);
    expect(links).toHaveLength(1);
  });

  it("draws no savings node when income exactly covers spending", async () => {
    selectReturns([{ amountBase: "200.00" }], [
      { groupId: "housing", groupName: "Housing", groupColor: null, amountBase: "200.00" },
    ]);

    const { nodes } = await buildIncomeToExpenseGroups(filters, 10, true);

    expect(ids(nodes)).not.toContain("synthetic:savings");
  });

  it("draws no refunds node, and no savings node for it, when there are no refunds", async () => {
    selectReturns([{ amountBase: "200.00" }], [
      { groupId: "housing", groupName: "Housing", groupColor: null, amountBase: "200.00" },
    ]);

    const { nodes, links } = await buildIncomeToExpenseGroups(filters, 10, true);

    expect(ids(nodes)).toEqual(["synthetic:income", "categoryGroup:housing"]);
    expect(links.every((link) => !link.value.isZero())).toBe(true);
  });

  it("draws no account-to-group link for a group that nets to zero", async () => {
    selectReturns([{ amountBase: "500.00" }], [
      { accountId: "acc-1", accountName: "Checking", accountColor: null, groupId: "housing", groupName: "Housing", groupColor: null, amountBase: "150.00" },
      { accountId: "acc-1", accountName: "Checking", accountColor: null, groupId: "fees", groupName: "Fees", groupColor: null, amountBase: "0.00" },
    ]);

    const { nodes } = await buildAccountToExpenseGroups(filters, 10);

    expect(ids(nodes)).not.toContain("categoryGroup:fees");
    expect(ids(nodes)).toContain("categoryGroup:housing");
  });

  it("draws no node for a category that nets to zero", async () => {
    selectReturns([{ amountBase: "500.00" }], [
      { groupId: "housing", groupName: "Housing", categoryId: "rent", categoryName: "Rent", categoryColor: null, amountBase: "300.00" },
      { groupId: "housing", groupName: "Housing", categoryId: "levy", categoryName: "Levy", categoryColor: null, amountBase: "0.00" },
    ]);

    const { nodes } = await buildIncomeToCategories(filters, 10);

    expect(ids(nodes).some((id) => id.endsWith(":levy"))).toBe(false);
    expect(ids(nodes).some((id) => id.endsWith(":rent"))).toBe(true);
  });
});
