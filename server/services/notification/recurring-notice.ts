/**
 * Recurring-due notice bound to one authorization (#184 follow-up, #226 fix-forward).
 *
 * The cron hands over identifiers only. For each recipient:
 *
 * - Publish locks the rule, its account and the recipient's membership row
 *   FOR SHARE, then reads the rule's content together with that recipient's
 *   right to see it (`visibleRulePredicate`) in one statement, and writes the
 *   in-app row in the same transaction. A privacy change in flight is waited
 *   for, and one committed while the notice is written cannot land in between.
 *   READ COMMITTED, so a concurrent run's row deduplicates instead of raising
 *   a serialization failure.
 * - Every e-mail send and every push device re-reads the rule as it is now.
 *   It is sent only if the recipient can still see it AND its content-defining
 *   fields (account, name, amount, currency, due date) still match what was
 *   bound. Otherwise the channel is suppressed: `not_visible` or
 *   `content_changed`.
 * - REC (owner decision a1): the e-mail goes to one member, the rule's e-mail
 *   owner (recurring-owner-email.ts). Who that is, whether they may see the
 *   rule, and what it says are one locked decision (`recurringEmailDecision`),
 *   taken again inside the send. In-app and push keep the whole audience.
 *
 * @module services/notification/recurring-notice
 */
import { and, eq } from "drizzle-orm";
import { accounts, householdMembers, households, notifications, recurringTransactions, type Notification } from "@shared/schema";
import { NOTIFICATION_TYPES } from "@shared/notificationTypes";
import { db } from "../../db";
import { Money } from "../../core/money";
import { isHouseholdRole } from "../../core/authz/capabilities";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { TransactionType } from "../../utils/withTransaction";
import { visibleRulePredicate } from "../recurring/RecurringAudienceQuery";
import { HOUSEHOLD_NOTIFICATION_EXCLUDED_ROLES } from "./audience";
import type { ChannelResult } from "./delivery";

/** Which notice: the content is never carried, only read under authorization. */
export interface RecurringNoticeRef {
  householdId: string;
  recurringId: string;
  dueDate: string;
}

/** The rule fields a notice is built from; a send needs all of them unchanged. */
export interface RecurringNoticeContent {
  accountId: string | null;
  name: string;
  amount: string;
  currency: string;
  nextDueDate: string;
}

export interface RecurringNoticeMessage {
  title: string;
  body: string;
  actionUrl: string;
  metadata: Record<string, unknown>;
  dedupeKey: string;
}

export interface PublishedRecurringNotice {
  message: RecurringNoticeMessage;
  /** What the message was built from: the only content a later send may carry. */
  content: RecurringNoticeContent;
  /** The in-app row written in the same transaction; null when in-app is off or it already existed. */
  notification: Notification | null;
}

type Executor = typeof db | TransactionType;

export const NOT_VISIBLE: ChannelResult = { status: "suppressed", reason: "not_visible" };
export const CONTENT_CHANGED: ChannelResult = { status: "suppressed", reason: "content_changed" };
/** REC a1: a per-recipient notice leaves the e-mail to the owner e-mail. */
export const EMAIL_OWNER_ONLY: ChannelResult = { status: "suppressed", reason: "email_owner_only" };
/** REC a1: this member was not the e-mail owner when the send was decided. */
export const NOT_EMAIL_OWNER: ChannelResult = { status: "suppressed", reason: "not_email_owner" };
/**
 * None of these says this member should not get the e-mail for good: the owner
 * e-mail may take the row again when they are its owner (`sent` and `unknown` stay final).
 */
export const RECONSIDERED_EMAIL_REASONS = ["email_owner_only", "not_email_owner", "not_visible"] as const;

export function recurringNoticeDedupeKey(ref: RecurringNoticeRef, userId: string): string {
  return `recurring:${ref.recurringId}:${ref.dueDate}:user:${userId}`;
}

async function noticeActor(executor: Executor, householdId: string, userId: string, lock: boolean): Promise<HouseholdContext | null> {
  const query = executor.select({ role: householdMembers.role }).from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId))).limit(1);
  const [member] = lock ? await query.for("share") : await query;
  if (!member || HOUSEHOLD_NOTIFICATION_EXCLUDED_ROLES.has(member.role) || !isHouseholdRole(member.role)) return null;
  return { householdId, userId, role: member.role };
}

/** Holds the rule and its account still until the notice is written. False when the rule is gone. */
async function lockRuleSource(tx: TransactionType, ref: RecurringNoticeRef): Promise<boolean> {
  const [rule] = await tx.select({ accountId: recurringTransactions.accountId }).from(recurringTransactions)
    .where(and(eq(recurringTransactions.id, ref.recurringId), eq(recurringTransactions.householdId, ref.householdId)))
    .for("share");
  if (!rule) return false;
  if (rule.accountId) await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, rule.accountId)).for("share");
  return true;
}

/** The rule's content, only when this recipient may see it now: content and verdict come from one read. */
async function readVisibleRule(executor: Executor, actor: HouseholdContext, ruleId: string): Promise<RecurringNoticeContent | null> {
  const [rule] = await executor
    .select({
      accountId: recurringTransactions.accountId, name: recurringTransactions.name, amount: recurringTransactions.amount,
      currency: accounts.currency, nextDueDate: recurringTransactions.nextDueDate,
    })
    .from(recurringTransactions)
    .innerJoin(accounts, eq(accounts.id, recurringTransactions.accountId))
    .where(and(eq(recurringTransactions.id, ruleId), eq(recurringTransactions.isActive, true),
      eq(recurringTransactions.isPaused, false), visibleRulePredicate(actor)))
    .limit(1);
  return rule ?? null;
}

export interface RecurringEmailDecision {
  owner: string;
  content: RecurringNoticeContent;
  message: RecurringNoticeMessage;
}

/** Test seam: runs inside the decision, after the owner is read and before their visibility is. */
export const emailDecisionProbe: { betweenReads?: () => Promise<void> } = {};

/**
 * REC (owner decision a1): who the bill reminder e-mail goes to, and with what.
 * A rule has no owner column; its owner is its account's owner. When that
 * member cannot see the rule or is not notifiable, the household owner is,
 * under the same check; otherwise no one is e-mailed.
 *
 * One transaction holds the household row, the rule, its account and the
 * deciding membership rows FOR SHARE, so an ownership, privacy or role change
 * waits for it, and so does a join: acceptInvite takes the household row FOR
 * UPDATE before it writes a membership. The owner, their right to see the rule
 * and the content it says come from one state.
 * `use` runs inside that transaction, so a send made there goes out while the
 * decision still holds.
 */
export async function withRecurringEmailDecision<T>(
  ref: RecurringNoticeRef, use: (decision: RecurringEmailDecision | null) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => use(await decideEmail(tx, ref)));
}

export async function recurringEmailDecision(ref: RecurringNoticeRef): Promise<RecurringEmailDecision | null> {
  return withRecurringEmailDecision(ref, async (decision) => decision);
}

async function decideEmail(tx: TransactionType, ref: RecurringNoticeRef): Promise<RecurringEmailDecision | null> {
  // Parent first, as joins, ownership changes and erasure lock it.
  await tx.select({ id: households.id }).from(households).where(eq(households.id, ref.householdId)).for("share");
  if (!(await lockRuleSource(tx, ref))) return null;
  const [rule] = await tx.select({ ownerUserId: accounts.ownerUserId }).from(recurringTransactions)
    .innerJoin(accounts, eq(accounts.id, recurringTransactions.accountId))
    .where(and(eq(recurringTransactions.id, ref.recurringId), eq(recurringTransactions.householdId, ref.householdId)))
    .limit(1);
  const [householdOwner] = await tx.select({ userId: householdMembers.userId }).from(householdMembers)
    .where(and(eq(householdMembers.householdId, ref.householdId), eq(householdMembers.role, "owner")))
    .orderBy(householdMembers.id).limit(1).for("share");
  await emailDecisionProbe.betweenReads?.();
  for (const candidate of [rule?.ownerUserId, householdOwner?.userId]) {
    if (!candidate) continue;
    const actor = await noticeActor(tx, ref.householdId, candidate, true);
    const content = actor && await readVisibleRule(tx, actor, ref.recurringId);
    if (!content) continue;
    if (content.nextDueDate !== ref.dueDate) return null;
    return { owner: candidate, content, message: buildMessage(ref, candidate, content) };
  }
  return null;
}

export function sameContent(a: RecurringNoticeContent, b: RecurringNoticeContent): boolean {
  return a.accountId === b.accountId && a.name === b.name && a.amount === b.amount
    && a.currency === b.currency && a.nextDueDate === b.nextDueDate;
}

function buildMessage(ref: RecurringNoticeRef, userId: string, rule: RecurringNoticeContent): RecurringNoticeMessage {
  const formattedAmount = new Money(rule.amount, rule.currency).format();
  const formattedDate = new Date(ref.dueDate).toLocaleDateString("en-ZM", { month: "short", day: "numeric" });
  return {
    title: `Upcoming: ${rule.name}`,
    body: `${rule.name} for ${formattedAmount} is due on ${formattedDate}`,
    actionUrl: "/recurring",
    metadata: { recurringId: ref.recurringId, amount: rule.amount, currency: rule.currency, dueDate: ref.dueDate },
    dedupeKey: recurringNoticeDedupeKey(ref, userId),
  };
}

/**
 * Reads the content this recipient may see and, when `writeInApp`, writes the
 * in-app row in the same transaction. Null when the recipient cannot see the
 * rule, or the rule is no longer due on the notice's date.
 */
export async function publishRecurringNotice(
  userId: string, ref: RecurringNoticeRef, writeInApp: boolean,
  onPublished?: (tx: TransactionType) => Promise<void>,
  assertWindow?: () => void,
): Promise<PublishedRecurringNotice | null> {
  return db.transaction(async (tx) => {
    if (!(await lockRuleSource(tx, ref))) return null;
    const actor = await noticeActor(tx, ref.householdId, userId, true);
    const content = actor && await readVisibleRule(tx, actor, ref.recurringId);
    if (!content || content.nextDueDate !== ref.dueDate) return null;
    const message = buildMessage(ref, userId, content);
    if (!writeInApp) return { message, content, notification: null };
    assertWindow?.();
    // A row from a concurrent run makes this a no-op; READ COMMITTED waits for it rather than failing.
    const [notification] = await tx.insert(notifications).values({
      userId, householdId: ref.householdId, type: NOTIFICATION_TYPES.RECURRING_DUE, title: message.title,
      body: message.body, actionUrl: message.actionUrl, metadata: message.metadata, dedupeKey: message.dedupeKey,
    }).onConflictDoNothing().returning();
    if (notification) await onPublished?.(tx);
    return { message, content, notification: notification ?? null };
  });
}

/**
 * Fresh check before one send (an e-mail, or one push device). Null means send:
 * the recipient can still see the rule and it still says what was bound.
 */
export async function recurringDispatchHold(
  userId: string, ref: RecurringNoticeRef, bound: RecurringNoticeContent, assertWindow?: () => void,
): Promise<ChannelResult | null> {
  const actor = await noticeActor(db, ref.householdId, userId, false);
  const current = actor && await readVisibleRule(db, actor, ref.recurringId);
  assertWindow?.();
  if (!current) return NOT_VISIBLE;
  return sameContent(current, bound) ? null : CONTENT_CHANGED;
}

