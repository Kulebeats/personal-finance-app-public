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

export interface SectionColumns {
  /** Header order; each amount column is followed by its `<field>Currency` column. */
  columns: readonly string[];
  /** Fields written as `{amount, currency}` amounts. */
  amounts: readonly string[];
  /** Raw decimal strings whose currency is another column of the same row (the version 1 sections). */
  amountCurrency?: Readonly<Record<string, string>>;
  /** The label a null non-amount field gets, when null can mean "not known" or "does not apply". */
  nullLabel?: Readonly<Record<string, (row: Readonly<Record<string, unknown>>) => string>>;
}

function keysOf(map: object, omit: readonly string[] = [], add: readonly string[] = []): string[] {
  return [...Object.keys(map).filter(key => !omit.includes(key)), ...add];
}

const OWNED = { omit: ["ownerUserId"], add: ["ownedByYou"] } as const;

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
    amounts: ["targetAmount", "currentAmount", "originalBalance", "monthlyProjection", "minimumPayment", "monthlyPayment", "oneTimePayment"],
  },
  budgets: { columns: keysOf(getTableColumns(budgets), ["householdId"]), amounts: ["amount", "rolloverAmount"] },
  recurringRules: { columns: keysOf(getTableColumns(recurringTransactions), ["householdId"]), amounts: ["amount"] },
  holdings: {
    columns: keysOf(holdingColumns, [], ["currentPrice"]),
    amounts: ["costBasis", "costBasisZmw", "currentPrice"],
    // A kwacha holding needs no acquisition rate (investmentHoldingBasis stores null); a foreign one without it is unknown.
    nullLabel: { acquisitionFxRate: row => row.securityCurrency === "ZMW" ? PERSONAL_EXPORT_NONE : PERSONAL_EXPORT_UNAVAILABLE },
  },
  grzBonds: {
    columns: keysOf(getTableColumns(grzBonds), ["householdId"]),
    amounts: ["faceValue", "purchasePrice", "soldPrice", "saleFees", "saleCostBasis", "saleRealizedGain"],
  },
  grzBondPayments: { columns: keysOf(getTableColumns(grzBondPayments)), amounts: ["grossAmount", "withholdingTax", "netAmount"] },
  grzTBills: {
    columns: keysOf(getTableColumns(grzTBills), ["householdId", "settlementOperationId", "settlementRequestDigest"], ["amountDue"]),
    amounts: ["faceValue", "purchasePrice", "discountAmount", "maturityWithholdingTax", "maturityNetProceeds", "amountDue"],
  },
  receipts: {
    columns: keysOf(receiptColumns, ["ocrData", "uploadedBy"], ["merchantName", "receiptDate", "amount", "tax", "uploadedByYou"]),
    amounts: ["amount", "tax"],
  },
  tags: { columns: keysOf(tagColumns, ["memberId"], ["forYou"]), amounts: [] },
};
