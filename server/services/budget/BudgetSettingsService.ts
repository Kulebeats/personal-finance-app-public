import { eq } from "drizzle-orm";
import { householdPreferences } from "@shared/schema";
import { withTransaction } from "../../utils/withTransaction";
import { businessAuditService } from "../BusinessAuditService";
import { ensureFlexBudgetInTx, lockHouseholdPreferences, type FlexBudgetActor, type HouseholdPreferences } from "./flexBudget";

/**
 * Budget settings (PUT /api/budgets/settings), NEW-32.
 *
 * One transaction: the household's preferences row is created if missing and
 * locked, updated, and audited, and switching to the flex system creates the
 * flex budget with its own audit row. A failed audit insert rolls every part
 * back (Rule 9). The flex budget comes from the shared helper in flexBudget.ts,
 * whose preferences lock serialises every flex budget creator.
 */
export type BudgetApplyScope = "this_month" | "all_future";

export interface BudgetSettingsInput {
  readonly budgetSystem?: "flex" | "category";
  readonly defaultApplyScope?: BudgetApplyScope;
}

export type BudgetSettingsActor = FlexBudgetActor;

export interface BudgetSettingsView {
  readonly budgetSystem: string;
  readonly defaultApplyScope: BudgetApplyScope;
}

type Preferences = HouseholdPreferences;
type PreferencesPatch = Partial<Pick<Preferences, "budgetSystem" | "defaultBudgetScope" | "defaultMonthOnlyChanges">>;

const DEFAULT_BUDGET_SYSTEM = "flex";

export function toBudgetSettingsView(preferences: Pick<Preferences, "budgetSystem" | "defaultBudgetScope">): BudgetSettingsView {
  return {
    budgetSystem: preferences.budgetSystem || DEFAULT_BUDGET_SYSTEM,
    defaultApplyScope: preferences.defaultBudgetScope === "all_future" ? "all_future" : "this_month",
  };
}

function toPatch(input: BudgetSettingsInput): PreferencesPatch {
  return {
    ...(input.budgetSystem ? { budgetSystem: input.budgetSystem } : {}),
    ...(input.defaultApplyScope ? {
      defaultBudgetScope: input.defaultApplyScope === "all_future" ? "all_future" : "current_month",
      defaultMonthOnlyChanges: input.defaultApplyScope !== "all_future",
    } : {}),
  };
}

const auditedFields = (row: Preferences) => ({
  budgetSystem: row.budgetSystem,
  defaultBudgetScope: row.defaultBudgetScope,
  defaultMonthOnlyChanges: row.defaultMonthOnlyChanges,
});

export async function updateBudgetSettings(actor: BudgetSettingsActor, input: BudgetSettingsInput): Promise<BudgetSettingsView> {
  return withTransaction(async (tx) => {
    const current = await lockHouseholdPreferences(tx, actor.householdId);
    const [updated] = await tx.update(householdPreferences).set({ ...toPatch(input), updatedAt: new Date() })
      .where(eq(householdPreferences.householdId, actor.householdId)).returning();
    await businessAuditService.logUpdate({
      tx, userId: actor.userId, householdId: actor.householdId, entityType: "household_preferences",
      entityId: actor.householdId, ipAddress: actor.ipAddress,
      oldValue: auditedFields(current), newValue: auditedFields(updated), metadata: { action: "budget_settings_update" },
    });
    if (input.budgetSystem === "flex") await ensureFlexBudgetInTx(tx, actor, "budget_settings");
    return toBudgetSettingsView(updated);
  });
}
