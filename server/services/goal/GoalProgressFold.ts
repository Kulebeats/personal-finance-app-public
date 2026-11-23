/**
 * Goal progress fold (R10.3, #222 review rounds 2 and 3).
 *
 * Progress from counted sources is always the fold of those sources in the
 * order they were applied: a contribution adds its amount, spending and
 * corrections take at most what progress holds at that point. Every write
 * goes through refoldGoalProgress, the first application of a new source as
 * much as an edit, an unlink or a deleted transaction, so the stored state
 * is the fold by construction and replaying it changes nothing.
 *
 * Progress that is not a link or a contribution (a goal transfer, a partial
 * balance assignment) is a source too: a goal progress adjustment, with its
 * own place and stored effect, so a replay never moves it before an earlier
 * source. Only the opening amount, set before any source, has no row. A
 * transfer out moves a fixed amount: it left this goal and reached another
 * one, so a replay never shrinks it, and a change that would take progress
 * below zero at such a debit is refused (409), never clamped. Releasing a
 * partial assignment takes back what progress still holds of it, like a
 * spend (#235 M3): a refusal there would tell a member who cannot see all of
 * the progress how much it holds.
 *
 * Order. Each source gets its place under the goal lock (sourceTimeSql): the
 * statement time, nudged one microsecond past the goal's latest source. That
 * is strictly increasing per goal and equals application order, even for a
 * request that began before another but waited longer for the lock, and for
 * several sources written in one database transaction. Sources are read back
 * at full precision (sortKey), then by id.
 *
 * Replay. The fold restarts at the changed source: earlier sources keep
 * their stored effects, and progress just before it is
 * `current - sum(stored effects of it and everything after it)`. Progress no
 * source explains (an opening amount, a partial assignment, a goal transfer)
 * therefore stays where it happened relative to earlier sources.
 *
 * A transaction counts toward a goal once: a contribution link and a manual
 * contribution citing the same transaction are refused (TransactionGoalLink
 * Service, GoalContributionService), so a contribution row whose transaction
 * is linked as a contribution is that link's mirror and folds through it.
 *
 * Callers own the transaction and must already hold the goal row FOR UPDATE.
 *
 * @module services/goal/GoalProgressFold
 */

import { and, eq, sql, type SQL } from "drizzle-orm";
import {
  goalContributions, goalProgressAdjustments, transactionGoalLinks,
  type Goal, type GoalContribution, type GoalProgressAdjustment, type TransactionGoalLink,
} from "@shared/schema";
import { Money } from "../../core/money";
import { ConflictError } from "../../utils/errorHandler";
import type { TransactionType } from "../../utils/withTransaction";
import { storedLinkDelta, writeGoalProgress, type GoalProgressWrite } from "./GoalProgressSources";

/** The stored effect a new source is written with, until the fold sets it. */
export const PENDING_EFFECT = "0.00";

/**
 * The place of a source being written to `goalId`: strictly after every
 * source the goal already has. Evaluate only under the goal lock.
 */
export function sourceTimeSql(goalId: string): SQL<Date> {
  return sql<Date>`greatest(clock_timestamp()::timestamp, coalesce((select max(placed) from (
    select max(${transactionGoalLinks.linkedAt}) as placed from ${transactionGoalLinks}
      where ${transactionGoalLinks.goalId} = ${goalId}
    union all
    select max(${goalContributions.createdAt}) from ${goalContributions}
      where ${goalContributions.goalId} = ${goalId}
    union all
    select max(${goalProgressAdjustments.placedAt}) from ${goalProgressAdjustments}
      where ${goalProgressAdjustments.goalId} = ${goalId}
  ) as placed_sources) + interval '1 microsecond', '-infinity'::timestamp))`;
}

export interface RefoldChange {
  /** The source whose effect changed: edited, being removed, or just written. */
  from: string;
  /** A link whose goal-currency amount changed: fold it with this amount. */
  editedLink?: { id: string; amount: Money };
  /** A link being removed: it no longer counts (the caller deletes it). */
  removedLinkId?: string;
  /**
   * The member making the change cannot see all of this goal's progress. A
   * later transfer out would make the answer depend on what they cannot
   * see, so the change is refused whatever its amounts (FIN-01).
   */
  progressHiddenFromEditor?: boolean;
}

export interface RefoldResult {
  write: GoalProgressWrite;
  /** The one change written to progress. */
  net: Money;
  /** Every source whose stored effect the fold changed, for the audit row. */
  rebalanced: Array<{ id: string; source: FoldSourceKind; from: string; to: string }>;
  /** Each counted source's effect after the fold, by id. */
  effects: Map<string, Money>;
}

type FoldSourceKind = "link" | "contribution" | "adjustment";

interface FoldSource {
  id: string;
  source: FoldSourceKind;
  sortKey: string;
  stored: Money;
  rule: "add" | "take" | "correct" | "debit";
  amount: Money;
  correctsId: string | null;
  /** The mirror row of a contribution link, kept in step with it. */
  transactionId: string | null;
}

/** Microsecond-precision, fixed-width ordering keys for one goal's sources. */
async function readSortKeys(tx: TransactionType, goalId: string): Promise<Map<string, string>> {
  const result = await tx.execute(sql`
    select id::text as id, to_char(${transactionGoalLinks.linkedAt}, 'YYYYMMDDHH24MISSUS') as key
      from ${transactionGoalLinks} where ${transactionGoalLinks.goalId} = ${goalId}
    union all
    select id::text, to_char(${goalContributions.createdAt}, 'YYYYMMDDHH24MISSUS')
      from ${goalContributions} where ${goalContributions.goalId} = ${goalId}
    union all
    select id::text, to_char(${goalProgressAdjustments.placedAt}, 'YYYYMMDDHH24MISSUS')
      from ${goalProgressAdjustments} where ${goalProgressAdjustments.goalId} = ${goalId}`);
  return new Map((result.rows as Array<{ id: string; key: string }>).map((row) => [row.id, row.key]));
}

/** What progress holds can be taken back, never more and never below zero. */
function take(running: Money, amount: Money): Money {
  const available = running.isNegative() ? Money.zero(running.currency) : running;
  return (available.lt(amount) ? available : amount).negated();
}

function linkSources(goal: Goal, links: TransactionGoalLink[], keys: Map<string, string>, change: RefoldChange): FoldSource[] {
  return links.map((link) => ({
    id: link.id, source: "link" as const, sortKey: keys.get(link.id) ?? "", stored: storedLinkDelta(link, goal.currency),
    rule: link.linkType === "spending" ? "take" as const : "add" as const,
    amount: link.id === change.editedLink?.id ? change.editedLink.amount : new Money(link.amount, goal.currency),
    correctsId: null, transactionId: link.linkType === "contribution" ? link.transactionId : null,
  }));
}

/** Manual contributions and corrections; a holdings-tracked goal counts none of them. */
function contributionSources(
  goal: Goal, rows: GoalContribution[], links: TransactionGoalLink[], keys: Map<string, string>,
): FoldSource[] {
  if (goal.type === "investment" && goal.progressSource === "holdings") return [];
  const mirrored = new Set(links.filter((link) => link.linkType === "contribution").map((link) => link.transactionId));
  return rows.filter((row) => !(row.transactionId && mirrored.has(row.transactionId))).map((row) => {
    const amount = new Money(row.amount, goal.currency);
    return {
      id: row.id, source: "contribution" as const, sortKey: keys.get(row.id) ?? "",
      stored: row.appliedDelta === null ? amount : new Money(row.appliedDelta, goal.currency),
      rule: row.kind === "correction" ? "correct" as const : "add" as const,
      amount: amount.abs(), correctsId: row.correctsContributionId, transactionId: null,
    };
  });
}

function adjustmentRule(row: GoalProgressAdjustment, amount: Money): FoldSource["rule"] {
  if (!amount.isNegative()) return "add";
  return row.kind === "assignment" ? "take" : "debit";
}

/** Transfers and partial assignments: adds, fixed transfer debits, and clamped assignment releases. */
function adjustmentSources(goal: Goal, rows: GoalProgressAdjustment[], keys: Map<string, string>): FoldSource[] {
  return rows.map((row) => {
    const amount = new Money(row.amount, goal.currency);
    return {
      id: row.id, source: "adjustment" as const, sortKey: keys.get(row.id) ?? "",
      stored: new Money(row.appliedDelta, goal.currency), rule: adjustmentRule(row, amount),
      amount: amount.abs(), correctsId: null, transactionId: null,
    };
  });
}

function byAppliedOrder(a: FoldSource, b: FoldSource): number {
  if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
  return a.id.localeCompare(b.id);
}

/** Names no amount or source: the member may not see all of the goal's progress (FIN-01). */
const DEBIT_REFUSAL = "This change would leave the goal short for a later transfer or assignment.";

/** The one answer to a member who cannot see all of a goal's progress, whatever the edit would do. */
export const HIDDEN_PROGRESS_REFUSAL =
  "This transaction counts toward a goal that has a later transfer out and progress you can't see. Ask a member who can see all of that goal's progress to make this change.";

function effectOf(source: FoldSource, running: Money, effects: Map<string, Money>): Money {
  if (source.rule === "add") return source.amount;
  if (source.rule === "debit") {
    if (running.lt(source.amount)) throw new ConflictError(DEBIT_REFUSAL);
    return source.amount.negated();
  }
  if (source.rule === "take") return take(running, source.amount);
  const corrected = source.correctsId ? effects.get(source.correctsId) : undefined;
  if (!corrected) return source.stored;
  return corrected.isNegative() ? corrected.negated() : take(running, corrected);
}

async function storeEffect(tx: TransactionType, goal: Goal, source: FoldSource, effect: Money): Promise<void> {
  const value = effect.toString();
  if (source.source === "contribution") {
    await tx.update(goalContributions).set({ appliedDelta: value }).where(eq(goalContributions.id, source.id));
    return;
  }
  if (source.source === "adjustment") {
    await tx.update(goalProgressAdjustments).set({ appliedDelta: value }).where(eq(goalProgressAdjustments.id, source.id));
    return;
  }
  await tx.update(transactionGoalLinks).set({ appliedDelta: value }).where(eq(transactionGoalLinks.id, source.id));
  if (source.transactionId) {
    await tx.update(goalContributions).set({ appliedDelta: value }).where(and(
      eq(goalContributions.goalId, goal.id), eq(goalContributions.transactionId, source.transactionId),
    ));
  }
}

/** Refolds the locked goal from the changed source onward and stores every effect it changes. */
export async function refoldGoalProgress(tx: TransactionType, goal: Goal, change: RefoldChange): Promise<RefoldResult> {
  const links = await tx.select().from(transactionGoalLinks).where(eq(transactionGoalLinks.goalId, goal.id));
  const rows = await tx.select().from(goalContributions).where(eq(goalContributions.goalId, goal.id));
  const adjustments = await tx.select().from(goalProgressAdjustments).where(eq(goalProgressAdjustments.goalId, goal.id));
  const keys = await readSortKeys(tx, goal.id);
  const ordered = [
    ...linkSources(goal, links, keys, change), ...contributionSources(goal, rows, links, keys),
    ...adjustmentSources(goal, adjustments, keys),
  ].sort(byAppliedOrder);
  const start = ordered.findIndex((source) => source.id === change.from);
  if (start < 0) throw new Error(`Goal source ${change.from} is not counted by goal ${goal.id}`);
  if (change.progressHiddenFromEditor && ordered.slice(start).some((source) => source.rule === "debit")) {
    throw new ConflictError(HIDDEN_PROGRESS_REFUSAL);
  }

  const current = new Money(goal.currentAmount, goal.currency);
  const effects = new Map(ordered.slice(0, start).map((source) => [source.id, source.stored]));
  let running = ordered.slice(start).reduce((sum, source) => sum.subtract(source.stored), current);
  const rebalanced: RefoldResult["rebalanced"] = [];
  for (const source of ordered.slice(start)) {
    if (source.id === change.removedLinkId) continue;
    const effect = effectOf(source, running, effects);
    effects.set(source.id, effect);
    running = running.add(effect);
    if (effect.equals(source.stored)) continue;
    rebalanced.push({ id: source.id, source: source.source, from: source.stored.toString(), to: effect.toString() });
    await storeEffect(tx, goal, source, effect);
  }
  const final = running.isNegative() ? Money.zero(goal.currency) : running;
  const net = final.subtract(current);
  const write = await writeGoalProgress(tx, goal, net);
  return { write, net, rebalanced, effects };
}
