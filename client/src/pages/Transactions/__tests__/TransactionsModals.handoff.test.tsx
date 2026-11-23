/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { TransactionsModals } from "../TransactionsModals";

const mutateAsync = vi.hoisted(() => vi.fn());
const categoryId = "11111111-1111-4111-8111-111111111111";
const tagId = "22222222-2222-4222-8222-222222222222";

vi.mock("@/features/transactions", () => ({
  TransactionDetailModal: () => null,
  SplitTransactionModal: () => null,
  RecurringModal: () => null,
  BulkCategoryPickerModal: () => null,
  BulkTagPickerModal: () => null,
  RuleCreationModal: ({ initialCategory, initialCategoryId, onSubmit }: {
    initialCategory: string;
    initialCategoryId: string | null;
    onSubmit: (rule: { merchant: string; categoryId: string | null; tagIds: string[] }) => void;
  }) => <div>
    <span>{initialCategory || "Uncategorized"}</span>
    <button onClick={() => onSubmit({ merchant: "Whole Foods", categoryId: initialCategoryId, tagIds: ["22222222-2222-4222-8222-222222222222"] })}>
      Save rule
    </button>
  </div>,
}));
vi.mock("@/components/transactions/AddTransactionModal", () => ({ AddTransactionModal: () => null }));
vi.mock("@/hooks/useRules", () => ({ useCreateRule: () => ({ mutateAsync }) }));
vi.mock("@/hooks/useRecurring", () => ({ useCreateRecurringForTransaction: () => ({ mutate: vi.fn() }) }));
vi.mock("@/hooks/useTransactions", () => ({ useUpdateTransaction: () => ({ mutate: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function mount(category: string, id: string | null) {
  const setShowRuleModal = vi.fn();
  render(<TransactionsModals
    showAddModal={false} setShowAddModal={vi.fn()}
    selectedTransaction={null} setSelectedTransaction={vi.fn()} onUpdateTransaction={vi.fn()}
    showRuleModal setShowRuleModal={setShowRuleModal}
    ruleMerchant="Whole Foods" ruleCategory={category}
    {...({ ruleCategoryId: id } as { ruleCategoryId: string | null })}
    showRecurringModal={false} setShowRecurringModal={vi.fn()} recurringTransaction={null}
    showSplitModal={false} setShowSplitModal={vi.fn()} splitTransaction={null} setSplitTransaction={vi.fn()}
    showBulkCategoryModal={false} setShowBulkCategoryModal={vi.fn()}
    showBulkTagModal={false} setShowBulkTagModal={vi.fn()}
    selectedCount={0} selectedIds={new Set<string>()} clearSelection={vi.fn()}
    onBulkCategorize={vi.fn()} onBulkTag={vi.fn()}
    isBulkCategorizePending={false} isBulkTagPending={false}
    onOpenRule={vi.fn()} onOpenRecurring={vi.fn()} onOpenSplit={vi.fn()}
  />);
  return setShowRuleModal;
}

describe("TransactionsModals rule mutation handoff", () => {
  beforeEach(() => { vi.clearAllMocks(); mutateAsync.mockReset(); });

  it("sends selected IDs through useCreateRule and keeps the modal open on save failure", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("save failed")).mockResolvedValueOnce({});
    const setShowRuleModal = mount("Real category", categoryId);
    expect(screen.getByText("Real category")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      actions: [{ type: "categorize", value: categoryId }, { type: "add_tags", value: [tagId] }],
    }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(setShowRuleModal).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save rule" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    await waitFor(() => expect(setShowRuleModal).toHaveBeenCalledWith(false));
    expect(mutateAsync).toHaveBeenCalledTimes(2);
  });

  it("sends a tag-only action when the originating transaction is uncategorized", () => {
    mount("", null);
    expect(screen.getByText("Uncategorized")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    expect(mutateAsync.mock.calls[0][0].actions).toEqual([{ type: "add_tags", value: [tagId] }]);
  });
});
