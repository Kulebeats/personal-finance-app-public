import type { Budget, InsertBudget } from "@shared/schema";
import type { Money } from "../core/money";
import { budgetSpendRepository } from "./BudgetSpendRepository";
import type { BudgetReadContext } from "./BudgetReadContext";
import type { TransactionType } from "../utils/withTransaction";
import {
  budgetCrudRepository,
  type BudgetCrudRepository,
} from "./budgets/BudgetCrudRepository";
import {
  budgetPeriodRepository,
  type BudgetPeriod,
  type InsertBudgetPeriod,
} from "./budgets/BudgetPeriodRepository";
import { budgetRolloverRepository } from "./budgets/BudgetRolloverRepository";

/**
 * Stable budget data-access facade.
 *
 * The public import path remains `repositories/BudgetRepository`; concrete
 * CRUD, period, spend, and rollover responsibilities live in focused helpers.
 */
export class BudgetRepository {
  constructor(
    private readonly crudRepository: BudgetCrudRepository = budgetCrudRepository,
    private readonly periodRepository = budgetPeriodRepository,
    private readonly rolloverRepository = budgetRolloverRepository,
  ) {}

  async findByHousehold(
    householdId: string,
    options?: { includeInactive?: boolean },
  ): Promise<Budget[]> {
    return this.crudRepository.findByHousehold(householdId, options);
  }

  async findById(id: string, householdId: string, tx?: TransactionType, forUpdate = false): Promise<Budget | undefined> {
    return tx ? this.crudRepository.findById(id, householdId, tx, forUpdate) : this.crudRepository.findById(id, householdId);
  }

  async create(data: InsertBudget, tx?: TransactionType): Promise<Budget> {
    return this.crudRepository.create(data, tx);
  }

  async update(
    id: string,
    householdId: string,
    data: Partial<Budget>,
    tx?: TransactionType,
  ): Promise<Budget | undefined> {
    return this.crudRepository.update(id, householdId, data, tx);
  }

  async delete(id: string, householdId: string, tx?: TransactionType): Promise<boolean> {
    return this.crudRepository.delete(id, householdId, tx);
  }

  async calculateSpent(
    householdId: string,
    categoryId: string,
    startDate: string,
    endDate: string,
    transactionType: "income" | "expense" = "expense",
    currency: string = "ZMW",
  ): Promise<Money> {
    return budgetSpendRepository.calculateSpent(
      householdId,
      categoryId,
      startDate,
      endDate,
      transactionType,
      currency,
    );
  }

  async calculateGroupSpent(
    householdId: string,
    categoryGroupId: string,
    startDate: string,
    endDate: string,
    transactionType: "income" | "expense" = "expense",
    currency: string = "ZMW",
  ): Promise<Money> {
    return budgetSpendRepository.calculateGroupSpent(
      householdId,
      categoryGroupId,
      startDate,
      endDate,
      transactionType,
      currency,
    );
  }

  async calculateFlexSpent(
    householdId: string,
    startDate: string,
    endDate: string,
    currency: string = "ZMW",
  ): Promise<Money> {
    return budgetSpendRepository.calculateFlexSpent(
      householdId,
      startDate,
      endDate,
      currency,
    );
  }

  async calculateGroupSpentWithSplits(
    householdId: string,
    categoryGroupId: string,
    startDate: string,
    endDate: string,
    transactionType: "income" | "expense" = "expense",
    currency: string = "ZMW",
  ): Promise<Money> {
    return budgetSpendRepository.calculateGroupSpentWithSplits(
      householdId,
      categoryGroupId,
      startDate,
      endDate,
      transactionType,
      currency,
    );
  }

  async calculateFlexSpentWithSplits(
    householdId: string,
    startDate: string,
    endDate: string,
    currency: string = "ZMW",
  ): Promise<Money> {
    return budgetSpendRepository.calculateFlexSpentWithSplits(
      householdId,
      startDate,
      endDate,
      currency,
    );
  }

  async calculateSpentWithSplits(
    householdId: string,
    categoryId: string,
    startDate: string,
    endDate: string,
    transactionType: "income" | "expense" = "expense",
    currency: string = "ZMW",
  ): Promise<Money> {
    return budgetSpendRepository.calculateSpentWithSplits(
      householdId,
      categoryId,
      startDate,
      endDate,
      transactionType,
      currency,
    );
  }

  async batchCalculateSpent(
    householdId: string,
    categoryIds: string[],
    categoryGroupIds: string[],
    startDate: string,
    endDate: string,
    currency: string = "ZMW",
    categoryTypeMap: Map<string, "income" | "expense">,
    groupTypeMap: Map<string, "income" | "expense">,
    context: BudgetReadContext,
    includeFlex = true,
  ): Promise<{
    byCategoryId: Map<string, Money>;
    byCategoryGroupId: Map<string, Money>;
    flexTotal: Money;
  }> {
    return budgetSpendRepository.batchCalculateSpent(
      householdId,
      categoryIds,
      categoryGroupIds,
      startDate,
      endDate,
      currency,
      categoryTypeMap,
      groupTypeMap,
      context,
      includeFlex,
    );
  }

  async findPeriod(
    budgetId: string,
    startDate: string,
    endDate: string,
    tx?: TransactionType,
    forUpdate: boolean = false,
  ): Promise<BudgetPeriod | undefined> {
    return this.periodRepository.findPeriod(
      budgetId,
      startDate,
      endDate,
      tx,
      forUpdate,
    );
  }

  async upsertPeriod(
    data: InsertBudgetPeriod,
    tx?: TransactionType,
  ): Promise<BudgetPeriod> {
    return this.periodRepository.upsertPeriod(data, tx);
  }

  async ensurePeriodExists(
    data: InsertBudgetPeriod,
    tx: TransactionType,
  ): Promise<void> {
    return this.periodRepository.ensurePeriodExists(data, tx);
  }

  async updatePeriodWithLock(
    id: string,
    expectedVersion: number,
    data: Partial<InsertBudgetPeriod>,
    tx?: TransactionType,
  ): Promise<BudgetPeriod | null> {
    return this.periodRepository.updatePeriodWithLock(
      id,
      expectedVersion,
      data,
      tx,
    );
  }

  async upsertPeriodWithLock(
    data: InsertBudgetPeriod,
    expectedVersion?: number,
    tx?: TransactionType,
  ): Promise<{ period: BudgetPeriod; conflict: boolean }> {
    return this.periodRepository.upsertPeriodWithLock(
      data,
      expectedVersion,
      tx,
    );
  }

  async getBudgetPeriodsForRange(
    budgetIds: string[],
    startDate: string,
    endDate: string,
  ): Promise<BudgetPeriod[]> {
    return this.periodRepository.getBudgetPeriodsForRange(
      budgetIds,
      startDate,
      endDate,
    );
  }

  async persistBudgetPeriodRollovers(
    budgetProgresses: Array<{
      id: string;
      amount: string;
      spent: Money;
      rolloverIn: Money;
    }>,
    startDate: string,
    endDate: string,
    options: { refreshZero?: boolean } = {},
  ): Promise<{ created: number; updated: number }> {
    return this.rolloverRepository.persistBudgetPeriodRollovers(
      budgetProgresses,
      startDate,
      endDate,
      options,
    );
  }
}

export const budgetRepository = new BudgetRepository();
