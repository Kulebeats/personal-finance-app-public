/**
 * Personal-data export, activity sections (A-27 follow-up): the requester's
 * own AI conversations and messages and their recap feedback, plus the
 * household's saved views and the investment activity they can see.
 *
 * Each section is read on the caller's REPEATABLE READ transaction through
 * the rule the app itself reads it by:
 * - AI history and recap feedback are the requester's own rows in the
 *   export's household (as the assistant and the recap show them);
 * - saved views go through the saved-view viewer mapping, so a filter on an
 *   account the requester cannot see is withheld and the view is `restricted`;
 * - investment activity goes through the activity visibility predicate
 *   (account, holding and linked cash must all be visible), and its notes
 *   through the same custody projection as the activity list (R1-05): a bond
 *   sale or T-bill maturity whose custody the requester cannot see reads its
 *   generic label, never the instrument's name.
 * Other members' user ids never leave: a view says whether it is yours.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  aiConversations, aiMessages, householdSavedViews, investmentTransactions, weeklyRecapFeedback,
} from "@shared/schema";
import type { TransactionType } from "../../utils/withTransaction";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { can } from "../../core/authz/capabilities";
import { visibleInvestmentTransactionPredicate } from "../../core/authz/investment-visibility";
import { investmentNotesProjection } from "../../services/grz/instrumentIdentity";
import { toViewerViews } from "../saved-views/saved-views.references";
import { amountOf, optionalAmount, type ExportRow } from "./settings.privacy-export.sections";

const KWACHA = "ZMW";

export interface ActivitySections {
  aiConversations: ExportRow[];
  aiMessages: ExportRow[];
  recapFeedback: ExportRow[];
  savedViews: ExportRow[];
  investmentActivity: ExportRow[];
}

/** Investment activity rows whose visibility can change after the export; re-checked before every download. */
export interface ActivitySources {
  sourceInvestmentActivityIds: string[];
}

export const aiConversationColumns = {
  id: aiConversations.id, title: aiConversations.title, createdAt: aiConversations.createdAt, updatedAt: aiConversations.updatedAt,
};
export const aiMessageColumns = {
  id: aiMessages.id, conversationId: aiMessages.conversationId, role: aiMessages.role, content: aiMessages.content,
  toolsUsed: aiMessages.toolsUsed, createdAt: aiMessages.createdAt,
};
export const recapFeedbackColumns = {
  id: weeklyRecapFeedback.id, weekStart: weeklyRecapFeedback.weekStart, weekEnd: weeklyRecapFeedback.weekEnd,
  step: weeklyRecapFeedback.step, choice: weeklyRecapFeedback.choice, comment: weeklyRecapFeedback.comment,
  createdAt: weeklyRecapFeedback.createdAt, updatedAt: weeklyRecapFeedback.updatedAt,
};
export const investmentActivityColumns = {
  id: investmentTransactions.id, accountId: investmentTransactions.accountId, holdingId: investmentTransactions.holdingId,
  securityId: investmentTransactions.securityId, type: investmentTransactions.type, quantity: investmentTransactions.quantity,
  price: investmentTransactions.price, amount: investmentTransactions.amount, currency: investmentTransactions.currency,
  fxRate: investmentTransactions.fxRate, amountZmw: investmentTransactions.amountZmw, fees: investmentTransactions.fees,
  withholdingTax: investmentTransactions.withholdingTax, linkedTransactionId: investmentTransactions.linkedTransactionId,
  transactionDate: investmentTransactions.transactionDate, notes: investmentTransactions.notes, createdAt: investmentTransactions.createdAt,
};

async function readAiHistory(tx: TransactionType, actor: HouseholdContext) {
  const conversations = await tx.select(aiConversationColumns).from(aiConversations)
    .where(and(eq(aiConversations.householdId, actor.householdId), eq(aiConversations.userId, actor.userId)))
    .orderBy(asc(aiConversations.createdAt), asc(aiConversations.id));
  const conversationIds = conversations.map(conversation => conversation.id);
  const messages = conversationIds.length === 0 ? [] : await tx.select(aiMessageColumns).from(aiMessages)
    .where(inArray(aiMessages.conversationId, conversationIds))
    .orderBy(asc(aiMessages.conversationId), asc(aiMessages.createdAt), asc(aiMessages.id));
  return { conversations, messages };
}

async function readRecapFeedback(tx: TransactionType, actor: HouseholdContext) {
  return tx.select(recapFeedbackColumns).from(weeklyRecapFeedback)
    .where(and(eq(weeklyRecapFeedback.householdId, actor.householdId), eq(weeklyRecapFeedback.userId, actor.userId)))
    .orderBy(asc(weeklyRecapFeedback.weekStart), asc(weeklyRecapFeedback.step), asc(weeklyRecapFeedback.id));
}

async function readSavedViews(tx: TransactionType, actor: HouseholdContext) {
  const rows = await tx.select().from(householdSavedViews)
    .where(eq(householdSavedViews.householdId, actor.householdId))
    .orderBy(asc(sql`lower(${householdSavedViews.name})`), asc(householdSavedViews.createdAt), asc(householdSavedViews.id));
  const views = await toViewerViews(tx, actor, rows);
  return views.map(({ createdBy, ...rest }) => ({ ...rest, createdByYou: createdBy === actor.userId }));
}

async function readInvestmentActivity(tx: TransactionType, actor: HouseholdContext) {
  const rows = await tx.select({ ...investmentActivityColumns, notes: investmentNotesProjection(actor) }).from(investmentTransactions)
    .where(visibleInvestmentTransactionPredicate(actor))
    .orderBy(asc(investmentTransactions.transactionDate), asc(investmentTransactions.id));
  return rows.map(({ price, amount, amountZmw, fees, withholdingTax, ...rest }) => ({
    ...rest,
    price: optionalAmount(price, rest.currency),
    amount: amountOf(amount, rest.currency),
    // A foreign row's kwacha value can be unknown (no rate); a kwacha row has none to give.
    amountZmw: optionalAmount(amountZmw, KWACHA, rest.currency !== KWACHA),
    fees: optionalAmount(fees, rest.currency),
    withholdingTax: optionalAmount(withholdingTax, rest.currency),
  }));
}

export function emptyActivity(): { activity: ActivitySections; sources: ActivitySources } {
  return {
    activity: { aiConversations: [], aiMessages: [], recapFeedback: [], savedViews: [], investmentActivity: [] },
    sources: { sourceInvestmentActivityIds: [] },
  };
}

/**
 * The activity sections for the export's household. The requester's own AI
 * history and feedback are theirs whatever their role; household views and
 * investment activity need financial read, like the other household sections.
 */
export async function readActivitySections(
  tx: TransactionType, actor: HouseholdContext,
): Promise<{ activity: ActivitySections; sources: ActivitySources }> {
  const { conversations, messages } = await readAiHistory(tx, actor);
  const recapFeedback = await readRecapFeedback(tx, actor);
  const canReadHousehold = can(actor.role, "financial.read");
  const savedViews = canReadHousehold ? await readSavedViews(tx, actor) : [];
  const investmentActivity = canReadHousehold ? await readInvestmentActivity(tx, actor) : [];
  return {
    activity: { aiConversations: conversations, aiMessages: messages, recapFeedback, savedViews, investmentActivity },
    sources: { sourceInvestmentActivityIds: investmentActivity.map(row => row.id) },
  };
}
