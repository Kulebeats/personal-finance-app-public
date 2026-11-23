/**
 * Notification audiences.
 *
 * A household fan-out reaches every notifiable member. A notice about a
 * recurring rule reaches only the members who can see that rule through the
 * same `visibleRulePredicate` the recurring screens use, so a rule on one
 * member's private account never names itself or its amount to the others
 * (FIN-01 / OPS-005). A goal milestone is a fraction of the goal's progress,
 * so it reaches only the members who can see all of that progress (#235 M6).
 * A stale-price notice names a security, so it reaches only the members who
 * can see a holding of it, through the account custody holdings use (A-57).
 *
 * @module services/notification/audience
 */

import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { accounts, goals, holdings, householdMembers, households, recurringTransactions, securities, type Goal } from "@shared/schema";
import { db } from "../../db";
import { isHouseholdRole } from "../../core/authz/capabilities";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import { visibleGoalProgressSources } from "../../core/authz/goal-progress-visibility";
import { visibleRulePredicate } from "../recurring/RecurringAudienceQuery";
import { progressVisibleToEach } from "../goal/GoalViewerProgress";
import type { TransactionType } from "../../utils/withTransaction";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { ChannelResult } from "./delivery";

/**
 * Membership order: who joined first, then by user id for members who joined in
 * the same instant. Without it Postgres returns rows in heap order, which an
 * update of a member's row (last_active_at on each login) changes.
 */
const MEMBERSHIP_ORDER = [asc(householdMembers.joinedAt), asc(householdMembers.userId)] as const;

/** Roles that never receive household notifications. */
export const HOUSEHOLD_NOTIFICATION_EXCLUDED_ROLES: ReadonlySet<string> = new Set([
  "view_only",
  "professional",
]);

/**
 * Members of the household who can see all of this goal's progress, in
 * membership order. Every member's verdict comes from one statement, since a
 * writer runs this while it holds the goal row (#235 R3-3).
 */
export async function goalProgressAudience(
  householdId: string,
  goalId: string,
  executor: typeof db | TransactionType = db,
): Promise<string[]> {
  const candidates = await notifiableMembers(householdId, executor);
  const visible = await progressVisibleToEach(householdId, goalId, candidates, executor);
  return candidates.filter((_, index) => visible[index]).map(({ userId }) => userId);
}

/** A membership row as a notifiable viewer, or nothing for a role that is never notified. */
function asNotifiable(householdId: string, userId: string | null, role: string): HouseholdContext[] {
  return userId && !HOUSEHOLD_NOTIFICATION_EXCLUDED_ROLES.has(role) && isHouseholdRole(role)
    ? [{ householdId, userId, role }]
    : [];
}

/** Members who receive household notifications, as viewers, in membership order. */
export async function notifiableMembers(
  householdId: string,
  executor: typeof db | TransactionType = db,
): Promise<HouseholdContext[]> {
  const members = await executor
    .select({ userId: householdMembers.userId, role: householdMembers.role })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId))
    .orderBy(...MEMBERSHIP_ORDER);
  return members.flatMap(({ userId, role }) => asNotifiable(householdId, userId, role));
}

/**
 * The current rows of the goals among `goalIds` (and matching `filter`) whose
 * progress this member can see now. The goal rows, the member's membership in
 * the role they were drawn with, and the progress verdict are one statement,
 * so a batch job that calls this right before a send never pairs a fresh
 * verdict with a stale goal or a departed member (#245, Astra round 3 and its
 * pre-check). A changed role reads as gone until the next run draws it again.
 */
export async function goalsVisibleToMemberNow(
  member: HouseholdContext,
  goalIds: readonly string[],
  filter?: SQL,
  tx?: TransactionType,
): Promise<Goal[]> {
  if (!goalIds.length) return [];
  if (tx) await lockGoalVerdictInputs(tx, member);
  const stillMember = sql`exists (select 1 from ${householdMembers} where ${and(
    eq(householdMembers.householdId, member.householdId),
    eq(householdMembers.userId, member.userId),
    eq(householdMembers.role, member.role),
  )})`;
  return (tx ?? db).select().from(goals).where(and(
    eq(goals.householdId, member.householdId), inArray(goals.id, [...goalIds]), filter,
    stillMember, visibleGoalProgressSources(member),
  ));
}

/**
 * Holds still, until the caller's transaction commits, every row a goal verdict
 * reads that a privacy or membership change writes: the household's accounts
 * (an account made private; a transaction edit locks its account), its goals
 * (a new link or transfer locks the goal) and this member's row (removal, a role
 * change). Any UPDATE or DELETE of those rows conflicts with FOR SHARE, so it
 * waits for the notice, or the notice waits for it and reads its result.
 *
 * The order is the writers' (#245 round 5): the household row first (KEY SHARE,
 * the lock the notice's own foreign key takes), then the membership row, then
 * accounts, then goals, each by id. Tag writes, erasure and `lockHousehold` lock
 * the household and its memberships before any account, and the recurring notice
 * reads membership before its account, so none of them can hold an account while
 * waiting for a membership this reader holds.
 *
 * Not yet in this order: `BudgetAlertPublication` locks the transaction and its
 * account before the household and membership. Against this reader alone that
 * cannot deadlock (its later locks are SHARE), but with a tag write in the same
 * household the three can, as the budget alert and a tag write already can with
 * each other. Reordering the budget alert is a separate follow-up.
 */
async function lockGoalVerdictInputs(tx: TransactionType, member: HouseholdContext): Promise<void> {
  await tx.select({ id: households.id }).from(households)
    .where(eq(households.id, member.householdId)).for("key share");
  await tx.select({ id: householdMembers.id }).from(householdMembers).where(and(
    eq(householdMembers.householdId, member.householdId), eq(householdMembers.userId, member.userId),
  )).for("share");
  await tx.select({ id: accounts.id }).from(accounts)
    .where(eq(accounts.householdId, member.householdId)).orderBy(accounts.id).for("share");
  await tx.select({ id: goals.id }).from(goals)
    .where(eq(goals.householdId, member.householdId)).orderBy(goals.id).for("share");
}

/** Members of the household who may see this recurring rule, in membership order. */
export async function recurringRuleAudience(householdId: string, ruleId: string): Promise<string[]> {
  const members = await db
    .select({ userId: householdMembers.userId, role: householdMembers.role })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId))
    .orderBy(...MEMBERSHIP_ORDER);

  const recipients: string[] = [];
  for (const member of members) {
    if (!member.userId || HOUSEHOLD_NOTIFICATION_EXCLUDED_ROLES.has(member.role)) continue;
    if (!isHouseholdRole(member.role)) continue;
    const actor = { householdId, userId: member.userId, role: member.role };
    const [visible] = await db
      .select({ id: recurringTransactions.id })
      .from(recurringTransactions)
      .where(and(eq(recurringTransactions.id, ruleId), visibleRulePredicate(actor)))
      .limit(1);
    if (visible) recipients.push(member.userId);
  }
  return recipients;
}

/** Members of the household who can see a holding of this security, in membership order (A-57). */
export async function securityHoldingAudience(householdId: string, securityId: string): Promise<string[]> {
  const recipients: string[] = [];
  for (const member of await notifiableMembers(householdId)) {
    const [visible] = await db
      .select({ id: holdings.id })
      .from(holdings)
      .innerJoin(accounts, eq(accounts.id, holdings.accountId))
      .where(and(eq(holdings.householdId, householdId), eq(holdings.securityId, securityId), visibleAccountPredicate(member)))
      .limit(1);
    if (visible) recipients.push(member.userId);
  }
  return recipients;
}

/** In-app publication holds its current grant and a visible position through commit.
 * External channels call this immediately before dispatch, including each push device.
 */
export async function stalePriceDispatchHold(
  householdId: string, userId: string, securityId: string, boundQuote: Date, tx?: TransactionType,
): Promise<ChannelResult | null> {
  const held: ChannelResult = { status: "suppressed", reason: "not_visible" };
  const executor = tx ?? db;
  if (tx) {
    // Same order as custody writers: household, membership, holdings, accounts, then security.
    const [household] = await tx.select({ id: households.id }).from(households)
      .where(eq(households.id, householdId)).for("key share");
    if (!household) return held;
  }
  const memberships = executor.select({ role: householdMembers.role }).from(householdMembers).where(and(
    eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId),
  ));
  const [membership] = tx ? await memberships.for("share") : await memberships;
  const [actor] = membership ? asNotifiable(householdId, userId, membership.role) : [];
  if (!actor) return held;

  const position = and(eq(holdings.householdId, householdId), eq(holdings.securityId, securityId));
  if (tx) {
    const sources = await tx.select({ accountId: holdings.accountId }).from(holdings)
      .where(position).orderBy(holdings.id).for("share");
    if (!sources.length) return held;
    const [account] = await tx.select({ id: accounts.id }).from(accounts).where(and(
      inArray(accounts.id, sources.map(source => source.accountId)), visibleAccountPredicate(actor),
    )).orderBy(accounts.id).limit(1).for("share");
    if (!account) return held;
    const [quote] = await tx.select({ lastPriceUpdate: securities.lastPriceUpdate }).from(securities)
      .where(eq(securities.id, securityId)).for("share");
    return quote?.lastPriceUpdate?.getTime() === boundQuote.getTime() ? null : held;
  }

  // The current custody, quoted timestamp, and the still-notifiable role are
  // checked together after preferences and before returning to the transport.
  const [quote] = await db.select({ lastPriceUpdate: securities.lastPriceUpdate }).from(holdings)
    .innerJoin(accounts, eq(accounts.id, holdings.accountId))
    .innerJoin(securities, eq(securities.id, holdings.securityId))
    .innerJoin(householdMembers, and(
      eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId),
      eq(householdMembers.role, actor.role),
    ))
    .where(and(position, visibleAccountPredicate(actor))).limit(1);
  return quote?.lastPriceUpdate?.getTime() === boundQuote.getTime() ? null : held;
}
