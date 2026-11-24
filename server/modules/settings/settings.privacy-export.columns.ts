/**
 * Personal-data export CSV columns (A-27): the header of every sheet, so a
 * section with no rows still says what it would hold.
 *
 * Columns come from the same select maps and tables the sections read, minus
 * the fields each section leaves out, plus the fields it adds. A key a row has
 * that is not listed here is appended to the sheet, never dropped.
 */
import { getTableColumns } from "drizzle-orm";
import { budgets, goals, grzBondPayments, grzBonds, grzTBills, recurringTransactions, userPreferences } from "@shared/schema";
import { PERSONAL_EXPORT_NONE, PERSONAL_EXPORT_UNAVAILABLE, type PersonalExportCsvSection } from "@shared/personal-data-export";
import {
  accountColumns, categoryColumns, membershipColumns, profileColumns, securityEventColumns, transactionColumns,
} from "./settings.privacy-export.data";
import { holdingColumns, receiptColumns, tagColumns } from "./settings.privacy-export.sections";
import {
  aiConversationColumns, aiMessageColumns, investmentActivityColumns, recapFeedbackColumns,
} from "./settings.privacy-export.activity";

export interface SectionColumns {
  /** Header order; each amount column is followed by its `<field>Currency` column. */
  columns: readonly string[];
  /** Fields written as `{amount, currency}` amounts. */
  amounts: readonly string[];
  /** Raw decimal strings whose currency is another column of the same row (the version 1 sections). */
  amountCurrency?: Readonly<Record<string, string>>;
  /** The label a null non-amount field gets, when null can mean "not known" or "does not apply". */
  nullLabel?: Readonly<Record<string, (row: Readonly<Record<string, unknown>>) => string>>;
  /** Plain decimals that are not amounts (rates, yields, quantities): numeric cells, so "-0.0125" stays a number. */
  numerics?: readonly string[];
}

function keysOf(map: object, omit: readonly string[] = [], add: readonly string[] = []): string[] {
  return [...Object.keys(map).filter(key => !omit.includes(key)), ...add];
}

/** The decimal (Postgres numeric) columns of a select map, other than its amounts. */
function decimalKeys(map: object, amounts: readonly string[]): string[] {
  return Object.entries(map)
    .filter(([key, column]) => !amounts.includes(key) && (column as { columnType?: unknown } | null)?.columnType === "PgNumeric")
    .map(([key]) => key);
}

const OWNED = { omit: ["ownerUserId"], add: ["ownedByYou"] } as const;
const GOAL_AMOUNTS = ["targetAmount", "currentAmount", "originalBalance", "monthlyProjection", "minimumPayment", "monthlyPayment", "oneTimePayment"];
const HOLDING_AMOUNTS = ["costBasis", "costBasisZmw", "currentPrice"];
const BOND_AMOUNTS = ["faceValue", "purchasePrice", "soldPrice", "saleFees", "saleCostBasis", "saleRealizedGain"];
const BOND_PAYMENT_AMOUNTS = ["grossAmount", "withholdingTax", "netAmount"];
const TBILL_AMOUNTS = ["faceValue", "purchasePrice", "discountAmount", "maturityWithholdingTax", "maturityNetProceeds", "amountDue"];
const ACTIVITY_AMOUNTS = ["price", "amount", "amountZmw", "fees", "withholdingTax"];

export const SECTION_COLUMNS: Readonly<Record<PersonalExportCsvSection, SectionColumns>> = {
  profile: { columns: keysOf(profileColumns), amounts: [] },
  memberships: { columns: keysOf(membershipColumns), amounts: [] },
  preferences: { columns: keysOf(getTableColumns(userPreferences), ["userId"]), amounts: [] },
  accounts: {
    columns: keysOf(accountColumns, OWNED.omit, OWNED.add),
    amounts: [],
    amountCurrency: { balance: "currency", availableBalance: "currency", initialBalance: "currency", creditLimit: "currency" },
  },
  transactions: {
    columns: keysOf(transactionColumns, OWNED.omit, OWNED.add), amounts: [], amountCurrency: { amount: "currency" },
  },
  categories: { columns: keysOf(categoryColumns), amounts: [] },
  securityEvents: { columns: keysOf(securityEventColumns), amounts: [] },
  goals: {
    columns: keysOf(getTableColumns(goals), ["householdId", "createdBy", "customImageUrl"], ["progressAvailability", "createdByYou"]),
    amounts: GOAL_AMOUNTS,
    numerics: decimalKeys(getTableColumns(goals), GOAL_AMOUNTS),
  },
  budgets: {
    columns: keysOf(getTableColumns(budgets), ["householdId"]), amounts: ["amount", "rolloverAmount"],
    numerics: decimalKeys(getTableColumns(budgets), ["amount", "rolloverAmount"]),
  },
  recurringRules: {
    columns: keysOf(getTableColumns(recurringTransactions), ["householdId"]), amounts: ["amount"],
    numerics: decimalKeys(getTableColumns(recurringTransactions), ["amount"]),
  },
  holdings: {
    columns: keysOf(holdingColumns, [], ["currentPrice"]),
    amounts: HOLDING_AMOUNTS,
    numerics: decimalKeys(holdingColumns, HOLDING_AMOUNTS),
    // A kwacha holding needs no acquisition rate (investmentHoldingBasis stores null); a foreign one without it is unknown.
    nullLabel: { acquisitionFxRate: row => row.securityCurrency === "ZMW" ? PERSONAL_EXPORT_NONE : PERSONAL_EXPORT_UNAVAILABLE },
  },
  grzBonds: {
    columns: keysOf(getTableColumns(grzBonds), ["householdId"]),
    amounts: BOND_AMOUNTS,
    numerics: decimalKeys(getTableColumns(grzBonds), BOND_AMOUNTS),
  },
  grzBondPayments: {
    columns: keysOf(getTableColumns(grzBondPayments)), amounts: BOND_PAYMENT_AMOUNTS,
    numerics: decimalKeys(getTableColumns(grzBondPayments), BOND_PAYMENT_AMOUNTS),
  },
  grzTBills: {
    columns: keysOf(getTableColumns(grzTBills), ["householdId", "settlementOperationId", "settlementRequestDigest"], ["amountDue"]),
    amounts: TBILL_AMOUNTS,
    numerics: decimalKeys(getTableColumns(grzTBills), TBILL_AMOUNTS),
  },
  receipts: {
    columns: keysOf(receiptColumns, ["ocrData", "uploadedBy"], ["merchantName", "receiptDate", "amount", "tax", "uploadedByYou"]),
    amounts: ["amount", "tax"],
  },
  tags: { columns: keysOf(tagColumns, ["memberId"], ["forYou"]), amounts: [] },
  aiConversations: { columns: keysOf(aiConversationColumns), amounts: [] },
  aiMessages: { columns: keysOf(aiMessageColumns), amounts: [] },
  recapFeedback: { columns: keysOf(recapFeedbackColumns), amounts: [] },
  savedViews: { columns: ["id", "name", "filter", "restricted", "createdByYou", "createdAt", "updatedAt", "version"], amounts: [] },
  investmentActivity: {
    columns: keysOf(investmentActivityColumns), amounts: ACTIVITY_AMOUNTS,
    numerics: decimalKeys(investmentActivityColumns, ACTIVITY_AMOUNTS),
  },
};
