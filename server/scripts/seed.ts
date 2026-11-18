/**
 * Seed Script - Adds sample financial data
 *
 * Run with: npx tsx server/scripts/seed.ts
 */

import { db } from "../db";
import {
  accounts,
  transactions,
  budgets,
  goals,
  goalContributions,
  recurringTransactions,
  categories,
  type InsertAccount,
} from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";

async function seed() {
  console.log("🌱 Starting database seed...\n");

  // Get householdId from an existing account
  const existingAccounts = await db.select().from(accounts).limit(1);

  if (existingAccounts.length === 0) {
    console.log(
      "❌ No accounts found. Please create at least one account first."
    );
    process.exit(1);
  }

  const householdId = existingAccounts[0].householdId;
  const mainAccountId = existingAccounts[0].id;
  console.log(`📍 Using household: ${householdId}`);
  console.log(
    `💳 Main account: ${existingAccounts[0].name} (${mainAccountId})\n`
  );

  const todayStr = new Date().toISOString().split("T")[0];
  const now = new Date();

  const cleanupDuplicateGoals = async () => {
    const existingGoals = await db
      .select()
      .from(goals)
      .where(eq(goals.householdId, householdId));

    const goalsByName = new Map<string, typeof existingGoals>();

    for (const goal of existingGoals) {
      const list = goalsByName.get(goal.name) ?? [];
      list.push(goal);
      goalsByName.set(goal.name, list);
    }

    let removedCount = 0;

    for (const [, list] of goalsByName.entries()) {
      if (list.length <= 1) continue;

      const sorted = [...list].sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aTime - bTime;
      });

      const [, ...duplicates] = sorted;
      for (const duplicate of duplicates) {
        await db.delete(goals).where(eq(goals.id, duplicate.id));
        removedCount += 1;
      }
    }

    if (removedCount > 0) {
      console.log(`   🧹 Removed ${removedCount} duplicate goals`);
    }
  };

  const ensureGoal = async (data: {
    name: string;
    description: string;
    targetAmount: string;
    currentAmount: string;
    targetDate: string;
    priority: number;
  }) => {
    const [existing] = await db
      .select()
      .from(goals)
      .where(and(eq(goals.householdId, householdId), eq(goals.name, data.name)))
      .limit(1);

    if (existing) {
      return existing;
    }

    const [created] = await db
      .insert(goals)
      .values({
        householdId,
        name: data.name,
        description: data.description,
        targetAmount: data.targetAmount,
        currentAmount: data.currentAmount,
        targetDate: data.targetDate,
        priority: data.priority,
        type: "save_up",
        status: "on_track",
        startDate: todayStr,
        updatedAt: now,
        createdAt: now,
      })
      .returning();

    return created;
  };

  const ensureGoalContribution = async (data: {
    goalId: string;
    amount: string;
    notes: string | null;
    date: string;
  }) => {
    const conditions = [
      eq(goalContributions.goalId, data.goalId),
      eq(goalContributions.amount, data.amount),
      eq(goalContributions.date, data.date),
    ];

    if (data.notes === null) {
      conditions.push(isNull(goalContributions.notes));
    } else {
      conditions.push(eq(goalContributions.notes, data.notes));
    }

    const [existing] = await db
      .select()
      .from(goalContributions)
      .where(and(...conditions))
      .limit(1);

    if (existing) {
      return existing;
    }

    const [created] = await db.insert(goalContributions).values(data).returning();
    return created;
  };

  // =========================================================================
  // 1. Create additional accounts
  // =========================================================================
  console.log("💳 Creating additional accounts...");

  const savingsAccountData: InsertAccount = {
    householdId,
    name: "Savings Account",
    type: "savings",
    institution: "ZANACO",
    balance: "25000.00",
    currency: "ZMW",
    displayOrder: 2,
  };
  const [savingsAccount] = await db
    .insert(accounts)
    .values(savingsAccountData)
    .returning();

  const creditCardData: InsertAccount = {
    householdId,
    name: "Visa Platinum",
    type: "credit",
    institution: "Absa",
    balance: "-1500.00",
    currency: "ZMW",
    displayOrder: 3,
  };
  const [creditCard] = await db
    .insert(accounts)
    .values(creditCardData)
    .returning();

  const investmentAccountData: InsertAccount = {
    householdId,
    name: "BOZ Bonds",
    type: "investment",
    institution: "Bank of Zambia",
    balance: "50000.00",
    currency: "ZMW",
    displayOrder: 4,
  };
  const [investmentAccount] = await db
    .insert(accounts)
    .values(investmentAccountData)
    .returning();

  console.log(`   ✅ Created: Savings, Credit Card, Investments\n`);

  // =========================================================================
  // 2. Create categories
  // =========================================================================
  console.log("🏷️  Creating categories...");

  const categoryData = [
    { name: "Salary", type: "income" as const, color: "#10B981", icon: "💰" },
    {
      name: "Freelance",
      type: "income" as const,
      color: "#6366F1",
      icon: "💻",
    },
    {
      name: "Groceries",
      type: "expense" as const,
      color: "#F97316",
      icon: "🛒",
    },
    {
      name: "Transport",
      type: "expense" as const,
      color: "#3B82F6",
      icon: "🚗",
    },
    {
      name: "Utilities",
      type: "expense" as const,
      color: "#14B8A6",
      icon: "💡",
    },
    {
      name: "Entertainment",
      type: "expense" as const,
      color: "#EC4899",
      icon: "🎬",
    },
    {
      name: "Dining Out",
      type: "expense" as const,
      color: "#F59E0B",
      icon: "🍔",
    },
    {
      name: "Shopping",
      type: "expense" as const,
      color: "#8B5CF6",
      icon: "🛍️",
    },
    {
      name: "Healthcare",
      type: "expense" as const,
      color: "#EF4444",
      icon: "🏥",
    },
    {
      name: "Education",
      type: "expense" as const,
      color: "#06B6D4",
      icon: "📚",
    },
  ];

  const createdCategories: Record<string, string> = {};
  let catOrder = 0;
  for (const cat of categoryData) {
    const [created] = await db
      .insert(categories)
      .values({
        householdId,
        ...cat,
        displayOrder: catOrder++,
      })
      .returning();
    createdCategories[cat.name] = created.id;
  }
  console.log(`   ✅ Created ${categoryData.length} categories\n`);

  // =========================================================================
  // 3. Create transactions (last 3 months)
  // =========================================================================
  console.log("💸 Creating transactions...");

  const today = new Date();
  const transactionData = [
    // This month - Income
    {
      days: 1,
      name: "Monthly Salary",
      amount: "15000.00",
      type: "income" as const,
      category: "Salary",
      accountId: mainAccountId,
    },
    {
      days: 5,
      name: "Freelance Project",
      amount: "2500.00",
      type: "income" as const,
      category: "Freelance",
      accountId: mainAccountId,
    },

    // This month - Expenses
    {
      days: 2,
      name: "Shoprite Groceries",
      amount: "850.00",
      type: "expense" as const,
      category: "Groceries",
      accountId: mainAccountId,
    },
    {
      days: 3,
      name: "Fuel",
      amount: "350.00",
      type: "expense" as const,
      category: "Transport",
      accountId: mainAccountId,
    },
    {
      days: 4,
      name: "ZESCO Bill",
      amount: "480.00",
      type: "expense" as const,
      category: "Utilities",
      accountId: mainAccountId,
    },
    {
      days: 6,
      name: "Netflix",
      amount: "45.00",
      type: "expense" as const,
      category: "Entertainment",
      accountId: creditCard.id,
    },
    {
      days: 7,
      name: "Dinner at Rhapsody's",
      amount: "320.00",
      type: "expense" as const,
      category: "Dining Out",
      accountId: creditCard.id,
    },
    {
      days: 8,
      name: "Game Store",
      amount: "180.00",
      type: "expense" as const,
      category: "Shopping",
      accountId: creditCard.id,
    },

    // Last month
    {
      days: 32,
      name: "Monthly Salary",
      amount: "15000.00",
      type: "income" as const,
      category: "Salary",
      accountId: mainAccountId,
    },
    {
      days: 35,
      name: "Pick n Pay",
      amount: "720.00",
      type: "expense" as const,
      category: "Groceries",
      accountId: mainAccountId,
    },
    {
      days: 36,
      name: "Fuel",
      amount: "400.00",
      type: "expense" as const,
      category: "Transport",
      accountId: mainAccountId,
    },
    {
      days: 38,
      name: "ZESCO Bill",
      amount: "520.00",
      type: "expense" as const,
      category: "Utilities",
      accountId: mainAccountId,
    },
    {
      days: 40,
      name: "Pharmacy",
      amount: "150.00",
      type: "expense" as const,
      category: "Healthcare",
      accountId: mainAccountId,
    },
    {
      days: 42,
      name: "Spotify",
      amount: "25.00",
      type: "expense" as const,
      category: "Entertainment",
      accountId: creditCard.id,
    },

    // Two months ago
    {
      days: 62,
      name: "Monthly Salary",
      amount: "15000.00",
      type: "income" as const,
      category: "Salary",
      accountId: mainAccountId,
    },
    {
      days: 65,
      name: "Groceries",
      amount: "680.00",
      type: "expense" as const,
      category: "Groceries",
      accountId: mainAccountId,
    },
    {
      days: 68,
      name: "Water Bill",
      amount: "180.00",
      type: "expense" as const,
      category: "Utilities",
      accountId: mainAccountId,
    },
    {
      days: 70,
      name: "Cinema",
      amount: "120.00",
      type: "expense" as const,
      category: "Entertainment",
      accountId: mainAccountId,
    },
  ];

  for (const txn of transactionData) {
    const date = new Date(today);
    date.setDate(date.getDate() - txn.days);
    const dateStr = date.toISOString().split("T")[0];

    await db.insert(transactions).values({
      householdId,
      accountId: txn.accountId,
      date: dateStr,
      name: txn.name,
      amount: txn.amount,
      type: txn.type,
      categoryId: createdCategories[txn.category],
      status: "cleared",
      source: "manual",
    });
  }
  console.log(`   ✅ Created ${transactionData.length} transactions\n`);

  // =========================================================================
  // 4. Create budgets
  // =========================================================================
  console.log("📊 Creating budgets...");

  const budgetData = [
    {
      name: "Groceries",
      categoryId: createdCategories["Groceries"],
      amount: "2000.00",
    },
    {
      name: "Transport",
      categoryId: createdCategories["Transport"],
      amount: "1000.00",
    },
    {
      name: "Utilities",
      categoryId: createdCategories["Utilities"],
      amount: "800.00",
    },
    {
      name: "Entertainment",
      categoryId: createdCategories["Entertainment"],
      amount: "500.00",
    },
    {
      name: "Dining Out",
      categoryId: createdCategories["Dining Out"],
      amount: "600.00",
    },
  ];

  for (const budget of budgetData) {
    await db.insert(budgets).values({
      householdId,
      name: budget.name,
      categoryId: budget.categoryId,
      amount: budget.amount,
      period: "monthly",
      warningThreshold: 80,
      alertThreshold: 100,
      isActive: true,
    });
  }
  console.log(`   ✅ Created ${budgetData.length} budgets\n`);

  // =========================================================================
  // 5. Create goals
  // =========================================================================
  console.log("🎯 Creating goals...");

  await cleanupDuplicateGoals();

  const emergencyFund = await ensureGoal({
    name: "Emergency Fund",
    description: "6 months of expenses",
    targetAmount: "50000.00",
    currentAmount: "15000.00",
    targetDate: "2025-12-31",
    priority: 1,
  });

  const vacation = await ensureGoal({
    name: "Family Vacation",
    description: "Trip to Victoria Falls",
    targetAmount: "8000.00",
    currentAmount: "2500.00",
    targetDate: "2025-06-01",
    priority: 2,
  });

  const laptop = await ensureGoal({
    name: "New Laptop",
    description: "MacBook Pro for work",
    targetAmount: "25000.00",
    currentAmount: "5000.00",
    targetDate: "2025-09-01",
    priority: 3,
  });

  // Add contributions
  await ensureGoalContribution({
    goalId: emergencyFund.id,
    amount: "5000.00",
    notes: "Initial deposit",
    date: todayStr,
  });
  await ensureGoalContribution({
    goalId: emergencyFund.id,
    amount: "5000.00",
    notes: "Monthly savings",
    date: todayStr,
  });
  await ensureGoalContribution({
    goalId: emergencyFund.id,
    amount: "5000.00",
    notes: "Bonus",
    date: todayStr,
  });
  await ensureGoalContribution({
    goalId: vacation.id,
    amount: "1500.00",
    notes: "Started saving",
    date: todayStr,
  });
  await ensureGoalContribution({
    goalId: vacation.id,
    amount: "1000.00",
    notes: "Monthly contribution",
    date: todayStr,
  });
  await ensureGoalContribution({
    goalId: laptop.id,
    amount: "5000.00",
    notes: "Initial savings",
    date: todayStr,
  });

  console.log(`   ✅ Created 3 goals with contributions\n`);

  // =========================================================================
  // 6. Create recurring transactions
  // =========================================================================
  console.log("🔄 Creating recurring transactions...");

  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  nextMonth.setDate(1);
  const nextMonthStr = nextMonth.toISOString().split("T")[0];

  await db.insert(recurringTransactions).values([
    {
      householdId,
      accountId: mainAccountId,
      name: "Salary",
      amount: "15000.00",
      type: "income" as const,
      frequency: "monthly" as const,
      categoryId: createdCategories["Salary"],
      startDate: todayStr,
      nextDueDate: nextMonthStr,
      dayOfMonth: 25,
      reminderDays: 3,
      isActive: true,
      isPaused: false,
    },
    {
      householdId,
      accountId: mainAccountId,
      name: "ZESCO Electricity",
      amount: "500.00",
      type: "expense" as const,
      frequency: "monthly" as const,
      categoryId: createdCategories["Utilities"],
      startDate: todayStr,
      nextDueDate: nextMonthStr,
      dayOfMonth: 15,
      reminderDays: 5,
      isActive: true,
      isPaused: false,
    },
    {
      householdId,
      accountId: creditCard.id,
      name: "Netflix Subscription",
      amount: "45.00",
      type: "expense" as const,
      frequency: "monthly" as const,
      categoryId: createdCategories["Entertainment"],
      startDate: todayStr,
      nextDueDate: nextMonthStr,
      dayOfMonth: 10,
      reminderDays: 2,
      isActive: true,
      isPaused: false,
    },
    {
      householdId,
      accountId: mainAccountId,
      name: "Gym Membership",
      amount: "250.00",
      type: "expense" as const,
      frequency: "monthly" as const,
      startDate: todayStr,
      nextDueDate: nextMonthStr,
      dayOfMonth: 5,
      reminderDays: 3,
      isActive: true,
      isPaused: false,
    },
  ]);

  console.log(`   ✅ Created 4 recurring transactions\n`);

  // =========================================================================
  // Done!
  // =========================================================================
  console.log("✨ Seed complete!");
  console.log("\n📋 Summary:");
  console.log("   • 4 accounts (including your original)");
  console.log("   • 10 categories");
  console.log("   • 18 transactions (3 months)");
  console.log("   • 5 budgets");
  console.log("   • 3 goals with contributions");
  console.log("   • 4 recurring transactions");
  console.log("\n🚀 Refresh the app to see your data!");

  process.exit(0);
}

seed().catch((error) => {
  console.error("❌ Seed failed:", error);
  process.exit(1);
});
