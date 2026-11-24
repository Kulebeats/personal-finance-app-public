/**
 * Personal-data export (R07.1, AH-08): what goes into the file.
 *
 * Every section is read inside the caller's transaction; the caller runs it at
 * REPEATABLE READ, so all sections see one snapshot. Household rows go through the shared visibility
 * predicates (membership AND account visible AND transaction visible), so a
 * member never receives another member's private account or transaction.
 *
 * Columns are allow-listed per table: secrets (password hash, MFA codes,
 * tokens) and other members' user ids never leave. Rows
 * owned by someone else carry `ownedByYou: false` instead of their owner id.
 *
 * Version 2 (A-27) adds goals, budgets, recurring rules, holdings, GRZ bonds,
 * bond payments and T-bills, receipts (metadata only) and tags
 * (settings.privacy-export.sections.ts). Its activity sections add the
 * requester's AI conversations and messages, recap feedback, saved views and
 * investment activity (settings.privacy-export.activity.ts).
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  accounts,
  categories,
  householdMembers,
  households,
  securityAuditLogs,
  transactions,
  userPreferences,
  users,
} from "@shared/schema";
import { PERSONAL_EXPORT_ARCHIVE_VERSION, type PersonalExportSections } from "@shared/personal-data-export";
import type { TransactionType } from "../../utils/withTransaction";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { visibleAccountPredicate, visibleTransactionPredicate } from "../../core/authz/transaction-visibility";
import { nrcFromStorage } from "../../core/personal-data/nrc";
import { couponCashDescriptionFields } from "../../services/grz/couponCashDescription";
import {
  emptyInventory, readHouseholdInventory, type HouseholdInventory, type InventorySources,
} from "./settings.privacy-export.sections";
import {
  emptyActivity, readActivitySections, type ActivitySections, type ActivitySources,
} from "./settings.privacy-export.activity";

export const PERSONAL_EXPORT_FORMAT = "personal-data-export";
export const PERSONAL_EXPORT_VERSION = PERSONAL_EXPORT_ARCHIVE_VERSION;

export interface PersonalExportDocument extends HouseholdInventory, ActivitySections {
  format: typeof PERSONAL_EXPORT_FORMAT;
  version: typeof PERSONAL_EXPORT_VERSION;
  generatedAt: string;
  householdId: string | null;
  profile: Record<string, unknown>;
  memberships: Record<string, unknown>[];
  preferences: Record<string, unknown> | null;
  accounts: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
  categories: Record<string, unknown>[];
  securityEvents: Record<string, unknown>[];
}

// Stored image paths (profilePictureUrl, bannerUrl) are upload locations, not the member's data.
export const profileColumns = {
  id: users.id, username: users.username, email: users.email, pendingEmail: users.pendingEmail,
  emailVerified: users.emailVerified, fullName: users.fullName, firstName: users.firstName,
  lastName: users.lastName, displayName: users.displayName, birthday: users.birthday,
  birthdayHideYear: users.birthdayHideYear, gender: users.gender, phoneNumber: users.phoneNumber,
  phoneNumberMobile: users.phoneNumberMobile, phoneNumberWork: users.phoneNumberWork,
  phoneNumberHome: users.phoneNumberHome, address: users.address, occupation: users.occupation,
  company: users.company, timezone: users.timezone, bio: users.bio, socialLinks: users.socialLinks,
  nrc: users.nrc, annualIncome: users.annualIncome, incomeFrequency: users.incomeFrequency,
  employmentStatus: users.employmentStatus, investmentGoal: users.investmentGoal,
  riskTolerance: users.riskTolerance,
  mfaEnabled: users.mfaEnabled, mfaMethod: users.mfaMethod, createdAt: users.createdAt,
  updatedAt: users.updatedAt, lastLoginAt: users.lastLoginAt,
};

export const accountColumns = {
  id: accounts.id, name: accounts.name, type: accounts.type, subtype: accounts.subtype,
  institution: accounts.institution, currency: accounts.currency, balance: accounts.balance,
  availableBalance: accounts.availableBalance, initialBalance: accounts.initialBalance,
  creditLimit: accounts.creditLimit, isAsset: accounts.isAsset, isPrivate: accounts.isPrivate,
  isHidden: accounts.isHidden, isArchived: accounts.isArchived, notes: accounts.notes,
  ownerUserId: accounts.ownerUserId, createdAt: accounts.createdAt, updatedAt: accounts.updatedAt,
};

/** GRZ cash text reads through the ledger rule (R1-05), as every other ledger reader does. */
const ledgerText = couponCashDescriptionFields();
export const transactionColumns = {
  id: transactions.id, accountId: transactions.accountId, date: transactions.date, name: ledgerText.name,
  amount: transactions.amount, currency: transactions.currency, type: transactions.type,
  status: transactions.status, categoryId: transactions.categoryId, merchantId: ledgerText.merchantId,
  transferAccountId: transactions.transferAccountId, isPending: transactions.isPending,
  isPrivate: transactions.isPrivate, notes: ledgerText.notes, ownerUserId: transactions.ownerUserId,
  createdAt: transactions.createdAt, updatedAt: transactions.updatedAt,
};

export const membershipColumns = {
  householdId: householdMembers.householdId, householdName: households.name, householdCurrency: households.currency,
  role: householdMembers.role, joinedAt: householdMembers.joinedAt,
};

export const categoryColumns = { id: categories.id, name: categories.name, isArchived: categories.isArchived };

export const securityEventColumns = {
  eventType: securityAuditLogs.eventType, ipAddress: securityAuditLogs.ipAddress,
  userAgent: securityAuditLogs.userAgent, createdAt: securityAuditLogs.createdAt,
};

/** Replace an owner id with whether the requester owns the row. */
function withOwnership<T extends { ownerUserId: string | null }>(row: T, userId: string) {
  const { ownerUserId, ...rest } = row;
  return { ...rest, ownedByYou: ownerUserId === userId };
}

async function readHouseholdSections(tx: TransactionType, actor: HouseholdContext) {
  const visibleAccounts = await tx.select(accountColumns).from(accounts)
    .where(visibleAccountPredicate(actor)).orderBy(asc(accounts.createdAt), asc(accounts.id));
  const visibleTransactions = await tx.select(transactionColumns).from(transactions)
    .where(visibleTransactionPredicate(actor)).orderBy(asc(transactions.date), asc(transactions.id));
  const householdCategories = await tx.select(categoryColumns).from(categories)
    .where(and(eq(categories.householdId, actor.householdId), isNull(categories.deletedAt)))
    .orderBy(asc(categories.displayOrder), asc(categories.id));
  const visibleAccountIds = new Set(visibleAccounts.map(account => account.id));
  return {
    accounts: visibleAccounts.map(account => withOwnership(account, actor.userId)),
    // A transfer counterpart the requester cannot see is not named.
    transactions: visibleTransactions.map(txn => withOwnership({
      ...txn,
      transferAccountId: txn.transferAccountId && visibleAccountIds.has(txn.transferAccountId) ? txn.transferAccountId : null,
    }, actor.userId)),
    categories: householdCategories,
  };
}

/** Every source the download re-checks, captured from the same snapshot as the file. */
export interface PersonalExportSources extends InventorySources, ActivitySources {
  sourceAccountIds: string[];
  sourceTransactionIds: string[];
}

/** Build the export document for `userId`; `actor` is null without a household. */
export async function collectPersonalData(
  tx: TransactionType,
  userId: string,
  actor: HouseholdContext | null,
): Promise<{
  document: PersonalExportDocument;
  sections: PersonalExportSections;
  sources: PersonalExportSources;
}> {
  const [profile] = await tx.select(profileColumns).from(users).where(eq(users.id, userId));
  if (!profile) throw new Error("Export subject not found");
  const memberships = await tx.select(membershipColumns).from(householdMembers).innerJoin(households, eq(households.id, householdMembers.householdId))
    .where(eq(householdMembers.userId, userId));
  const [preferenceRow] = await tx.select().from(userPreferences).where(eq(userPreferences.userId, userId));
  const preferences = preferenceRow ? (({ userId: _omit, ...rest }) => rest)(preferenceRow) : null;
  const securityEvents = await tx.select(securityEventColumns).from(securityAuditLogs).where(eq(securityAuditLogs.userId, userId))
    .orderBy(asc(securityAuditLogs.createdAt), asc(securityAuditLogs.id));
  const household = actor ? await readHouseholdSections(tx, actor) : { accounts: [], transactions: [], categories: [] };
  const { inventory, sources } = actor ? await readHouseholdInventory(tx, actor) : emptyInventory();
  const { activity, sources: activitySources } = actor ? await readActivitySections(tx, actor) : emptyActivity();

  const document: PersonalExportDocument = {
    format: PERSONAL_EXPORT_FORMAT,
    version: PERSONAL_EXPORT_VERSION,
    generatedAt: new Date().toISOString(),
    householdId: actor?.householdId ?? null,
    profile: { ...profile, nrc: nrcFromStorage(profile.nrc) },
    memberships,
    preferences,
    ...household,
    securityEvents,
    ...inventory,
    ...activity,
  };
  const sections: PersonalExportSections = {
    profile: 1,
    memberships: memberships.length,
    preferences: preferences ? 1 : 0,
    accounts: household.accounts.length,
    transactions: household.transactions.length,
    categories: household.categories.length,
    securityEvents: securityEvents.length,
    goals: inventory.goals.length,
    budgets: inventory.budgets.length,
    recurringRules: inventory.recurringRules.length,
    holdings: inventory.holdings.length,
    grzBonds: inventory.grzBonds.length,
    grzBondPayments: inventory.grzBondPayments.length,
    grzTBills: inventory.grzTBills.length,
    receipts: inventory.receipts.length,
    tags: inventory.tags.length,
    aiConversations: activity.aiConversations.length,
    aiMessages: activity.aiMessages.length,
    recapFeedback: activity.recapFeedback.length,
    savedViews: activity.savedViews.length,
    investmentActivity: activity.investmentActivity.length,
  };
  return {
    document,
    sections,
    sources: {
      ...sources,
      ...activitySources,
      sourceAccountIds: household.accounts.map(account => account.id),
      sourceTransactionIds: household.transactions.map(transaction => transaction.id),
    },
  };
}
