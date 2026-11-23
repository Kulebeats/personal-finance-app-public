import { db } from "../../db";
import { sql, and, eq } from "drizzle-orm";
import {
  transactions,
  categories,
  categoryGroups,
  accounts,
  transactionSplits,
} from "@shared/schema";
import { Money } from "../../core/money";
import { moneyFromValue } from "./moneyUtils";
import { buildFxRateExpr } from "./fxRateExpr";
import { allocationAmount, allocationCategoryId, splitAllocationJoin } from "./splitAllocation";
import {
  buildSankeyBaseConditions,
  calculateTotalIncome,
  getExpenseTypeCondition,
  getIncomeTypeCondition,
  type SankeyFilters,
  type SankeyNode,
  type SankeyLink,
  type GroupTotal,
  type CategoryTotal,
} from "./SankeyNodes";

export async function buildIncomeToExpenseGroups(
  filters: SankeyFilters,
  maxNodes: number,
  includeSavingsNode: boolean,
): Promise<{
  nodes: SankeyNode[];
  links: SankeyLink[];
  totalIncome: Money;
  totalExpenses: Money;
}> {
  const baseConditions = buildSankeyBaseConditions(filters);
  const incomeTypeCondition = getIncomeTypeCondition(filters.includeTransfers);
  const expenseTypeCondition = getExpenseTypeCondition(
    filters.includeTransfers,
  );
  const currencyExpr = sql`COALESCE(${transactions.currency}, ${accounts.currency}, ${filters.baseCurrency}::text)`;
  const fxRateExpr = buildFxRateExpr(
    currencyExpr,
    filters.baseCurrency,
    sql`${transactions.date}`, { householdId: filters.householdId },
  );
  const amountBaseExpr = sql<
    string | number | null
  >`${transactions.amount}::numeric * ${fxRateExpr}`;

  const incomeRows = await db
    .select({
      amountBase: amountBaseExpr,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(...baseConditions, incomeTypeCondition));

  const expenseRows = await db
    .select({
      groupId: categoryGroups.id,
      groupName: categoryGroups.name,
      groupColor: sql<string | null>`NULL`,
      amountBase: sql<string | number | null>`${allocationAmount}::numeric * ${fxRateExpr}`,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(transactionSplits, splitAllocationJoin) // NEW-14: one row per split
    .leftJoin(categories, sql`${categories.id} = ${allocationCategoryId}`)
    .leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .where(and(...baseConditions, expenseTypeCondition));

  const totalIncome = calculateTotalIncome(incomeRows, filters.baseCurrency);
  let totalRefunds = Money.zero(filters.baseCurrency);

  const groupTotals = new Map<string, GroupTotal>();
  for (const row of expenseRows) {
    const groupId = row.groupId || "uncategorized";
    const groupName = row.groupName || "Uncategorized";
    const amount = moneyFromValue(row.amountBase, filters.baseCurrency);

    if (amount.amount.isNegative()) {
      totalRefunds = totalRefunds.add(amount.abs());
      continue;
    }

    if (groupTotals.has(groupId)) {
      groupTotals.get(groupId)!.total = groupTotals
        .get(groupId)!
        .total.add(amount);
    } else {
      groupTotals.set(groupId, {
        name: groupName,
        color: row.groupColor,
        total: amount,
      });
    }
  }

  const sortedGroups = Array.from(groupTotals.entries())
    .filter(([, g]) => g.total.isPositive())
    .sort((a, b) => b[1].total.amount.comparedTo(a[1].total.amount))
    .slice(0, maxNodes);

  const totalExpenses = sortedGroups.reduce(
    (sum, [, g]) => sum.add(g.total),
    Money.zero(filters.baseCurrency),
  );

  const incomeNodeId = "synthetic:income";
  const savingsNodeId = "synthetic:savings";
  const nodes: SankeyNode[] = [
    {
      id: incomeNodeId,
      label: "Income",
      nodeColor: "#4CAF50",
      entityType: "synthetic",
      entityId: "income",
    },
  ];
  const links: SankeyLink[] = [];

  for (const [groupId, group] of sortedGroups) {
    const groupNodeId = `categoryGroup:${groupId}`;
    nodes.push({
      id: groupNodeId,
      label: group.name,
      nodeColor: group.color || "#9E9E9E",
      entityType: "categoryGroup",
      entityId: String(groupId),
    });
    links.push({
      source: incomeNodeId,
      target: groupNodeId,
      value: group.total,
      meta: { entityType: "categoryGroup", entityId: String(groupId) },
    });
  }

  const savings = totalIncome.subtract(totalExpenses);
  // Only add savings node if requested AND positive savings
  if (includeSavingsNode && savings.isPositive()) {
    nodes.push({
      id: savingsNodeId,
      label: "Savings",
      nodeColor: "#2196F3",
      entityType: "synthetic",
      entityId: "savings",
    });
    links.push({
      source: incomeNodeId,
      target: savingsNodeId,
      value: savings,
      meta: { entityType: "synthetic", entityId: "savings" },
    });
  }

  if (totalRefunds.isPositive()) {
    if (includeSavingsNode) {
      // Scenario A: Route Refunds to Savings
      const refundsNodeId = "synthetic:refunds";
      nodes.push({
        id: refundsNodeId,
        label: "Refunds",
        nodeColor: "#8BC34A",
        entityType: "synthetic",
        entityId: "refunds",
      });

      // Ensure savings node exists
      if (!nodes.find((n) => n.id === savingsNodeId)) {
        nodes.push({
          id: savingsNodeId,
          label: "Savings",
          nodeColor: "#2196F3",
          entityType: "synthetic",
          entityId: "savings",
        });
      }

      links.push({
        source: refundsNodeId,
        target: savingsNodeId,
        value: totalRefunds,
        meta: { entityType: "synthetic", entityId: "refunds" },
      });
    } else {
      // Scenario B: Merge Refunds into Income (Simplified View)
      // Visually, this increases the Income source to cover expenses that were net-reduced by refunds.
      // We don't create a separate Refunds node to keep the graph simple/nodes limited.
      // No action needed on nodes/links, just implicit in flow balance.
      // (The sankey engine typically handles unbalanced usage, or we could add to totalIncome value)
    }
  }

  return { nodes, links, totalIncome, totalExpenses };
}

export async function buildAccountToExpenseGroups(
  filters: SankeyFilters,
  maxNodes: number,
): Promise<{
  nodes: SankeyNode[];
  links: SankeyLink[];
  totalIncome: Money;
  totalExpenses: Money;
}> {
  const baseConditions = buildSankeyBaseConditions(filters);
  const incomeTypeCondition = getIncomeTypeCondition(filters.includeTransfers);
  const expenseTypeCondition = getExpenseTypeCondition(
    filters.includeTransfers,
  );
  const currencyExpr = sql`COALESCE(${transactions.currency}, ${accounts.currency}, ${filters.baseCurrency}::text)`;
  const fxRateExpr = buildFxRateExpr(
    currencyExpr,
    filters.baseCurrency,
    sql`${transactions.date}`, { householdId: filters.householdId },
  );
  const amountBaseExpr = sql<
    string | number | null
  >`${transactions.amount}::numeric * ${fxRateExpr}`;

  const incomeRows = await db
    .select({
      amountBase: amountBaseExpr,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(...baseConditions, incomeTypeCondition));

  const expenseRows = await db
    .select({
      accountId: accounts.id,
      accountName: accounts.name,
      accountColor: accounts.color,
      groupId: categoryGroups.id,
      groupName: categoryGroups.name,
      groupColor: sql<string | null>`NULL`,
      amountBase: sql<string | number | null>`${allocationAmount}::numeric * ${fxRateExpr}`,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(transactionSplits, splitAllocationJoin) // NEW-14: one row per split
    .leftJoin(categories, sql`${categories.id} = ${allocationCategoryId}`)
    .leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .where(and(...baseConditions, expenseTypeCondition));

  const totalIncome = calculateTotalIncome(incomeRows, filters.baseCurrency);

  const groupTotals = new Map<string, GroupTotal>();
  const accountMap = new Map<string, { name: string; color: string | null }>();
  const linkTotals = new Map<string, Money>();

  for (const row of expenseRows) {
    const accountId = row.accountId || "unknown";
    const groupId = row.groupId || "uncategorized";
    const amount = moneyFromValue(row.amountBase, filters.baseCurrency);

    accountMap.set(accountId, {
      name: row.accountName || "Unknown",
      color: row.accountColor,
    });

    if (groupTotals.has(groupId)) {
      groupTotals.get(groupId)!.total = groupTotals
        .get(groupId)!
        .total.add(amount);
    } else {
      groupTotals.set(groupId, {
        name: row.groupName || "Uncategorized",
        color: row.groupColor,
        total: amount,
      });
    }

    const linkKey = `${accountId}|${groupId}`;
    const current = linkTotals.get(linkKey) || Money.zero(filters.baseCurrency);
    linkTotals.set(linkKey, current.add(amount));
  }

  const sortedGroups = Array.from(groupTotals.entries())
    .filter(([, g]) => g.total.isPositive())
    .sort((a, b) => b[1].total.amount.comparedTo(a[1].total.amount))
    .slice(0, maxNodes);
  const topGroups = new Set(sortedGroups.map(([groupId]) => groupId));
  const totalExpenses = sortedGroups.reduce(
    (sum, [, g]) => sum.add(g.total),
    Money.zero(filters.baseCurrency),
  );

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  const accountNodes = new Set<string>();
  const groupNodes = new Set<string>();

  for (const [linkKey, value] of linkTotals.entries()) {
    const [accountId, groupId] = linkKey.split("|");
    if (!topGroups.has(groupId)) continue;

    const account = accountMap.get(accountId);
    const group = groupTotals.get(groupId);
    if (!account || !group) continue;

    const accountNodeId = `account:${accountId}`;
    const groupNodeId = `categoryGroup:${groupId}`;

    if (!accountNodes.has(accountId)) {
      nodes.push({
        id: accountNodeId,
        label: account.name,
        nodeColor: account.color || "#607D8B",
        entityType: "account",
        entityId: accountId,
      });
      accountNodes.add(accountId);
    }

    if (!groupNodes.has(groupId)) {
      nodes.push({
        id: groupNodeId,
        label: group.name,
        nodeColor: group.color || "#9E9E9E",
        entityType: "categoryGroup",
        entityId: String(groupId),
      });
      groupNodes.add(groupId);
    }

    links.push({
      source: accountNodeId,
      target: groupNodeId,
      value,
      meta: { entityType: "categoryGroup", entityId: String(groupId) },
    });
  }

  return { nodes, links, totalIncome, totalExpenses };
}

export async function buildIncomeToCategories(
  filters: SankeyFilters,
  maxNodes: number,
): Promise<{
  nodes: SankeyNode[];
  links: SankeyLink[];
  totalIncome: Money;
  totalExpenses: Money;
}> {
  const baseConditions = buildSankeyBaseConditions(filters);
  const incomeTypeCondition = getIncomeTypeCondition(filters.includeTransfers);
  const expenseTypeCondition = getExpenseTypeCondition(
    filters.includeTransfers,
  );
  const currencyExpr = sql`COALESCE(${transactions.currency}, ${accounts.currency}, ${filters.baseCurrency}::text)`;
  const fxRateExpr = buildFxRateExpr(
    currencyExpr,
    filters.baseCurrency,
    sql`${transactions.date}`, { householdId: filters.householdId },
  );
  const amountBaseExpr = sql<
    string | number | null
  >`${transactions.amount}::numeric * ${fxRateExpr}`;

  const incomeRows = await db
    .select({
      amountBase: amountBaseExpr,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(...baseConditions, incomeTypeCondition));

  const expenseRows = await db
    .select({
      groupId: sql<string>`COALESCE(${categoryGroups.id}::text, 'uncategorized')`,
      groupName: sql<string>`COALESCE(${categoryGroups.name}, 'Uncategorized')`,
      categoryId: sql<string>`COALESCE(${categories.id}::text, 'uncategorized')`,
      categoryName: sql<string>`COALESCE(${categories.name}, 'Uncategorized')`,
      categoryColor: categories.color,
      amountBase: sql<string | number | null>`${allocationAmount}::numeric * ${fxRateExpr}`,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(transactionSplits, splitAllocationJoin) // NEW-14: one row per split
    .leftJoin(categories, sql`${categories.id} = ${allocationCategoryId}`)
    .leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .where(and(...baseConditions, expenseTypeCondition));

  const totalIncome = calculateTotalIncome(incomeRows, filters.baseCurrency);

  const categoryTotals = new Map<string, CategoryTotal>();
  const linkTotals = new Map<string, Money>();

  for (const row of expenseRows) {
    const groupId = row.groupId || "uncategorized";
    const groupName = row.groupName || "Uncategorized";
    const categoryId = row.categoryId || "uncategorized";
    const categoryName = row.categoryName || "Uncategorized";
    const amount = moneyFromValue(row.amountBase, filters.baseCurrency);

    if (categoryTotals.has(categoryId)) {
      categoryTotals.get(categoryId)!.total = categoryTotals
        .get(categoryId)!
        .total.add(amount);
    } else {
      categoryTotals.set(categoryId, {
        name: categoryName,
        color: row.categoryColor,
        groupId,
        groupName,
        total: amount,
      });
    }

    const linkKey = `${groupId}|${categoryId}`;
    const current = linkTotals.get(linkKey) || Money.zero(filters.baseCurrency);
    linkTotals.set(linkKey, current.add(amount));
  }

  const sortedCategories = Array.from(categoryTotals.entries())
    .filter(([, c]) => c.total.isPositive())
    .sort((a, b) => b[1].total.amount.comparedTo(a[1].total.amount))
    .slice(0, maxNodes);
  const topCategories = new Set(
    sortedCategories.map(([categoryId]) => categoryId),
  );
  const totalExpenses = sortedCategories.reduce(
    (sum, [, c]) => sum.add(c.total),
    Money.zero(filters.baseCurrency),
  );

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  const groupNodes = new Set<string>();
  const categoryNodes = new Set<string>();

  for (const [linkKey, value] of linkTotals.entries()) {
    const [groupId, categoryId] = linkKey.split("|");
    if (!topCategories.has(categoryId)) continue;

    const category = categoryTotals.get(categoryId);
    if (!category) continue;

    const groupNodeId = `categoryGroup:${groupId}`;
    const categoryNodeId = `category:${categoryId}`;

    if (!groupNodes.has(groupId)) {
      nodes.push({
        id: groupNodeId,
        label: category.groupName,
        nodeColor: "#9E9E9E",
        entityType: "categoryGroup",
        entityId: String(groupId),
      });
      groupNodes.add(groupId);
    }

    if (!categoryNodes.has(categoryId)) {
      nodes.push({
        id: categoryNodeId,
        label: category.name,
        nodeColor: category.color || "#BDBDBD",
        entityType: "category",
        entityId: String(categoryId),
      });
      categoryNodes.add(categoryId);
    }

    links.push({
      source: groupNodeId,
      target: categoryNodeId,
      value,
      meta: { entityType: "category", entityId: String(categoryId) },
    });
  }

  return { nodes, links, totalIncome, totalExpenses };
}
