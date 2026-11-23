import { and, eq, inArray, sql } from "drizzle-orm";
import { accounts, budgetPeriods, budgets, categories, categoryGroups, fxRates, householdFxRateOverrides, householdMembers, householdPreferences, households, notifications, transactions, transactionSplits, userNotificationPreferences, userPushSubscriptions, users, type Notification } from "@shared/schema";
import { NOTIFICATION_TYPES, type NotificationType } from "@shared/notificationTypes";
import { db } from "../../db";
import { isHouseholdRole } from "../../core/authz/capabilities";
import { ConflictError } from "../../core/errors";
import { assembleBudgetProgress } from "../../repositories/BudgetQueryRepository";
import { budgetProgressInputsQuery, readBudgetProgressInputs, type BudgetProgressInputs } from "../../repositories/BudgetProgressReadRepository";
import type { BudgetReadContext } from "../../repositories/BudgetReadContext";
import type { TransactionType } from "../../utils/withTransaction";

type Preferences = { inAppEnabled: boolean; emailEnabled: boolean; pushEnabled: boolean };
type Admission = { admitted: boolean; notification: Notification | null; preferences: Preferences };
const denied = (): Admission => ({ admitted: false, notification: null, preferences: { inAppEnabled: false, emailEnabled: false, pushEnabled: false } });
export function budgetReviewMessage(userId: string, householdId: string, year: number, month: number) {
  return { title: "Review your budget", body: "Open Budgets to see your current limits and activity.", actionUrl: "/budget",
    dedupeKey: `budget-review:${householdId}:${year}-${month}:user:${userId}` };
}

async function withCurrentCrossing<T>(userId: string, householdId: string, year: number, month: number, absent: T,
  operation: (tx: TransactionType, preferences: Preferences, input: BudgetProgressInputs, context: BudgetReadContext, type: NotificationType) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await db.transaction(async tx => {
      const [initialMember] = await tx.select({ role: householdMembers.role }).from(householdMembers)
        .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)));
      if (!initialMember || !isHouseholdRole(initialMember.role) || ["view_only", "professional"].includes(initialMember.role)) return absent;
      const initial = await readBudgetProgressInputs(householdId, year, month,
        { kind: "actor", actor: { householdId, userId, role: initialMember.role } }, tx);
      const targets = initial.lockTargets;
      if (!targets) throw new ConflictError("Budget publication sources are unavailable");
      // Match ordinary transaction editing: transaction first, then account.
      // Only contributing sources are locked; no whole-household/FX-table lock.
      await tx.select({ id: transactions.id }).from(transactions).where(inArray(transactions.id, targets.transactions)).orderBy(transactions.id).for("update");
      await tx.select({ id: accounts.id }).from(accounts).where(inArray(accounts.id, targets.accounts)).orderBy(accounts.id).for("update");
      await tx.select({ id: households.id }).from(households).where(eq(households.id, householdId)).for("share");
      const [user] = await tx.select({ verified: users.emailVerified }).from(users).where(eq(users.id, userId)).for("update");
      const [member] = await tx.select({ role: householdMembers.role }).from(householdMembers)
        .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId))).for("share");
      if (!user?.verified || !member || !isHouseholdRole(member.role) || ["view_only", "professional"].includes(member.role)) return absent;
      await tx.select({ id: householdPreferences.householdId }).from(householdPreferences).where(eq(householdPreferences.householdId, householdId)).for("share");
      await tx.select({ id: categoryGroups.id }).from(categoryGroups).where(inArray(categoryGroups.id, targets.groups)).orderBy(categoryGroups.id).for("share");
      await tx.select({ id: categories.id }).from(categories).where(inArray(categories.id, targets.categories)).orderBy(categories.id).for("share");
      await tx.select({ id: transactionSplits.id }).from(transactionSplits)
        .where(inArray(transactionSplits.transactionId, targets.transactions)).orderBy(transactionSplits.id).for("share");
      await tx.select({ id: budgets.id }).from(budgets).where(inArray(budgets.id, targets.budgets)).orderBy(budgets.id).for("update");
      await tx.select({ id: budgetPeriods.id }).from(budgetPeriods).where(inArray(budgetPeriods.id, targets.periods)).orderBy(budgetPeriods.id).for("share");
      // FIN-06: hold exactly the rate rows the shared resolver used (a household
      // manual rate or a shared fx_rates row). A newer rate that would win is a
      // phantom; the final statement's to_jsonb comparison refuses it.
      await tx.select({ id: householdFxRateOverrides.id }).from(householdFxRateOverrides).where(inArray(householdFxRateOverrides.id, targets.fxOverrides)).orderBy(householdFxRateOverrides.id).for("share");
      await tx.select({ id: fxRates.id }).from(fxRates).where(inArray(fxRates.id, targets.fxRates)).orderBy(fxRates.id).for("share");
      const input = await readBudgetProgressInputs(householdId, year, month,
        { kind: "actor", actor: { householdId, userId, role: member.role } }, tx);
      if (JSON.stringify(input.lockTargets) !== JSON.stringify(targets)) throw new ConflictError("Budget publication audience changed");
      const { progress, preferences } = assembleBudgetProgress(input, year, month,
        { context: { kind: "actor", actor: { householdId, userId, role: member.role } } });
      const exceeded = progress.some(row => row.percentUsed >= 100 || row.percentUsed >= (row.alertThreshold ?? preferences.alertThreshold));
      const warning = progress.some(row => row.percentUsed >= (row.warningThreshold ?? preferences.warningThreshold));
      if (!exceeded && !warning) return absent;
      const type = exceeded ? NOTIFICATION_TYPES.BUDGET_EXCEEDED : NOTIFICATION_TYPES.BUDGET_WARNING;
      const [stored] = await tx.select().from(userNotificationPreferences).where(and(
        eq(userNotificationPreferences.userId, userId), eq(userNotificationPreferences.notificationType, type))).for("share");
      const channels = { inAppEnabled: stored?.inAppEnabled ?? true, emailEnabled: stored?.emailEnabled ?? false, pushEnabled: stored?.pushEnabled ?? false };
      if (!channels.inAppEnabled && !channels.emailEnabled && !channels.pushEnabled) return absent;
      return operation(tx, channels, input, { kind: "actor", actor: { householdId, userId, role: member.role } }, type);
    }); } catch (error) { if (!(error instanceof ConflictError) || attempt === 2) throw error; }
  }
  return absent;
}

/** Archived records are durable claims for external-only recipients. They are
 * hidden from the normal in-app list and prevent implicit duplicate dispatch. */
export async function publishBudgetReview(userId: string, householdId: string, year: number, month: number): Promise<Admission> {
  const payload = budgetReviewMessage(userId, householdId, year, month);
  const [existing] = await db.select({ id: notifications.id }).from(notifications).where(and(
    eq(notifications.userId, userId), eq(notifications.dedupeKey, payload.dedupeKey))).limit(1);
  if (existing) return denied();
  return withCurrentCrossing(userId, householdId, year, month, denied(), async (tx, channels, input, context) => {
    const metadata = { internalBudgetDeliveryClaim: !channels.inAppEnabled,
      delivery: { email: channels.emailEnabled ? "claimed" : "disabled", push: channels.pushEnabled ? "claimed" : "disabled" } };
    // The final financial read and insert share one statement snapshot. A new
    // competing rate (or other phantom source) cannot enter between them.
    const created = await tx.execute<{ id: string }>(sql`with final_input as materialized (
      ${budgetProgressInputsQuery(householdId, year, month, context)}
    ) insert into ${notifications} (user_id, household_id, type, title, body, action_url, dedupe_key, is_archived, metadata)
      select ${userId}::uuid,${householdId}::uuid,${NOTIFICATION_TYPES.BUDGET_WARNING},${payload.title},${payload.body},
        ${payload.actionUrl},${payload.dedupeKey},${!channels.inAppEnabled},${JSON.stringify(metadata)}::jsonb
      from final_input where to_jsonb(final_input)=${JSON.stringify(input)}::jsonb
      on conflict do nothing returning id`);
    if (!created.rows.length) {
      const [duplicate] = await tx.select({ id: notifications.id }).from(notifications).where(and(
        eq(notifications.userId, userId), eq(notifications.dedupeKey, payload.dedupeKey))).limit(1);
      if (duplicate) return denied();
      throw new ConflictError("Budget publication inputs changed");
    }
    const [notification] = await tx.select().from(notifications).where(eq(notifications.id, created.rows[0].id));
    return { admitted: true, notification, preferences: channels };
  });
}

/** Fresh preflight at the adapter boundary; this does not claim that a provider
 * can retract a message once its irreversible dispatch has begun. */
export type BudgetReviewDestination = { channel: "email"; address: string } |
  { channel: "push"; endpoint: string; keys: { p256dh: string; auth: string } };
export async function canDispatchBudgetReview(userId: string, householdId: string, year: number, month: number, destination: BudgetReviewDestination): Promise<boolean> {
  return withCurrentCrossing(userId, householdId, year, month, false, async (tx, preferences, input, context, type) => {
    const email = destination.channel === "email";
    if (email ? !preferences.emailEnabled : !preferences.pushEnabled) return false;
    if (destination.channel === "push") await tx.select({ id: userPushSubscriptions.id }).from(userPushSubscriptions).where(and(
      eq(userPushSubscriptions.userId, userId), eq(userPushSubscriptions.endpoint, destination.endpoint))).for("share");
    const matchesDestination = destination.channel === "email"
      ? sql`exists(select 1 from ${users} where ${users.id}=${userId}::uuid and ${users.emailVerified}=true and ${users.email}=${destination.address})`
      : sql`exists(select 1 from ${userPushSubscriptions} where ${userPushSubscriptions.userId}=${userId}::uuid
          and ${userPushSubscriptions.endpoint}=${destination.endpoint} and ${userPushSubscriptions.keys}->>'p256dh'=${destination.keys.p256dh}
          and ${userPushSubscriptions.keys}->>'auth'=${destination.keys.auth})`;
    const consent = email ? userNotificationPreferences.emailEnabled : userNotificationPreferences.pushEnabled;
    // No later preference/address/subscription SELECT can separate destination
    // admission from the final financial cut used to authorize this dispatch.
    const current = await tx.execute<{ admitted: boolean }>(sql`with final_input as materialized (
      ${budgetProgressInputsQuery(householdId, year, month, context)}
    ) select (to_jsonb(final_input)=${JSON.stringify(input)}::jsonb and ${matchesDestination}
      and exists(select 1 from ${userNotificationPreferences} where ${userNotificationPreferences.userId}=${userId}::uuid
        and ${userNotificationPreferences.notificationType}=${type} and ${consent}=true)) as admitted from final_input`);
    return current.rows[0]?.admitted === true;
  });
}
