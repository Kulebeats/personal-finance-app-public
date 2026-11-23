import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TransactionWithDetails } from "@/features/transactions/types";
import type { Transaction } from "@/lib/api";
import { TransactionsModals } from "../TransactionsModals";

vi.mock("@/features/transactions", () => ({
  TransactionDetailModal: ({ transaction, onEdit }: { transaction: TransactionWithDetails | null; onEdit?: (row: TransactionWithDetails) => void }) => transaction
    ? <button onClick={() => onEdit?.(transaction)}>Edit transaction</button> : null,
  SplitTransactionModal: () => null, RecurringModal: () => null, BulkCategoryPickerModal: () => null, BulkTagPickerModal: () => null, RuleCreationModal: () => null,
}));
vi.mock("@/components/transactions/AddTransactionModal", () => ({ AddTransactionModal: ({ open, transaction, onOpenChange }: {
  open?: boolean; transaction?: Transaction | null; onOpenChange?: (open: boolean) => void;
}) => open ? <section><output data-testid="edit-source">{transaction ? JSON.stringify(transaction) : "new"}</output>
  <button onClick={() => onOpenChange?.(false)}>Close full edit</button></section> : null }));
vi.mock("@/hooks/useRules", () => ({ useCreateRule: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("@/hooks/useRecurring", () => ({ useCreateRecurringForTransaction: () => ({ mutate: vi.fn() }) }));
vi.mock("@/hooks/useTransactions", () => ({ useUpdateTransaction: () => ({ mutate: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const source: TransactionWithDetails = { id: "tx", householdId: "hh", accountId: "account", ownerUserId: "actor", name: "Orchard", date: "2026-02-12",
  amount: { amount: "12.35", currency: "ZMW" }, type: "expense", isPrivate: true, isPending: false, isRecurring: false,
  isExcludedFromReports: false, isExcludedFromBudget: false, createdAt: "2026-02-12T12:00:00Z", updatedAt: "2026-02-13T12:00:00Z" };
function PageModals() {
  const [open, setOpen] = useState(false), [selected, setSelected] = useState<TransactionWithDetails | null>(source);
  return <><button onClick={() => setOpen(true)}>New transaction</button><TransactionsModals
    showAddModal={open} setShowAddModal={setOpen} selectedTransaction={selected} setSelectedTransaction={setSelected} onUpdateTransaction={vi.fn()}
    showRuleModal={false} setShowRuleModal={vi.fn()} ruleMerchant="" ruleCategory="" ruleCategoryId={null}
    showRecurringModal={false} setShowRecurringModal={vi.fn()} recurringTransaction={null}
    showSplitModal={false} setShowSplitModal={vi.fn()} splitTransaction={null} setSplitTransaction={vi.fn()}
    showBulkCategoryModal={false} setShowBulkCategoryModal={vi.fn()} showBulkTagModal={false} setShowBulkTagModal={vi.fn()}
    selectedCount={0} selectedIds={new Set()} clearSelection={vi.fn()} onBulkCategorize={vi.fn()} onBulkTag={vi.fn()}
    isBulkCategorizePending={false} isBulkTagPending={false} onOpenRule={vi.fn()} onOpenRecurring={vi.fn()} onOpenSplit={vi.fn()}
  /></>;
}
afterEach(cleanup);
it("hands the selected private source and version into full edit, then clears it for the next new entry", () => {
  render(<PageModals />); fireEvent.click(screen.getByRole("button", { name: "Edit transaction" }));
  expect(JSON.parse(screen.getByTestId("edit-source").textContent!)).toEqual(source);
  expect(screen.queryByRole("button", { name: "Edit transaction" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close full edit" })); fireEvent.click(screen.getByRole("button", { name: "New transaction" }));
  expect(screen.getByTestId("edit-source")).toHaveTextContent("new");
});
