import { transactionReportRepository } from "../../repositories/reports";
import type { TransactionType } from "../../utils/withTransaction";
import { csvMoney } from "../../core/csv";
import type { ReportScope } from "./reports.types";
import type { ExportReportInput } from "./reports.validation";

const MAX_EXPORT_ROWS = 5000, TRANSACTION_EXPORT_BATCH = 1000;
export const transactionCsvColumns = ["date", "name", "merchant", "category", "account", "type", "amount", "currency", "amountBase", "baseCurrency", "isPending", "notes",
  // NEW-14: a split purchase exports one row per split; these name its parent transaction and the split (blank when unsplit).
  "transactionId", "splitId"];

/** Shared transaction CSV builder, optionally bound to a publication cut. */
export async function buildTransactionCsvData(householdId: string, userId: string, scope: ReportScope, input: ExportReportInput, tx?: TransactionType) {
  const rows: Record<string, unknown>[] = [], transactionIds: string[] = [];
  const maxRows = Math.min(input.limit ?? MAX_EXPORT_ROWS, MAX_EXPORT_ROWS);
  let cursor: string | undefined;
  while (rows.length < maxRows) {
    const result = await transactionReportRepository.getTransactions(householdId, {
      from: input.startDate, to: input.endDate, categoryId: input.categoryId, categoryGroupId: input.categoryGroupId,
      merchantId: input.merchantId, accountId: input.accountId, tagId: input.tagId, type: input.type, search: input.search, sort: input.sort,
      limit: Math.min(TRANSACTION_EXPORT_BATCH, maxRows - rows.length), cursor, scope,
      includePending: input.includePending ?? false, includeTransfers: input.includeTransfers ?? false, userId,
    }, tx);
    for (const item of result.items) {
      transactionIds.push(item.id);
      rows.push({ date: item.date, name: item.name, merchant: item.merchant?.name ?? "", category: item.category?.name ?? "",
        account: item.account?.name ?? "", type: item.type, amount: csvMoney(item.amount), currency: item.amount.currency,
        amountBase: csvMoney(item.amountBase), baseCurrency: item.baseCurrency, isPending: item.isPending, notes: item.notes ?? "",
        transactionId: item.id, splitId: item.splitId ?? "" });
    }
    cursor = result.page.nextCursor ?? undefined;
    if (!cursor || result.items.length === 0) break;
  }
  return { rows, transactionIds,
    columns: transactionCsvColumns,
    fileName: `transactions_${input.startDate}_${input.endDate}.csv` };
}
