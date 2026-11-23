/**
 * Transactions Modals Container
 *
 * Contains all modal components for the transactions page.
 */

import { useState } from "react";
import { toast } from "sonner";
import {
  TransactionDetailModal,
  SplitTransactionModal,
  RuleCreationModal,
  RecurringModal,
  BulkCategoryPickerModal,
  BulkTagPickerModal,
  type TransactionWithDetails,
} from "@/features/transactions";
import { AddTransactionModal } from "@/components/transactions/AddTransactionModal";
import { useCreateRecurringForTransaction } from "@/hooks/useRecurring";
import { useCreateRule } from "@/hooks/useRules";
import { useUpdateTransaction } from "@/hooks/useTransactions";
import type { CreateRuleInput } from "@/lib/api";
import type { RuleData } from "@/features/transactions/components/RuleCreationModal";

export function buildTransactionRulePayload(rule: RuleData): CreateRuleInput {
  const actions: CreateRuleInput["actions"] = [];
  if (rule.categoryId) actions.push({ type: "categorize", value: rule.categoryId });
  if (rule.tagIds.length > 0) actions.push({ type: "add_tags", value: rule.tagIds });
  return {
    name: `Auto: ${rule.merchant}`,
    conditions: [{
      type: "merchant_name",
      operator: rule.matchType === "exact" ? "equals" : "contains",
      value: rule.merchant,
    }],
    actions,
    applyToPast: rule.applyToExisting,
  };
}

interface TransactionsModalsProps {
  // Add modal
  showAddModal: boolean;
  setShowAddModal: (show: boolean) => void;
  // Detail modal
  selectedTransaction: TransactionWithDetails | null;
  setSelectedTransaction: (tx: TransactionWithDetails | null) => void;
  onUpdateTransaction: (id: string, updates: Record<string, unknown>) => void;
  // Rule modal
  showRuleModal: boolean;
  setShowRuleModal: (show: boolean) => void;
  ruleMerchant: string;
  ruleCategory: string;
  ruleCategoryId: string | null;
  // Recurring modal
  showRecurringModal: boolean;
  setShowRecurringModal: (show: boolean) => void;
  recurringTransaction: TransactionWithDetails | null;
  // Split modal
  showSplitModal: boolean;
  setShowSplitModal: (show: boolean) => void;
  splitTransaction: TransactionWithDetails | null;
  setSplitTransaction: (tx: TransactionWithDetails | null) => void;
  // Bulk modals
  showBulkCategoryModal: boolean;
  setShowBulkCategoryModal: (show: boolean) => void;
  showBulkTagModal: boolean;
  setShowBulkTagModal: (show: boolean) => void;
  selectedCount: number;
  selectedIds: Set<string>;
  clearSelection: () => void;
  // Bulk mutations
  onBulkCategorize: (categoryId: string) => void;
  onBulkTag: (tagIds: string[]) => void;
  isBulkCategorizePending: boolean;
  isBulkTagPending: boolean;
  // Handler creators
  onOpenRule: (merchant: string, categoryId: string | null, categoryName: string) => void;
  onOpenRecurring: (tx: TransactionWithDetails) => void;
  onOpenSplit: (tx: TransactionWithDetails) => void;
}

export function TransactionsModals({
  showAddModal,
  setShowAddModal,
  selectedTransaction,
  setSelectedTransaction,
  onUpdateTransaction,
  showRuleModal,
  setShowRuleModal,
  ruleMerchant,
  ruleCategory,
  ruleCategoryId,
  showRecurringModal,
  setShowRecurringModal,
  recurringTransaction,
  showSplitModal,
  setShowSplitModal,
  splitTransaction,
  setSplitTransaction,
  showBulkCategoryModal,
  setShowBulkCategoryModal,
  showBulkTagModal,
  setShowBulkTagModal,
  selectedCount,
  selectedIds,
  clearSelection,
  onBulkCategorize,
  onBulkTag,
  isBulkCategorizePending,
  isBulkTagPending,
  onOpenRule,
  onOpenRecurring,
  onOpenSplit,
}: TransactionsModalsProps) {
  const createRuleMutation = useCreateRule();
  const createRecurringMutation = useCreateRecurringForTransaction();
  const updateMutation = useUpdateTransaction();
  const [editingTransaction, setEditingTransaction] = useState<TransactionWithDetails | null>(null);

  return (
    <>
      <AddTransactionModal open={showAddModal} transaction={editingTransaction} onOpenChange={open => {
        setShowAddModal(open);
        if (!open) setEditingTransaction(null);
      }} />

      <TransactionDetailModal
        transaction={selectedTransaction}
        onClose={() => setSelectedTransaction(null)}
        onUpdate={onUpdateTransaction}
        onOpenRule={onOpenRule}
        onOpenRecurring={onOpenRecurring}
        onOpenSplit={onOpenSplit}
        onEdit={transaction => {
          setEditingTransaction(transaction);
          setSelectedTransaction(null);
          setShowAddModal(true);
        }}
      />

      <RuleCreationModal
        open={showRuleModal}
        onOpenChange={setShowRuleModal}
        initialMerchant={ruleMerchant}
        initialCategory={ruleCategory}
        initialCategoryId={ruleCategoryId}
        onSubmit={async (rule) => {
          try {
            await createRuleMutation.mutateAsync(buildTransactionRulePayload(rule));
            toast.success("Auto-categorization rule created");
            setShowRuleModal(false);
          } catch {
            toast.error("Failed to create rule");
          }
        }}
      />

      <RecurringModal
        open={showRecurringModal}
        onOpenChange={setShowRecurringModal}
        transaction={recurringTransaction}
        isLoading={createRecurringMutation.isPending}
        onSubmit={async (data) => {
          createRecurringMutation.mutate(
            { transactionId: data.transactionId, recurring: data.recurring },
            { onSuccess: () => setShowRecurringModal(false) },
          );
        }}
      />

      <SplitTransactionModal
        open={showSplitModal}
        onOpenChange={setShowSplitModal}
        transaction={splitTransaction}
        onSubmit={(splits, expectedUpdatedAt) => {
          if (!splitTransaction) return;
          updateMutation.mutate(
            { id: splitTransaction.id, data: { splits, expectedUpdatedAt } },
            {
              onSuccess: () => {
                toast.success("Transaction split saved");
                setSelectedTransaction(null);
                setShowSplitModal(false);
                setSplitTransaction(null);
              },
              onError: () => toast.error("Failed to save splits"),
            },
          );
        }}
        isLoading={updateMutation.isPending}
      />

      <BulkCategoryPickerModal
        open={showBulkCategoryModal}
        onOpenChange={setShowBulkCategoryModal}
        selectedCount={selectedCount}
        onSubmit={onBulkCategorize}
        isLoading={isBulkCategorizePending}
      />

      <BulkTagPickerModal
        open={showBulkTagModal}
        onOpenChange={setShowBulkTagModal}
        selectedCount={selectedCount}
        onSubmit={onBulkTag}
        isLoading={isBulkTagPending}
      />
    </>
  );
}
