export type GoalType = "save_up" | "pay_down" | "investment";
export type GoalStatus = "on_track" | "behind" | "at_risk" | "completed";
export type PayoffMethod = "avalanche" | "snowball" | "custom";
export type AssignmentType = "full_balance" | "partial_balance";
export type TransactionLinkType = "contribution" | "spending";
import type { MoneyDto } from "@shared/money";

export type WizardStep = "select" | "targets" | "contribution" | "budget";

export type SaveUpGoalType =
  | "vacation"
  | "emergency_fund"
  | "down_payment"
  | "wedding"
  | "vehicle"
  | "home_improvement"
  | "special_event"
  | "education"
  | "other";

export type PayDownGoalType =
  | "credit_card"
  | "student_loan"
  | "car_loan"
  | "mortgage"
  | "personal_loan"
  | "medical_debt"
  | "other";

export type InvestmentGoalType =
  | "retirement"
  | "wealth_building"
  | "education"
  | "property"
  | "other";

export interface Goal {
  id: string;
  householdId: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  customImageUrl?: string | null;
  targetAmount: string;
  currentAmount: string;
  currency: string;
  targetDate?: string | null;
  startDate: string;
  projectedCompletionDate?: string | null;
  monthlyProjection?: string | null;
  linkedAccountId?: string | null;
  expectedReturn?: string | null;
  inflationRate?: string | null;
  progressSource?: "contributions" | "holdings" | null;
  type: GoalType;
  goalType?: string | null;
  status: GoalStatus;
  /** "unavailable" when a progress source is another member's private item; the server then withholds progress. */
  progressAvailability?: "available" | "unavailable";
  spendingReducesProgress?: boolean | null;
  debtAccountId?: string | null;
  originalBalance?: string | null;
  interestRate?: string | null;
  minimumPayment?: string | null;
  monthlyPayment?: string | null;
  oneTimePayment?: string | null;
  payoffMethod?: PayoffMethod | null;
  priority?: number | null;
  notes?: string | null;
  createdBy?: string | null;
  isCompleted: boolean;
  completedAt?: string | null;
  isArchived: boolean;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoalWithProgress extends Goal {
  percentComplete: number;
  remaining: number;
  daysLeft?: number | null;
  assignments?: GoalAccountAssignment[];
}

export interface GoalAccountAssignment {
  id: string;
  goalId: string;
  accountId: string;
  assignmentType: AssignmentType;
  partialAmount?: string | null;
  autoUpdate: boolean;
  createdAt: string;
  updatedAt: string;
  accountName?: string | null;
  accountBalance?: string | null;
  accountCurrency?: string | null;
  accountType?: string | null;
}

export interface GoalsSummaryData {
  saveUp: {
    total: number;
    onTrack: number;
    behind: number;
    atRisk: number;
    completed: number;
    totalSaved: MoneyDto;
    totalTarget: MoneyDto;
    overallProgress: number;
    /** Goals left out of the totals: no rate to the household currency (A-09). */
    excludedCount?: number;
  };
  payDown: {
    total: number;
    totalDebt: MoneyDto;
    totalPaid: MoneyDto;
    projectedInterest: MoneyDto;
    onTrack: number;
    behind: number;
    excludedCount?: number;
  };
}

export interface GoalsPageData {
  saveUpGoals: Goal[];
  payDownGoals: Goal[];
  goalsOnTrack: number;
  summary: GoalsSummaryData | undefined;
  isLoading: boolean;
  error: Error | null;
}
