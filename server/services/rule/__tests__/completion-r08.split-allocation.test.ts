import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "@shared/schema";
import type { TransactionType } from "../../../utils/withTransaction";
import type { Rule, RuleAction } from "../types";
import { evaluateActions } from "../actions";
import { createRuleSchema, updateRuleSchema } from "../../../modules/rules/rules.validation";

const { addSplits } = vi.hoisted(() => ({ addSplits: vi.fn() }));
vi.mock("../../../repositories/TransactionRepository", () => ({ transactionRepository: { addSplits } }));
vi.mock("../../../repositories/MerchantRepository", () => ({ merchantRepository: {} }));
vi.mock("../../../repositories/TagRepository", () => ({ tagRepository: {} }));
vi.mock("../../TransactionGoalLinkService", () => ({ transactionGoalLinkService: {} }));
vi.mock("../matching", () => ({ resolveMerchant: vi.fn() }));
vi.mock("../../../utils/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

type Splits = NonNullable<RuleAction["splitConfig"]>;
const tx = {} as TransactionType;
const transaction = (amount: string) => ({ id: "txn", householdId: "household", amount, currency: "USD", notes: null } as Transaction);
const rule = (splits: Splits) => ({ id: "rule", actions: [{ type: "split_transaction", value: "", splitConfig: splits }] } as Rule);
const apply = (amount: string, splits: Splits) => evaluateActions(rule(splits), transaction(amount), "household", new Map(), tx);
const request = (splits: Splits) => ({ name: "Split rule", conditions: [{ type: "merchant_name", operator: "contains", value: "groceries" }],
  actions: [{ type: "split_transaction", splitConfig: splits }] });

beforeEach(() => { addSplits.mockReset(); addSplits.mockResolvedValue([]); });

describe("R08 ORG-005 declared rule allocations", () => {
  it.each([
    { label: "overallocated percentages", splits: [{ percentage: 60 }, { percentage: 60 }] },
    { label: "underallocated percentages", splits: [{ percentage: 60 }, { percentage: 30 }] },
    { label: "two competing units", splits: [{ percentage: 60, amount: "60.00" }, { percentage: 40 }] },
    { label: "non-final remainder", splits: [{}, { percentage: 100 }] },
    { label: "sub-cent fixed amount", splits: [{ amount: "0.001" }, {}] },
  ])("rejects $label when creating or editing an active rule", ({ splits }) => {
    expect(createRuleSchema.safeParse(request(splits)).success).toBe(false);
    expect(updateRuleSchema.safeParse({ actions: request(splits).actions }).success).toBe(false);
  });

  it.each([
    { label: "percentage overage", splits: [{ percentage: 60 }, { percentage: 60 }] },
    { label: "fixed overage", splits: [{ amount: "80.00" }, { amount: "30.00" }] },
    { label: "fixed shortfall", splits: [{ amount: "60.00" }, { amount: "30.00" }] },
    { label: "mixed overage", splits: [{ amount: "25.00" }, { percentage: 90 }] },
  ])("rejects a stored $label before replacing allocations", async ({ splits }) => {
    await expect(apply("100.00", splits)).rejects.toMatchObject({ statusCode: 400 });
    expect(addSplits).not.toHaveBeenCalled();
  });

  it.each([
    { total: "100.00", splits: [{ percentage: 60 }, { percentage: 40 }], expected: ["60.00", "40.00"] },
    { total: "100.00", splits: [{ amount: "25.00" }, { amount: "75.00" }], expected: ["25.00", "75.00"] },
    { total: "100.00", splits: [{ amount: "25.00" }, {}], expected: ["25.00", "75.00"] },
    { total: "100.00", splits: [{ amount: "25.00" }, { percentage: 75 }], expected: ["25.00", "75.00"] },
    { total: "0.10", splits: [{ percentage: 33.33 }, { percentage: 33.33 }, { percentage: 33.34 }], expected: ["0.03", "0.04", "0.03"] },
    { total: "0.01", splits: Array.from({ length: 100 }, () => ({ percentage: 1 })), expected: ["0.01"] },
  ])("conserves $total with deterministic currency-scale allocations", async ({ total, splits, expected }) => {
    await apply(total, splits);
    expect(addSplits).toHaveBeenCalledTimes(1);
    const [id, household, rows, executor] = addSplits.mock.calls[0];
    expect([id, household, executor]).toEqual(["txn", "household", tx]);
    expect(rows.map((row: { amount: string }) => row.amount)).toEqual(expected);
  });

  it("keeps a disabled malformed allocation quarantined", async () => {
    const input = request([{ percentage: 60 }, { percentage: 60 }]);
    expect(createRuleSchema.safeParse({ ...input, actions: input.actions.map(action => ({ ...action, enabled: false })) }).success).toBe(true);
    const disabled = rule([{ percentage: 60 }, { percentage: 60 }]);
    disabled.actions = (disabled.actions as RuleAction[]).map(action => ({ ...action, enabled: false }));
    await evaluateActions(disabled, transaction("100.00"), "household", new Map(), tx);
    expect(addSplits).not.toHaveBeenCalled();
  });
});
