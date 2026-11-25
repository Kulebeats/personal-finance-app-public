import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import type { Transaction } from "@shared/schema";

// applyRules runs its work inside withTransaction, which (via the real db pool)
// opens a real Postgres connection. With every repository mocked this is a pure
// unit test that must not touch the DB: the real transaction otherwise leaves a
// connection that keeps the vitest worker alive past its teardown timeout
// ("Timeout terminating forks worker"), failing the run. Stub withTransaction to
// invoke the callback with a no-op tx (tx is only forwarded to the mocked repos).
vi.mock("../../utils/withTransaction", () => ({
  withTransaction: (operation: (tx: unknown) => unknown) => operation(undefined),
}));

// The apply-time owner/member/goal re-check reads the database (ORG-003). These
// unit tests use placeholder ids and mocked repositories, so it is stubbed here;
// it is exercised against real Postgres in rules.references.realdb.integration.test.ts.
// Rule-apply audit rows are written through the apply transaction (FIN-16); with
// no real transaction here, stub the writer. It is covered against real Postgres in
// rules.apply.audit.realdb.integration.test.ts.
vi.mock("../rule/apply-audit", () => ({
  writeRuleApplyAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../rule/entity-references", () => ({
  assertRuleActionReferencesCurrent: vi.fn().mockResolvedValue(undefined),
}));

// The apply-time category/tag household check also reads the database (ORG-003).
// Here every placeholder id the actions name counts as the household's own; the
// foreign/missing cases run against real Postgres in
// rules.apply-household-scope.realdb.integration.test.ts.
vi.mock("../rule/action-references", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../rule/action-references")>();
  type Action = Parameters<typeof actual.actionTagIds>[0];
  return {
    ...actual,
    resolveOwnedActionReferences: vi.fn(async (actions: readonly Action[]) => ({
      categoryIds: new Set(actions.flatMap((action) =>
        action.type === "categorize" ? [String(action.value).toLowerCase()]
          : action.type === "split_transaction" ? actual.splitCategoryIds(action).map((id) => id.toLowerCase()) : [])),
      tagIds: new Set(actions.flatMap((action) =>
        action.type === "add_tags" ? actual.actionTagIds(action).map((id) => id.toLowerCase()) : [])),
    })),
  };
});

// Mock repositories
vi.mock("../../repositories/RuleRepository", () => ({
  ruleRepository: {
    findEnabledByHousehold: vi.fn(),
    findByIdAndHousehold: vi.fn(),
  },
}));

vi.mock("../../repositories/TransactionRepository", () => ({
  transactionRepository: {
    update: vi.fn(),
    findByHousehold: vi.fn(),
    findByHouseholdWithVisibility: vi.fn(),
  },
}));

vi.mock("../../repositories/MerchantRepository", () => ({
  merchantRepository: {
    findByIdAndHousehold: vi.fn(),
    getAliases: vi.fn(),
  },
}));

// The alias write goes through the household name/alias guard (real-DB
// coverage: merchants.name-writers.realdb.integration.test.ts).
vi.mock("../../modules/merchants/merchants.name-guard", () => ({
  addMerchantAliasIfFree: vi.fn().mockResolvedValue("added"),
}));

// Mock logger
vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("RuleService", () => {
  const testHouseholdId = "test-household-123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("applyRules", () => {
    it("applies set_owner rule correctly", async () => {
      const { ruleService } = await import("../RuleService");
      const { ruleRepository } = await import(
        "../../repositories/RuleRepository"
      );
      const { transactionRepository } = await import(
        "../../repositories/TransactionRepository"
      );

      const rule = {
        id: "rule-1",
        name: "Set Owner Rule",
        conditions: [
          {
            type: "merchant_name",
            operator: "contains",
            value: "Starbucks",
          },
        ],
        actions: [
          {
            type: "set_owner",
            value: "user-123",
          },
        ],
      };

      (ruleRepository.findEnabledByHousehold as any).mockResolvedValue([rule]);

      const transaction = {
        id: "txn-1",
        name: "Starbucks Coffee",
        amount: "50.00",
        type: "expense",
        householdId: testHouseholdId,
        ownerUserId: null,
      };

      (transactionRepository.update as any).mockResolvedValue({
        transaction: { ...transaction, ownerUserId: "user-123" },
      });

      const result = await ruleService.applyRules(
        transaction as any,
        testHouseholdId
      );

      expect(transactionRepository.update).toHaveBeenCalledWith(
        "txn-1",
        testHouseholdId,
        expect.objectContaining({ ownerUserId: "user-123" }),
        undefined,
        undefined,
        expect.objectContaining({ onWrite: expect.any(Function) })
      );
      expect(result.ownerUserId).toBe("user-123");
    });

    it("applies set_owner to shared (null) correctly", async () => {
      const { ruleService } = await import("../RuleService");
      const { ruleRepository } = await import(
        "../../repositories/RuleRepository"
      );
      const { transactionRepository } = await import(
        "../../repositories/TransactionRepository"
      );

      const rule = {
        id: "rule-shared",
        name: "Set Shared Rule",
        conditions: [
          {
            type: "amount",
            operator: "greater_than",
            value: 100,
          },
        ],
        actions: [
          {
            type: "set_owner",
            value: "shared", // Expecting mapped to null
          },
        ],
      };

      (ruleRepository.findEnabledByHousehold as any).mockResolvedValue([rule]);

      const transaction = {
        id: "txn-2",
        name: "Big Expense",
        amount: "200.00",
        type: "expense",
        householdId: testHouseholdId,
        ownerUserId: "user-123",
      };

      (transactionRepository.update as any).mockResolvedValue({
        transaction: { ...transaction, ownerUserId: null },
      });

      await ruleService.applyRules(transaction as any, testHouseholdId);

      expect(transactionRepository.update).toHaveBeenCalledWith(
        "txn-2",
        testHouseholdId,
        expect.objectContaining({ ownerUserId: null }),
        undefined,
        undefined,
        expect.objectContaining({ onWrite: expect.any(Function) })
      );
    });

    it("applies hide rule correctly as exclusion flags", async () => {
      const { ruleService } = await import("../RuleService");
      const { ruleRepository } = await import(
        "../../repositories/RuleRepository"
      );
      const { transactionRepository } = await import(
        "../../repositories/TransactionRepository"
      );

      const rule = {
        id: "rule-hide",
        name: "Hide Rule",
        conditions: [
          {
            type: "description",
            operator: "contains",
            value: "secret",
          },
        ],
        actions: [
          {
            type: "hide",
            value: "true",
          },
        ],
      };

      (ruleRepository.findEnabledByHousehold as any).mockResolvedValue([rule]);

      const transaction = {
        id: "txn-3",
        name: "Secret Txn",
        notes: "This is a secret",
        amount: "10.00",
        type: "expense",
        householdId: testHouseholdId,
      };

      (transactionRepository.update as any).mockResolvedValue({
        transaction: {
          ...transaction,
          isExcludedFromReports: true,
          isExcludedFromBudget: true,
        },
      });

      await ruleService.applyRules(transaction as any, testHouseholdId);

      expect(transactionRepository.update).toHaveBeenCalledWith(
        "txn-3",
        testHouseholdId,
        expect.objectContaining({
          isExcludedFromReports: true,
          isExcludedFromBudget: true,
        }),
        undefined,
        undefined,
        expect.objectContaining({ onWrite: expect.any(Function) })
      );
    });

    it("does not update if conditions do not match", async () => {
      const { ruleService } = await import("../RuleService");
      const { ruleRepository } = await import(
        "../../repositories/RuleRepository"
      );
      const { transactionRepository } = await import(
        "../../repositories/TransactionRepository"
      );

      const rule = {
        id: "rule-no-match",
        name: "No Match Rule",
        conditions: [
          {
            type: "merchant_name",
            operator: "starts_with",
            value: "Zinc",
          },
        ],
        actions: [{ type: "mark_reviewed", value: "" }],
      };

      (ruleRepository.findEnabledByHousehold as any).mockResolvedValue([rule]);

      const transaction = {
        id: "txn-4",
        name: "Iron Works",
        amount: "10.00",
        type: "expense",
        householdId: testHouseholdId,
      };

      await ruleService.applyRules(transaction as any, testHouseholdId);

      expect(transactionRepository.update).not.toHaveBeenCalled();
    });

    it("applies set_merchant and set_category_from_merchant", async () => {
      const { ruleService } = await import("../RuleService");
      const { ruleRepository } = await import(
        "../../repositories/RuleRepository"
      );
      const { transactionRepository } = await import(
        "../../repositories/TransactionRepository"
      );
      const { merchantRepository } = await import(
        "../../repositories/MerchantRepository"
      );

      const rule = {
        id: "rule-merchant",
        name: "Set Merchant and Category",
        conditions: [
          {
            type: "amount",
            operator: "greater_than",
            value: 0,
          },
        ],
        actions: [
          {
            type: "set_merchant",
            value: "merchant-1",
          },
          {
            type: "set_category_from_merchant",
            value: "",
          },
        ],
      };

      (ruleRepository.findEnabledByHousehold as any).mockResolvedValue([rule]);
      (merchantRepository.findByIdAndHousehold as any).mockResolvedValue({
        id: "merchant-1",
        name: "Shoprite",
        defaultCategoryId: "cat-1",
      });

      const transaction = {
        id: "txn-5",
        name: "Old Name",
        amount: "25.00",
        type: "expense",
        householdId: testHouseholdId,
        merchantId: null,
      };

      (transactionRepository.update as any).mockResolvedValue({
        transaction: {
          ...transaction,
          merchantId: "merchant-1",
          name: "Shoprite",
          categoryId: "cat-1",
        },
      });

      const result = await ruleService.applyRules(
        transaction as any,
        testHouseholdId
      );

      expect(merchantRepository.findByIdAndHousehold).toHaveBeenCalledWith(
        "merchant-1",
        testHouseholdId
      );
      expect(transactionRepository.update).toHaveBeenCalledWith(
        "txn-5",
        testHouseholdId,
        expect.objectContaining({
          merchantId: "merchant-1",
          name: "Shoprite",
          categoryId: "cat-1",
        }),
        undefined,
        undefined,
        expect.objectContaining({ onWrite: expect.any(Function) })
      );
      expect(result.merchantId).toBe("merchant-1");
      expect(result.categoryId).toBe("cat-1");
    });

    it("matches merchant_category condition and marks reviewed", async () => {
      const { ruleService } = await import("../RuleService");
      const { ruleRepository } = await import(
        "../../repositories/RuleRepository"
      );
      const { transactionRepository } = await import(
        "../../repositories/TransactionRepository"
      );
      const { merchantRepository } = await import(
        "../../repositories/MerchantRepository"
      );

      const rule = {
        id: "rule-merchant-category",
        name: "Food Category Rule",
        conditions: [
          {
            type: "merchant_category",
            operator: "equals",
            value: "Food & Dining",
          },
        ],
        actions: [{ type: "mark_reviewed", value: "" }],
      };

      (ruleRepository.findEnabledByHousehold as any).mockResolvedValue([rule]);
      (merchantRepository.findByIdAndHousehold as any).mockResolvedValue({
        id: "merchant-2",
        name: "Cafe Zed",
        category: "Food & Dining",
      });

      const transaction = {
        id: "txn-6",
        name: "Cafe Zed",
        amount: "12.00",
        type: "expense",
        householdId: testHouseholdId,
        merchantId: "merchant-2",
      };

      (transactionRepository.update as any).mockResolvedValue({
        transaction: { ...transaction, reviewedAt: new Date() },
      });

      await ruleService.applyRules(transaction as any, testHouseholdId);

      expect(merchantRepository.findByIdAndHousehold).toHaveBeenCalledWith(
        "merchant-2",
        testHouseholdId
      );
      expect(transactionRepository.update).toHaveBeenCalledWith(
        "txn-6",
        testHouseholdId,
        expect.objectContaining({
          reviewedAt: expect.any(Date),
        }),
        undefined,
        undefined,
        expect.objectContaining({ onWrite: expect.any(Function) })
      );
    });

    it("adds merchant alias without updating transaction fields", async () => {
      const { ruleService } = await import("../RuleService");
      const { ruleRepository } = await import(
        "../../repositories/RuleRepository"
      );
      const { transactionRepository } = await import(
        "../../repositories/TransactionRepository"
      );
      const { merchantRepository } = await import(
        "../../repositories/MerchantRepository"
      );

      const rule = {
        id: "rule-alias",
        name: "Add Alias Rule",
        conditions: [
          {
            type: "merchant_name",
            operator: "contains",
            value: "Shop",
          },
        ],
        actions: [
          {
            type: "add_merchant_alias",
            value: "Shoprite Lusaka",
          },
        ],
      };

      (ruleRepository.findEnabledByHousehold as any).mockResolvedValue([rule]);
      (merchantRepository.findByIdAndHousehold as any).mockResolvedValue({
        id: "merchant-3",
        name: "Shoprite",
      });
      (merchantRepository.getAliases as any).mockResolvedValue([]);

      const transaction = {
        id: "txn-7",
        name: "Shoprite",
        amount: "40.00",
        type: "expense",
        householdId: testHouseholdId,
        merchantId: "merchant-3",
      };

      await ruleService.applyRules(transaction as any, testHouseholdId);

      const { addMerchantAliasIfFree } = await import(
        "../../modules/merchants/merchants.name-guard"
      );
      expect(addMerchantAliasIfFree).toHaveBeenCalledWith(
        undefined,
        testHouseholdId,
        "merchant-3",
        "Shoprite Lusaka"
      );
      expect(transactionRepository.update).not.toHaveBeenCalled();
    });
  });

  describe("testRule", () => {
    it("reports a missing rule as not found", async () => {
      const { ruleService } = await import("../RuleService");
      const { ruleRepository } = await import("../../repositories/RuleRepository");
      vi.mocked(ruleRepository.findByIdAndHousehold).mockResolvedValue(undefined);

      await expect(ruleService.testRule("missing-rule", testHouseholdId, "user-a"))
        .rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
    });

    it("returns correct count of matching transactions visible to the user", async () => {
      const { ruleService } = await import("../RuleService");
      const { ruleRepository } = await import(
        "../../repositories/RuleRepository"
      );
      const { transactionRepository } = await import(
        "../../repositories/TransactionRepository"
      );

      const rule = {
        id: "rule-test",
        conditions: [{ type: "amount", operator: "equals", value: 50 }],
      };
      (ruleRepository.findByIdAndHousehold as unknown as Mock).mockResolvedValue(
        rule
      );

      const txns = [
        { id: "1", amount: "50.00" },
        { id: "2", amount: "20.00" },
        { id: "3", amount: "50.00" },
      ];
      (
        transactionRepository.findByHouseholdWithVisibility as unknown as Mock
      ).mockResolvedValue(txns);

      const count = await ruleService.testRule(
        "rule-test",
        testHouseholdId,
        "user-a"
      );

      expect(count).toBe(2);
      expect(
        transactionRepository.findByHouseholdWithVisibility
      ).toHaveBeenCalledWith(testHouseholdId, "user-a", {
        limit: 100,
        includePending: false,
      });
    });
  });

  describe("applyRulesToTransactions", () => {
    it("skips another member's private transaction (Rule 11 guard)", async () => {
      const { ruleService } = await import("../RuleService");
      const { ruleRepository } = await import(
        "../../repositories/RuleRepository"
      );
      const { transactionRepository } = await import(
        "../../repositories/TransactionRepository"
      );

      const rule = {
        id: "rule-guard",
        name: "Categorize coffee",
        conditions: [
          { type: "merchant_name", operator: "contains", value: "Coffee" },
        ],
        actions: [{ type: "categorize", value: "cat-1" }],
      };
      (
        ruleRepository.findEnabledByHousehold as unknown as Mock
      ).mockResolvedValue([rule]);

      const visibleTxn = {
        id: "txn-visible",
        name: "Coffee Shop",
        amount: "10.00",
        type: "expense",
        householdId: testHouseholdId,
        isPrivate: false,
        ownerUserId: "user-a",
        categoryId: null,
      };
      const privateTxn = {
        id: "txn-private",
        name: "Coffee Shop",
        amount: "12.00",
        type: "expense",
        householdId: testHouseholdId,
        isPrivate: true,
        ownerUserId: "user-b",
        categoryId: null,
      };

      (transactionRepository.update as unknown as Mock).mockResolvedValue({
        transaction: { ...visibleTxn, categoryId: "cat-1" },
      });

      const { transactions: results } = await ruleService.applyRulesToTransactions(
        [visibleTxn, privateTxn] as unknown as Transaction[],
        testHouseholdId,
        { userId: "user-a" }
      );

      // Only the visible transaction was mutated.
      expect(transactionRepository.update).toHaveBeenCalledTimes(1);
      expect(transactionRepository.update).toHaveBeenCalledWith(
        "txn-visible",
        testHouseholdId,
        expect.objectContaining({ categoryId: "cat-1" }),
        undefined,
        undefined,
        expect.objectContaining({ onWrite: expect.any(Function) })
      );
      // The foreign private transaction is returned untouched.
      expect(results[1]).toEqual(privateTxn);
    });

    it("still applies rules to the user's own private transaction", async () => {
      const { ruleService } = await import("../RuleService");
      const { ruleRepository } = await import(
        "../../repositories/RuleRepository"
      );
      const { transactionRepository } = await import(
        "../../repositories/TransactionRepository"
      );

      const rule = {
        id: "rule-guard-own",
        name: "Categorize coffee",
        conditions: [
          { type: "merchant_name", operator: "contains", value: "Coffee" },
        ],
        actions: [{ type: "categorize", value: "cat-1" }],
      };
      (
        ruleRepository.findEnabledByHousehold as unknown as Mock
      ).mockResolvedValue([rule]);

      const ownPrivateTxn = {
        id: "txn-own-private",
        name: "Coffee Shop",
        amount: "15.00",
        type: "expense",
        householdId: testHouseholdId,
        isPrivate: true,
        ownerUserId: "user-a",
        categoryId: null,
      };

      (transactionRepository.update as unknown as Mock).mockResolvedValue({
        transaction: { ...ownPrivateTxn, categoryId: "cat-1" },
      });

      await ruleService.applyRulesToTransactions(
        [ownPrivateTxn] as unknown as Transaction[],
        testHouseholdId,
        { userId: "user-a" }
      );

      expect(transactionRepository.update).toHaveBeenCalledWith(
        "txn-own-private",
        testHouseholdId,
        expect.objectContaining({ categoryId: "cat-1" }),
        undefined,
        undefined,
        expect.objectContaining({ onWrite: expect.any(Function) })
      );
    });
  });

  describe("conditionLogic handling", () => {
    it("matches when conditionLogic is any and one condition matches", async () => {
      const { ruleService } = await import("../RuleService");

      const rule = {
        id: "rule-any",
        conditions: [
          {
            type: "merchant_name",
            operator: "contains",
            value: "Shop",
          },
          {
            type: "amount",
            operator: "greater_than",
            value: 500,
          },
        ],
        conditionLogic: "any",
      };

      const transaction = {
        id: "txn-any",
        name: "Shoprite",
        amount: "25.00",
        type: "expense",
        householdId: testHouseholdId,
      };

      const matches = await ruleService.testRuleConditions(
        rule as any,
        transaction as any,
        testHouseholdId
      );

      expect(matches).toBe(true);
    });

    it("requires all conditions when conditionLogic is all", async () => {
      const { ruleService } = await import("../RuleService");

      const rule = {
        id: "rule-all",
        conditions: [
          {
            type: "merchant_name",
            operator: "contains",
            value: "Shop",
          },
          {
            type: "amount",
            operator: "greater_than",
            value: 500,
          },
        ],
        conditionLogic: "all",
      };

      const transaction = {
        id: "txn-all",
        name: "Shoprite",
        amount: "25.00",
        type: "expense",
        householdId: testHouseholdId,
      };

      const matches = await ruleService.testRuleConditions(
        rule as any,
        transaction as any,
        testHouseholdId
      );

      expect(matches).toBe(false);
    });
  });
});
