# Recurring Transactions Enhancement - Full Implementation Guide

## Overview

Enhance the recurring transactions feature with pattern detection, transaction linking, occurrence tracking, subscription management, and improved notifications.

### Key Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Schema Scope | Full (all fields) | Implement all 15+ fields at once |
| Detection Threshold | 80% confidence | Balance accuracy vs coverage |
| Testing Approach | TDD-adjacent | Tests written with each phase |

---

## Current State

### Existing Implementation

| Component | File | Status |
|-----------|------|--------|
| Schema | `shared/schema.ts` | Basic table exists |
| Repository | `server/repositories/RecurringRepository.ts` | CRUD + date calc |
| Service | `server/services/RecurringService.ts` | CRUD + process |
| Routes | `server/routes/recurring.ts` | Full REST API |
| Frontend | `client/src/pages/Recurring.tsx` | Calendar/List views |
| Hooks | `client/src/hooks/useRecurring.ts` | React Query hooks |

### Existing Schema Fields
```typescript
// Current recurringTransactions table
id, householdId, accountId, name, amount, type, categoryId, merchantId,
frequency, startDate, endDate, nextDueDate, dayOfMonth, dayOfWeek,
reminderDays, isActive, isPaused, notes, createdAt, updatedAt
```

---

## Implementation Phases

---

## Phase 1: Schema Enhancement

### 1.1 New Columns for `recurringTransactions`

**File:** `shared/schema.ts`

Add after existing columns (around line 1060):

```typescript
// Amount flexibility
amountType: varchar("amount_type", { length: 10 }).default("fixed"), // 'fixed' | 'variable'
amountTolerance: integer("amount_tolerance").default(0), // 0-50 percentage

// Custom frequency support
intervalValue: integer("interval_value"), // e.g., 2 for "every 2 weeks"
intervalUnit: varchar("interval_unit", { length: 10 }), // 'days' | 'weeks' | 'months' | 'years'

// Tracking
totalOccurrences: integer("total_occurrences").default(0),
missedCount: integer("missed_count").default(0),
lastOccurredDate: date("last_occurred_date"),

// Detection metadata
detectionMethod: varchar("detection_method", { length: 20 }), // 'manual' | 'auto_detected' | 'suggested'
detectionConfidence: decimal("detection_confidence", { precision: 5, scale: 2 }), // 0.00-100.00

// Notification preferences
reminderEmail: boolean("reminder_email").default(false),
reminderPush: boolean("reminder_push").default(false),
reminderInApp: boolean("reminder_in_app").default(true),

// Auto-linking behavior
autoLinkEnabled: boolean("auto_link_enabled").default(true),
autoMarkReviewed: boolean("auto_mark_reviewed").default(false),

// Subscription tracking
isSubscription: boolean("is_subscription").default(false),
trialEndDate: date("trial_end_date"),
```

### 1.2 New Table: `recurringTransactionLinks`

**File:** `shared/schema.ts`

Add after `recurringTransactions` table:

```typescript
// ============================================================================
// RECURRING TRANSACTION LINKS
// ============================================================================

export const recurringTransactionLinks = pgTable("recurring_transaction_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  recurringTransactionId: uuid("recurring_transaction_id")
    .notNull()
    .references(() => recurringTransactions.id, { onDelete: "cascade" }),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),

  // Match metadata
  matchConfidence: decimal("match_confidence", { precision: 5, scale: 2 }), // 0-100
  matchMethod: varchar("match_method", { length: 20 }).default("manual"), // 'auto' | 'manual' | 'confirmed'
  expectedDate: date("expected_date"),
  actualDate: date("actual_date"),
  expectedAmount: decimal("expected_amount", { precision: 15, scale: 2 }),
  actualAmount: decimal("actual_amount", { precision: 15, scale: 2 }),

  // Status
  status: varchar("status", { length: 20 }).default("linked"), // 'linked' | 'missed' | 'early' | 'late'

  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Zod schemas
export const insertRecurringTransactionLinkSchema = createInsertSchema(recurringTransactionLinks);
export const selectRecurringTransactionLinkSchema = createSelectSchema(recurringTransactionLinks);

// Types
export type RecurringTransactionLink = typeof recurringTransactionLinks.$inferSelect;
export type InsertRecurringTransactionLink = typeof recurringTransactionLinks.$inferInsert;
```

### 1.3 New Table: `recurringTransactionHistory`

**File:** `shared/schema.ts`

```typescript
// ============================================================================
// RECURRING TRANSACTION HISTORY
// ============================================================================

export const recurringTransactionHistory = pgTable("recurring_transaction_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  recurringTransactionId: uuid("recurring_transaction_id")
    .notNull()
    .references(() => recurringTransactions.id, { onDelete: "cascade" }),

  // Change tracking
  action: varchar("action", { length: 30 }).notNull(), // 'created' | 'updated' | 'paused' | 'resumed' | 'skipped' | 'processed' | 'ended'
  previousState: jsonb("previous_state"),
  newState: jsonb("new_state"),
  changeReason: text("change_reason"),

  // Context
  performedBy: uuid("performed_by").references(() => users.id, { onDelete: "set null" }),
  linkedTransactionId: uuid("linked_transaction_id").references(() => transactions.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Types
export type RecurringTransactionHistory = typeof recurringTransactionHistory.$inferSelect;
export type InsertRecurringTransactionHistory = typeof recurringTransactionHistory.$inferInsert;
```

### 1.4 Update Validation Schemas

**File:** `server/validation/recurringSchemas.ts`

```typescript
import { z } from "zod";

// Frequency enum
const frequencySchema = z.enum([
  "daily", "weekly", "biweekly", "monthly", "quarterly", "yearly", "custom"
]);

// Enhanced create schema
export const createRecurringSchema = z.object({
  accountId: z.string().uuid(),
  name: z.string().min(1).max(255),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  amountType: z.enum(["fixed", "variable"]).default("fixed"),
  amountTolerance: z.number().int().min(0).max(50).default(0),
  type: z.enum(["income", "expense", "transfer"]),
  categoryId: z.string().uuid().optional().nullable(),
  merchantId: z.string().uuid().optional().nullable(),
  frequency: frequencySchema,
  intervalValue: z.number().int().min(1).max(365).optional(),
  intervalUnit: z.enum(["days", "weeks", "months", "years"]).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dayOfMonth: z.number().int().min(1).max(31).optional().nullable(),
  dayOfWeek: z.number().int().min(0).max(6).optional().nullable(),
  reminderDays: z.number().int().min(0).max(30).default(3),
  reminderEmail: z.boolean().default(false),
  reminderPush: z.boolean().default(false),
  reminderInApp: z.boolean().default(true),
  autoLinkEnabled: z.boolean().default(true),
  autoMarkReviewed: z.boolean().default(false),
  isSubscription: z.boolean().default(false),
  trialEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  isActive: z.boolean().default(true),
});

// Detection schemas
export const detectPatternsSchema = z.object({
  minOccurrences: z.number().int().min(2).max(12).default(3),
  lookbackMonths: z.number().int().min(1).max(24).default(6),
  confidenceThreshold: z.number().min(50).max(100).default(80),
  merchantId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
});

export const confirmPatternSchema = z.object({
  pattern: z.object({
    name: z.string().min(1),
    merchantId: z.string().uuid().optional().nullable(),
    estimatedAmount: z.number().positive(),
    frequency: frequencySchema,
    dayOfMonth: z.number().int().min(1).max(31).optional().nullable(),
    dayOfWeek: z.number().int().min(0).max(6).optional().nullable(),
    suggestedStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    suggestedNextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sampleTransactionIds: z.array(z.string().uuid()),
  }),
});

export const linkTransactionSchema = z.object({
  transactionId: z.string().uuid(),
});

export const endRecurringSchema = z.object({
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.string().max(500).optional(),
});

export const calendarQuerySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const historyQuerySchema = z.object({
  limit: z.string().optional().transform(v => v ? parseInt(v, 10) : 50),
});
```

---

## Phase 2: Pattern Detection Service

### 2.1 Create Service

**File:** `server/services/PatternDetectionService.ts`

```typescript
import { transactionRepository } from "../repositories/TransactionRepository";
import { recurringRepository } from "../repositories/RecurringRepository";
import { type Transaction, type RecurringTransaction } from "@shared/schema";
import { logger } from "../utils/logger";

export interface DetectionOptions {
  minOccurrences?: number;
  lookbackMonths?: number;
  confidenceThreshold?: number;
  merchantId?: string;
  categoryId?: string;
}

export interface DetectedPattern {
  name: string;
  merchantId?: string;
  merchantName?: string;
  estimatedAmount: number;
  amountVariance: number;
  frequency: string;
  dayOfMonth?: number;
  dayOfWeek?: number;
  confidence: number;
  occurrences: number;
  sampleTransactionIds: string[];
  suggestedStartDate: string;
  suggestedNextDueDate: string;
}

export interface MatchResult {
  rule: RecurringTransaction;
  confidence: number;
  matchReasons: string[];
}

export class PatternDetectionService {
  private readonly CONFIDENCE_THRESHOLD = 80;

  /**
   * Detect recurring patterns from transaction history
   */
  async detectPatterns(
    householdId: string,
    options: DetectionOptions = {}
  ): Promise<DetectedPattern[]> {
    const {
      minOccurrences = 3,
      lookbackMonths = 6,
      confidenceThreshold = this.CONFIDENCE_THRESHOLD,
    } = options;

    // Get transactions from lookback period
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - lookbackMonths);

    const transactions = await transactionRepository.findForPatternDetection(
      householdId,
      lookbackMonths
    );

    // Group by merchant/name
    const groups = this.groupTransactions(transactions);

    const patterns: DetectedPattern[] = [];

    for (const [key, txns] of groups) {
      if (txns.length < minOccurrences) continue;

      const pattern = this.analyzeGroup(txns);
      if (pattern && pattern.confidence >= confidenceThreshold) {
        patterns.push(pattern);
      }
    }

    return patterns.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Match a transaction to existing recurring rules
   */
  async matchTransaction(
    transaction: Transaction,
    householdId: string
  ): Promise<MatchResult | null> {
    const rules = await recurringRepository.findByHousehold(householdId);

    let bestMatch: MatchResult | null = null;

    for (const rule of rules) {
      const { confidence, reasons } = this.calculateMatchScore(transaction, rule);

      if (confidence >= this.CONFIDENCE_THRESHOLD) {
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { rule, confidence, matchReasons: reasons };
        }
      }
    }

    return bestMatch;
  }

  /**
   * Group transactions by merchant/name for pattern analysis
   */
  private groupTransactions(
    transactions: Transaction[]
  ): Map<string, Transaction[]> {
    const groups = new Map<string, Transaction[]>();

    for (const txn of transactions) {
      const key = txn.merchantId || this.normalizeTransactionName(txn.name);

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(txn);
    }

    return groups;
  }

  /**
   * Analyze a group of transactions for recurring pattern
   */
  private analyzeGroup(transactions: Transaction[]): DetectedPattern | null {
    if (transactions.length < 2) return null;

    // Sort by date
    const sorted = [...transactions].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Calculate intervals
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const daysDiff = this.daysBetween(sorted[i-1].date, sorted[i].date);
      intervals.push(daysDiff);
    }

    // Detect frequency
    const frequency = this.detectFrequency(intervals);
    if (!frequency) return null;

    // Calculate amounts
    const amounts = sorted.map(t => Math.abs(parseFloat(t.amount)));
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = this.calculateVariance(amounts, avgAmount);

    // Calculate confidence
    const confidence = this.calculateConfidence(
      sorted.length,
      intervals,
      frequency.avgInterval,
      variance
    );

    // Detect day patterns
    const dayOfMonth = this.detectDayOfMonth(sorted);
    const dayOfWeek = this.detectDayOfWeek(sorted);

    // Calculate next due date
    const lastDate = new Date(sorted[sorted.length - 1].date);
    const nextDueDate = this.calculateNextDate(lastDate, frequency.type);

    return {
      name: sorted[0].name,
      merchantId: sorted[0].merchantId || undefined,
      estimatedAmount: Math.round(avgAmount * 100) / 100,
      amountVariance: Math.round(variance * 100) / 100,
      frequency: frequency.type,
      dayOfMonth,
      dayOfWeek,
      confidence: Math.round(confidence),
      occurrences: sorted.length,
      sampleTransactionIds: sorted.slice(-5).map(t => t.id),
      suggestedStartDate: sorted[0].date,
      suggestedNextDueDate: nextDueDate.toISOString().split('T')[0],
    };
  }

  /**
   * Calculate match score between transaction and recurring rule
   */
  private calculateMatchScore(
    transaction: Transaction,
    rule: RecurringTransaction
  ): { confidence: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // Merchant match (+30)
    if (rule.merchantId && transaction.merchantId === rule.merchantId) {
      score += 30;
      reasons.push("Merchant matches");
    } else if (this.nameSimilarity(transaction.name, rule.name) > 0.85) {
      score += 25;
      reasons.push("Name similar");
    }

    // Amount match (+30)
    const ruleAmount = parseFloat(rule.amount);
    const txnAmount = Math.abs(parseFloat(transaction.amount));
    const tolerance = rule.amountTolerance || 5;
    const amountDiff = Math.abs(ruleAmount - txnAmount) / ruleAmount * 100;

    if (amountDiff <= tolerance) {
      score += 30;
      reasons.push(`Amount within ${tolerance}% tolerance`);
    } else if (amountDiff <= tolerance * 2) {
      score += 15;
      reasons.push("Amount close");
    }

    // Date proximity (+20)
    const daysDiff = Math.abs(
      this.daysBetween(transaction.date, rule.nextDueDate)
    );
    if (daysDiff <= 3) {
      score += 20;
      reasons.push("Date matches expected");
    } else if (daysDiff <= 7) {
      score += 10;
      reasons.push("Date close to expected");
    }

    // Category match (+10)
    if (rule.categoryId && transaction.categoryId === rule.categoryId) {
      score += 10;
      reasons.push("Category matches");
    }

    // Account match (+10)
    if (transaction.accountId === rule.accountId) {
      score += 10;
      reasons.push("Account matches");
    }

    return { confidence: Math.min(100, score), reasons };
  }

  /**
   * Detect frequency from intervals
   */
  private detectFrequency(intervals: number[]): { type: string; avgInterval: number } | null {
    if (intervals.length === 0) return null;

    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    // Check against known frequencies with tolerance
    const frequencies = [
      { type: "daily", days: 1, tolerance: 0.5 },
      { type: "weekly", days: 7, tolerance: 2 },
      { type: "biweekly", days: 14, tolerance: 3 },
      { type: "monthly", days: 30, tolerance: 5 },
      { type: "quarterly", days: 90, tolerance: 10 },
      { type: "yearly", days: 365, tolerance: 30 },
    ];

    for (const freq of frequencies) {
      if (Math.abs(avg - freq.days) <= freq.tolerance) {
        return { type: freq.type, avgInterval: avg };
      }
    }

    return null;
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(
    occurrences: number,
    intervals: number[],
    avgInterval: number,
    amountVariance: number
  ): number {
    // Base score from occurrences (max 25)
    const baseScore = Math.min(25, occurrences * 5);

    // Frequency consistency (max 35)
    const intervalVariance = this.calculateVariance(intervals, avgInterval);
    const frequencyScore = Math.max(0, 35 - intervalVariance * 2);

    // Amount consistency (max 30)
    const amountScore = Math.max(0, 30 - amountVariance * 3);

    // Recency bonus (max 10)
    const recencyScore = occurrences >= 3 ? 10 : 5;

    return baseScore + frequencyScore + amountScore + recencyScore;
  }

  // Helper methods
  private daysBetween(date1: string, date2: string): number {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    return Math.round(Math.abs(d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
  }

  private calculateVariance(values: number[], mean: number): number {
    if (values.length === 0) return 0;
    const squaredDiffs = values.map(v => Math.pow((v - mean) / mean * 100, 2));
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
  }

  private normalizeTransactionName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20);
  }

  private nameSimilarity(name1: string, name2: string): number {
    const n1 = this.normalizeTransactionName(name1);
    const n2 = this.normalizeTransactionName(name2);
    if (n1 === n2) return 1;

    // Simple Jaccard similarity
    const set1 = new Set(n1.split(''));
    const set2 = new Set(n2.split(''));
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return intersection.size / union.size;
  }

  private detectDayOfMonth(transactions: Transaction[]): number | undefined {
    const days = transactions.map(t => new Date(t.date).getDate());
    const counts = new Map<number, number>();

    for (const day of days) {
      counts.set(day, (counts.get(day) || 0) + 1);
    }

    const [mostCommon, count] = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])[0] || [undefined, 0];

    return count >= transactions.length * 0.6 ? mostCommon : undefined;
  }

  private detectDayOfWeek(transactions: Transaction[]): number | undefined {
    const days = transactions.map(t => new Date(t.date).getDay());
    const counts = new Map<number, number>();

    for (const day of days) {
      counts.set(day, (counts.get(day) || 0) + 1);
    }

    const [mostCommon, count] = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])[0] || [undefined, 0];

    return count >= transactions.length * 0.6 ? mostCommon : undefined;
  }

  private calculateNextDate(lastDate: Date, frequency: string): Date {
    const next = new Date(lastDate);

    switch (frequency) {
      case "daily": next.setDate(next.getDate() + 1); break;
      case "weekly": next.setDate(next.getDate() + 7); break;
      case "biweekly": next.setDate(next.getDate() + 14); break;
      case "monthly": next.setMonth(next.getMonth() + 1); break;
      case "quarterly": next.setMonth(next.getMonth() + 3); break;
      case "yearly": next.setFullYear(next.getFullYear() + 1); break;
    }

    return next;
  }
}

export const patternDetectionService = new PatternDetectionService();
```

---

## Phase 3: Repository Enhancements

### 3.1 Add Methods to RecurringRepository

**File:** `server/repositories/RecurringRepository.ts`

Add these methods:

```typescript
// Import new types
import {
  recurringTransactionLinks,
  recurringTransactionHistory,
  type RecurringTransactionLink,
  type InsertRecurringTransactionLink,
  type RecurringTransactionHistory,
} from "@shared/schema";

// Add to RecurringRepository class:

// ============================================================================
// LINK METHODS
// ============================================================================

async createLink(data: InsertRecurringTransactionLink): Promise<RecurringTransactionLink> {
  const [link] = await db
    .insert(recurringTransactionLinks)
    .values(data)
    .returning();
  return link;
}

async findLinksByRecurring(recurringId: string): Promise<RecurringTransactionLink[]> {
  return await db
    .select()
    .from(recurringTransactionLinks)
    .where(eq(recurringTransactionLinks.recurringTransactionId, recurringId))
    .orderBy(desc(recurringTransactionLinks.createdAt));
}

async findLinkByTransaction(transactionId: string): Promise<RecurringTransactionLink | null> {
  const [link] = await db
    .select()
    .from(recurringTransactionLinks)
    .where(eq(recurringTransactionLinks.transactionId, transactionId))
    .limit(1);
  return link || null;
}

async deleteLink(linkId: string): Promise<boolean> {
  const result = await db
    .delete(recurringTransactionLinks)
    .where(eq(recurringTransactionLinks.id, linkId))
    .returning({ id: recurringTransactionLinks.id });
  return result.length > 0;
}

// ============================================================================
// HISTORY METHODS
// ============================================================================

async logHistory(data: {
  recurringTransactionId: string;
  action: string;
  previousState?: object;
  newState?: object;
  changeReason?: string;
  performedBy?: string;
  linkedTransactionId?: string;
}): Promise<RecurringTransactionHistory> {
  const [history] = await db
    .insert(recurringTransactionHistory)
    .values(data)
    .returning();
  return history;
}

async findHistory(
  recurringId: string,
  limit: number = 50
): Promise<RecurringTransactionHistory[]> {
  return await db
    .select()
    .from(recurringTransactionHistory)
    .where(eq(recurringTransactionHistory.recurringTransactionId, recurringId))
    .orderBy(desc(recurringTransactionHistory.createdAt))
    .limit(limit);
}

// ============================================================================
// CALENDAR/SUMMARY METHODS
// ============================================================================

async getSummary(householdId: string): Promise<{
  totalMonthlyIncome: number;
  totalMonthlyExpenses: number;
  activeCount: number;
  subscriptionCount: number;
  upcomingCount: number;
}> {
  const rules = await this.findByHousehold(householdId);

  let monthlyIncome = 0;
  let monthlyExpenses = 0;
  let subscriptionCount = 0;

  for (const rule of rules) {
    const monthlyAmount = this.toMonthlyAmount(
      parseFloat(rule.amount),
      rule.frequency
    );

    if (rule.type === "income") {
      monthlyIncome += monthlyAmount;
    } else if (rule.type === "expense") {
      monthlyExpenses += monthlyAmount;
    }

    if (rule.isSubscription) {
      subscriptionCount++;
    }
  }

  const upcoming = await this.findUpcoming(householdId, 7);

  return {
    totalMonthlyIncome: Math.round(monthlyIncome * 100) / 100,
    totalMonthlyExpenses: Math.round(monthlyExpenses * 100) / 100,
    activeCount: rules.length,
    subscriptionCount,
    upcomingCount: upcoming.length,
  };
}

private toMonthlyAmount(amount: number, frequency: string): number {
  switch (frequency) {
    case "daily": return amount * 30;
    case "weekly": return amount * 4.33;
    case "biweekly": return amount * 2.17;
    case "monthly": return amount;
    case "quarterly": return amount / 3;
    case "yearly": return amount / 12;
    default: return amount;
  }
}

// ============================================================================
// END RECURRING
// ============================================================================

async endRecurring(
  id: string,
  householdId: string,
  endDate?: string
): Promise<RecurringTransaction | undefined> {
  const finalEndDate = endDate || new Date().toISOString().split("T")[0];

  const [rule] = await db
    .update(recurringTransactions)
    .set({
      isActive: false,
      endDate: finalEndDate,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(recurringTransactions.id, id),
        eq(recurringTransactions.householdId, householdId)
      )
    )
    .returning();

  return rule;
}
```

### 3.2 Add to TransactionRepository

**File:** `server/repositories/TransactionRepository.ts`

```typescript
async findForPatternDetection(
  householdId: string,
  lookbackMonths: number
): Promise<Transaction[]> {
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - lookbackMonths);
  const startDateStr = startDate.toISOString().split("T")[0];

  return await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        gte(transactions.date, startDateStr),
        eq(transactions.isExcludedFromReports, false)
      )
    )
    .orderBy(transactions.date);
}
```

---

## Phase 4: Service Layer Updates

### 4.1 Extend RecurringService

**File:** `server/services/RecurringService.ts`

Add these methods:

```typescript
import { patternDetectionService, type DetectedPattern } from "./PatternDetectionService";

// Add to RecurringService class:

/**
 * Detect recurring patterns and return suggestions
 */
async detectAndSuggest(
  householdId: string,
  options?: DetectionOptions
): Promise<DetectedPattern[]> {
  return await patternDetectionService.detectPatterns(householdId, options);
}

/**
 * Confirm a detected pattern and create recurring rule
 */
async confirmPattern(
  householdId: string,
  pattern: DetectedPattern,
  userId: string,
  accountId: string
): Promise<RecurringTransaction> {
  const rule = await this.createRecurring(
    {
      name: pattern.name,
      amount: pattern.estimatedAmount.toString(),
      type: "expense",
      frequency: pattern.frequency as any,
      merchantId: pattern.merchantId,
      startDate: pattern.suggestedStartDate,
      nextDueDate: pattern.suggestedNextDueDate,
      dayOfMonth: pattern.dayOfMonth,
      dayOfWeek: pattern.dayOfWeek,
      detectionMethod: "auto_detected",
      detectionConfidence: pattern.confidence.toString(),
      accountId,
    },
    householdId,
    userId
  );

  // Link sample transactions
  for (const txnId of pattern.sampleTransactionIds) {
    await this.linkTransaction(rule.id, txnId, householdId, "confirmed");
  }

  // Log history
  await recurringRepository.logHistory({
    recurringTransactionId: rule.id,
    action: "created",
    newState: rule as any,
    changeReason: "Created from detected pattern",
    performedBy: userId,
  });

  return rule;
}

/**
 * Link a transaction to a recurring rule
 */
async linkTransaction(
  recurringId: string,
  transactionId: string,
  householdId: string,
  method: "auto" | "manual" | "confirmed" = "manual"
): Promise<RecurringTransactionLink> {
  // Verify recurring exists
  const rule = await recurringRepository.findById(recurringId, householdId);
  if (!rule) {
    throw new NotFoundError("Recurring rule not found");
  }

  // Check if already linked
  const existingLink = await recurringRepository.findLinkByTransaction(transactionId);
  if (existingLink) {
    throw new ValidationError("Transaction already linked", {
      transactionId: "Already linked to a recurring rule",
    });
  }

  // Get transaction for metadata
  const transaction = await transactionRepository.findById(transactionId, householdId);
  if (!transaction) {
    throw new NotFoundError("Transaction not found");
  }

  // Create link
  const link = await recurringRepository.createLink({
    recurringTransactionId: recurringId,
    transactionId,
    matchMethod: method,
    expectedDate: rule.nextDueDate,
    actualDate: transaction.date,
    expectedAmount: rule.amount,
    actualAmount: transaction.amount,
    status: "linked",
  });

  // Update occurrence count
  await recurringRepository.update(recurringId, householdId, {
    totalOccurrences: (rule.totalOccurrences || 0) + 1,
    lastOccurredDate: transaction.date,
  });

  return link;
}

/**
 * Unlink a transaction
 */
async unlinkTransaction(linkId: string, householdId: string): Promise<void> {
  const deleted = await recurringRepository.deleteLink(linkId);
  if (!deleted) {
    throw new NotFoundError("Link not found");
  }
}

/**
 * Auto-link a new transaction to matching recurring rule
 */
async autoLinkNewTransaction(
  transaction: Transaction,
  householdId: string
): Promise<RecurringTransactionLink | null> {
  const match = await patternDetectionService.matchTransaction(
    transaction,
    householdId
  );

  if (!match || !match.rule.autoLinkEnabled) {
    return null;
  }

  try {
    return await this.linkTransaction(
      match.rule.id,
      transaction.id,
      householdId,
      "auto"
    );
  } catch (error) {
    logger.warn("Auto-link failed", { transactionId: transaction.id, error });
    return null;
  }
}

/**
 * Get summary statistics
 */
async getSummaryData(householdId: string) {
  return await recurringRepository.getSummary(householdId);
}

/**
 * Get linked transaction history
 */
async getLinkedTransactions(
  recurringId: string,
  householdId: string
): Promise<RecurringTransactionLink[]> {
  const rule = await recurringRepository.findById(recurringId, householdId);
  if (!rule) {
    throw new NotFoundError("Recurring rule not found");
  }

  return await recurringRepository.findLinksByRecurring(recurringId);
}

/**
 * Get change history
 */
async getHistory(
  recurringId: string,
  householdId: string,
  limit?: number
): Promise<RecurringTransactionHistory[]> {
  const rule = await recurringRepository.findById(recurringId, householdId);
  if (!rule) {
    throw new NotFoundError("Recurring rule not found");
  }

  return await recurringRepository.findHistory(recurringId, limit);
}

/**
 * End a recurring rule
 */
async endRecurring(
  id: string,
  householdId: string,
  endDate?: string,
  reason?: string,
  userId?: string
): Promise<RecurringTransaction> {
  const existing = await recurringRepository.findById(id, householdId);
  if (!existing) {
    throw new NotFoundError("Recurring rule not found");
  }

  const rule = await recurringRepository.endRecurring(id, householdId, endDate);
  if (!rule) {
    throw new NotFoundError("Failed to end recurring rule");
  }

  // Log history
  await recurringRepository.logHistory({
    recurringTransactionId: id,
    action: "ended",
    previousState: existing as any,
    newState: rule as any,
    changeReason: reason || "Manually ended",
    performedBy: userId,
  });

  return rule;
}
```

---

## Phase 5: API Endpoints

### 5.1 Add Routes

**File:** `server/routes/recurring.ts`

Add these routes:

```typescript
import {
  detectPatternsSchema,
  confirmPatternSchema,
  linkTransactionSchema,
  endRecurringSchema,
  calendarQuerySchema,
  historyQuerySchema,
} from "../validation/recurringSchemas";

// GET /api/recurring/summary
router.get(
  "/summary",
  asyncHandler(async (req: Request, res: Response) => {
    const { householdId } = req.householdContext!;
    const summary = await recurringService.getSummaryData(householdId);
    res.json({ success: true, data: summary });
  })
);

// POST /api/recurring/detect
router.post(
  "/detect",
  requireRole("member"),
  asyncHandler(async (req: Request, res: Response) => {
    const { householdId } = req.householdContext!;

    const parseResult = detectPatternsSchema.safeParse(req.body);
    const options = parseResult.success ? parseResult.data : {};

    const patterns = await recurringService.detectAndSuggest(householdId, options);

    logger.request(req, "Detected recurring patterns", { count: patterns.length });
    res.json({ success: true, data: patterns });
  })
);

// POST /api/recurring/:id/confirm
router.post(
  "/:id/confirm",
  requireRole("member"),
  asyncHandler(async (req: Request, res: Response) => {
    const { householdId } = req.householdContext!;

    const parseResult = confirmPatternSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid pattern data",
          details: parseResult.error.flatten().fieldErrors,
        },
      });
    }

    const rule = await recurringService.confirmPattern(
      householdId,
      parseResult.data.pattern,
      req.user!.id,
      req.body.accountId
    );

    logger.request(req, "Confirmed recurring pattern");
    res.status(201).json({ success: true, data: rule });
  })
);

// POST /api/recurring/:id/link
router.post(
  "/:id/link",
  requireRole("member"),
  asyncHandler(async (req: Request, res: Response) => {
    const { householdId } = req.householdContext!;
    const { id } = req.params;

    const parseResult = linkTransactionSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid link data",
          details: parseResult.error.flatten().fieldErrors,
        },
      });
    }

    const link = await recurringService.linkTransaction(
      id,
      parseResult.data.transactionId,
      householdId,
      "manual"
    );

    logger.request(req, "Linked transaction to recurring");
    res.status(201).json({ success: true, data: link });
  })
);

// DELETE /api/recurring/links/:linkId
router.delete(
  "/links/:linkId",
  requireRole("member"),
  asyncHandler(async (req: Request, res: Response) => {
    const { householdId } = req.householdContext!;
    const { linkId } = req.params;

    await recurringService.unlinkTransaction(linkId, householdId);

    logger.request(req, "Unlinked transaction");
    res.json({ success: true, data: { message: "Unlinked successfully" } });
  })
);

// GET /api/recurring/:id/history
router.get(
  "/:id/history",
  asyncHandler(async (req: Request, res: Response) => {
    const { householdId } = req.householdContext!;
    const { id } = req.params;

    const parseResult = historyQuerySchema.safeParse(req.query);
    const limit = parseResult.success ? parseResult.data.limit : 50;

    const history = await recurringService.getHistory(id, householdId, limit);
    res.json({ success: true, data: history });
  })
);

// GET /api/recurring/:id/links
router.get(
  "/:id/links",
  asyncHandler(async (req: Request, res: Response) => {
    const { householdId } = req.householdContext!;
    const { id } = req.params;

    const links = await recurringService.getLinkedTransactions(id, householdId);
    res.json({ success: true, data: links });
  })
);

// POST /api/recurring/:id/end
router.post(
  "/:id/end",
  requireRole("member"),
  asyncHandler(async (req: Request, res: Response) => {
    const { householdId } = req.householdContext!;
    const { id } = req.params;

    const parseResult = endRecurringSchema.safeParse(req.body);
    const { endDate, reason } = parseResult.success ? parseResult.data : {};

    const rule = await recurringService.endRecurring(
      id,
      householdId,
      endDate,
      reason,
      req.user!.id
    );

    logger.request(req, "Ended recurring rule");
    res.json({ success: true, data: rule });
  })
);
```

---

## Phase 6: Frontend Enhancements

### 6.1 Update Hooks

**File:** `client/src/hooks/useRecurring.ts`

Add these hooks:

```typescript
// Query keys
export const recurringKeys = {
  all: ["recurring"] as const,
  lists: () => [...recurringKeys.all, "list"] as const,
  list: (params?: RecurringListParams) => [...recurringKeys.lists(), params] as const,
  details: () => [...recurringKeys.all, "detail"] as const,
  detail: (id: string) => [...recurringKeys.details(), id] as const,
  summary: () => [...recurringKeys.all, "summary"] as const,
  upcoming: (days: number) => [...recurringKeys.all, "upcoming", days] as const,
  history: (id: string) => [...recurringKeys.all, "history", id] as const,
  links: (id: string) => [...recurringKeys.all, "links", id] as const,
  patterns: () => [...recurringKeys.all, "patterns"] as const,
};

// Summary hook
export function useRecurringSummary() {
  return useQuery({
    queryKey: recurringKeys.summary(),
    queryFn: async () => {
      const res = await fetch("/api/recurring/summary", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch summary");
      const data = await res.json();
      return data.data;
    },
    staleTime: 60 * 1000,
  });
}

// Pattern detection
export function useDetectPatterns() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (options?: DetectionOptions) => {
      const res = await fetch("/api/recurring/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(options || {}),
      });
      if (!res.ok) throw new Error("Detection failed");
      const data = await res.json();
      return data.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(recurringKeys.patterns(), data);
      toast.success(`Found ${data.length} recurring patterns`);
    },
    onError: () => {
      toast.error("Failed to detect patterns");
    },
  });
}

// Confirm pattern
export function useConfirmPattern() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ pattern, accountId }: { pattern: DetectedPattern; accountId: string }) => {
      const res = await fetch("/api/recurring/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pattern, accountId }),
      });
      if (!res.ok) throw new Error("Confirmation failed");
      const data = await res.json();
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recurringKeys.all });
      toast.success("Recurring rule created");
    },
  });
}

// Link transaction
export function useLinkTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ recurringId, transactionId }: { recurringId: string; transactionId: string }) => {
      const res = await fetch(`/api/recurring/${recurringId}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ transactionId }),
      });
      if (!res.ok) throw new Error("Link failed");
      const data = await res.json();
      return data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: recurringKeys.links(variables.recurringId) });
      queryClient.invalidateQueries({ queryKey: recurringKeys.detail(variables.recurringId) });
      toast.success("Transaction linked");
    },
  });
}

// History
export function useRecurringHistory(id: string) {
  return useQuery({
    queryKey: recurringKeys.history(id),
    queryFn: async () => {
      const res = await fetch(`/api/recurring/${id}/history`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch history");
      const data = await res.json();
      return data.data;
    },
    enabled: !!id,
  });
}

// Linked transactions
export function useRecurringLinks(id: string) {
  return useQuery({
    queryKey: recurringKeys.links(id),
    queryFn: async () => {
      const res = await fetch(`/api/recurring/${id}/links`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch links");
      const data = await res.json();
      return data.data;
    },
    enabled: !!id,
  });
}

// End recurring
export function useEndRecurring() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, endDate, reason }: { id: string; endDate?: string; reason?: string }) => {
      const res = await fetch(`/api/recurring/${id}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ endDate, reason }),
      });
      if (!res.ok) throw new Error("End failed");
      const data = await res.json();
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recurringKeys.all });
      toast.success("Recurring rule ended");
    },
  });
}
```

### 6.2 Create UpcomingBillsWidget

**File:** `client/src/components/recurring/UpcomingBillsWidget.tsx`

```typescript
import { useUpcomingBills } from "@/hooks/useRecurring";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { formatCurrency, formatRelativeDate } from "@/lib/utils";

export function UpcomingBillsWidget() {
  const { data: upcoming, isLoading } = useUpcomingBills(7);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Upcoming Bills
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-8 bg-muted rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const total = upcoming?.reduce((sum, r) => sum + Math.abs(parseFloat(r.amount)), 0) || 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Upcoming Bills
          </span>
          <Link href="/recurring">
            <a className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
              View all <ArrowRight className="h-4 w-4" />
            </a>
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!upcoming?.length ? (
          <p className="text-sm text-muted-foreground">No upcoming bills this week</p>
        ) : (
          <div className="space-y-3">
            {upcoming.slice(0, 5).map(bill => (
              <div key={bill.id} className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{bill.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatRelativeDate(bill.nextDueDate)}
                  </p>
                </div>
                <span className={bill.type === "expense" ? "text-red-500" : "text-green-500"}>
                  {bill.type === "expense" ? "-" : "+"}
                  {formatCurrency(parseFloat(bill.amount))}
                </span>
              </div>
            ))}

            {upcoming.length > 5 && (
              <p className="text-xs text-muted-foreground">
                +{upcoming.length - 5} more
              </p>
            )}

            <div className="pt-3 border-t">
              <div className="flex justify-between font-medium">
                <span>Total Due</span>
                <span>{formatCurrency(total)}</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

---

## Phase 7: Integration

### 7.1 Auto-Link on Transaction Creation

**File:** `server/services/TransactionService.ts`

Add to `createTransaction` method:

```typescript
import { recurringService } from "./RecurringService";

// In createTransaction, after transaction is created:
async createTransaction(data, householdId, userId) {
  const transaction = await transactionRepository.create({
    ...data,
    householdId,
  });

  // Attempt auto-linking to recurring rules
  if (transaction) {
    try {
      await recurringService.autoLinkNewTransaction(transaction, householdId);
    } catch (error) {
      // Don't fail transaction creation if auto-link fails
      logger.warn("Auto-link failed", { transactionId: transaction.id, error });
    }
  }

  return transaction;
}
```

---

## Testing

### Test Files to Create

| File | Phase | Description |
|------|-------|-------------|
| `server/repositories/__tests__/recurringRepository.test.ts` | 1 | Repository CRUD tests |
| `server/services/__tests__/patternDetectionService.test.ts` | 2 | Detection algorithm tests |
| `server/services/__tests__/recurringService.test.ts` | 4 | Service layer tests |
| `server/routes/__tests__/recurring.test.ts` | 5 | API integration tests |
| `client/src/components/recurring/__tests__/` | 6 | Component tests |

### Sample Test Structure

```typescript
// server/services/__tests__/patternDetectionService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";

vi.mock("../../repositories/TransactionRepository");
vi.mock("../../repositories/RecurringRepository");

describe("PatternDetectionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("detectPatterns", () => {
    it("should detect monthly patterns", async () => {
      const { patternDetectionService } = await import("../PatternDetectionService");
      const { transactionRepository } = await import("../../repositories/TransactionRepository");

      const mockTransactions = [
        { id: "1", name: "Netflix", amount: "-15.99", date: "2024-01-01", merchantId: null },
        { id: "2", name: "Netflix", amount: "-15.99", date: "2024-02-01", merchantId: null },
        { id: "3", name: "Netflix", amount: "-15.99", date: "2024-03-01", merchantId: null },
      ];

      (transactionRepository.findForPatternDetection as any).mockResolvedValue(mockTransactions);

      const patterns = await patternDetectionService.detectPatterns("household-1");

      expect(patterns).toHaveLength(1);
      expect(patterns[0].frequency).toBe("monthly");
      expect(patterns[0].confidence).toBeGreaterThanOrEqual(80);
    });

    it("should filter by confidence threshold", async () => {
      // Property-based test
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 50, max: 100 }),
          async (threshold) => {
            const { patternDetectionService } = await import("../PatternDetectionService");

            const patterns = await patternDetectionService.detectPatterns(
              "household-1",
              { confidenceThreshold: threshold }
            );

            return patterns.every(p => p.confidence >= threshold);
          }
        )
      );
    });
  });
});
```

---

## Migration Commands

```bash
# After all schema changes
npm run db:push

# Run server tests
npm run test:server:run

# Run client tests
npm run test:run

# Full coverage
npm run test:coverage:all
```

---

## Complete Task Checklist

### Phase 1: Schema Enhancement
- [ ] Add new columns to `recurringTransactions` in `shared/schema.ts`
- [ ] Create `recurringTransactionLinks` table
- [ ] Create `recurringTransactionHistory` table
- [ ] Add Zod schemas for new tables
- [ ] Export new types
- [ ] Update `server/validation/recurringSchemas.ts`
- [ ] Run `npm run db:push`
- [ ] Create `server/repositories/__tests__/recurringRepository.test.ts`
- [ ] Test new column operations
- [ ] Test link table CRUD

### Phase 2: Pattern Detection Service
- [ ] Create `server/services/PatternDetectionService.ts`
- [ ] Implement `detectPatterns()` method
- [ ] Implement `matchTransaction()` method
- [ ] Implement helper methods (grouping, frequency detection, confidence)
- [ ] Create `server/services/__tests__/patternDetectionService.test.ts`
- [ ] Add property-based tests with fast-check
- [ ] Test various frequency patterns
- [ ] Test edge cases

### Phase 3: Repository Enhancements
- [ ] Add link methods to `RecurringRepository`
  - [ ] `createLink()`
  - [ ] `findLinksByRecurring()`
  - [ ] `findLinkByTransaction()`
  - [ ] `deleteLink()`
- [ ] Add history methods
  - [ ] `logHistory()`
  - [ ] `findHistory()`
- [ ] Add `getSummary()` method
- [ ] Add `endRecurring()` method
- [ ] Add `findForPatternDetection()` to `TransactionRepository`
- [ ] Update repository tests

### Phase 4: Service Layer Updates
- [ ] Add `detectAndSuggest()` to `RecurringService`
- [ ] Add `confirmPattern()` method
- [ ] Add `linkTransaction()` method
- [ ] Add `unlinkTransaction()` method
- [ ] Add `autoLinkNewTransaction()` method
- [ ] Add `getSummaryData()` method
- [ ] Add `getLinkedTransactions()` method
- [ ] Add `getHistory()` method
- [ ] Add `endRecurring()` method
- [ ] Create `server/services/__tests__/recurringService.test.ts`
- [ ] Test pattern confirmation
- [ ] Test linking operations
- [ ] Test history logging

### Phase 5: API Endpoints
- [ ] Add `GET /api/recurring/summary`
- [ ] Add `POST /api/recurring/detect`
- [ ] Add `POST /api/recurring/:id/confirm`
- [ ] Add `POST /api/recurring/:id/link`
- [ ] Add `DELETE /api/recurring/links/:linkId`
- [ ] Add `GET /api/recurring/:id/history`
- [ ] Add `GET /api/recurring/:id/links`
- [ ] Add `POST /api/recurring/:id/end`
- [ ] Create `server/routes/__tests__/recurring.test.ts`
- [ ] Test all endpoints
- [ ] Test validation errors
- [ ] Test authorization

### Phase 6: Frontend Enhancements
- [ ] Add new query keys to `useRecurring.ts`
- [ ] Add `useRecurringSummary()` hook
- [ ] Add `useDetectPatterns()` hook
- [ ] Add `useConfirmPattern()` hook
- [ ] Add `useLinkTransaction()` hook
- [ ] Add `useRecurringHistory()` hook
- [ ] Add `useRecurringLinks()` hook
- [ ] Add `useEndRecurring()` hook
- [ ] Create `UpcomingBillsWidget.tsx`
- [ ] Create `PatternDetectionModal.tsx`
- [ ] Create `SubscriptionDashboard.tsx`
- [ ] Create `RecurringHistoryView.tsx`
- [ ] Update `Recurring.tsx` page
- [ ] Add component tests

### Phase 7: Integration
- [ ] Add auto-linking to `TransactionService.createTransaction()`
- [ ] Add auto-linking to import flow
- [ ] End-to-end testing
- [ ] Manual verification

---

## Verification Checklist

After implementation, verify these flows:

1. **Schema Migration**
   - [ ] New columns exist in database
   - [ ] New tables created
   - [ ] Indexes working

2. **Pattern Detection**
   - [ ] Add 3+ similar transactions
   - [ ] Run detection
   - [ ] Patterns found with correct confidence

3. **Transaction Linking**
   - [ ] Create recurring rule
   - [ ] Link transaction manually
   - [ ] Verify link appears in history

4. **Auto-Linking**
   - [ ] Create recurring rule with autoLinkEnabled
   - [ ] Add matching transaction
   - [ ] Verify auto-linked

5. **Dashboard Widget**
   - [ ] Widget displays on dashboard
   - [ ] Shows upcoming bills
   - [ ] Correct amounts and dates

6. **Summary Statistics**
   - [ ] Monthly totals correct
   - [ ] Subscription count correct
   - [ ] Active count matches

---

## Critical Files Reference

| File | Purpose |
|------|---------|
| `shared/schema.ts` | All schema definitions |
| `server/services/RecurringService.ts` | Core business logic |
| `server/services/PatternDetectionService.ts` | Detection algorithm |
| `server/repositories/RecurringRepository.ts` | Data access |
| `server/routes/recurring.ts` | API endpoints |
| `server/validation/recurringSchemas.ts` | Input validation |
| `client/src/hooks/useRecurring.ts` | React Query hooks |
| `client/src/pages/Recurring.tsx` | Main UI page |
| `client/src/components/recurring/UpcomingBillsWidget.tsx` | Dashboard widget |
