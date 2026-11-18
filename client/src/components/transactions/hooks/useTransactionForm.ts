import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { format } from "date-fns";

import { useAccounts } from "@/hooks/useAccounts";
import {
  useGoals,
  useLinkTransaction,
  useTransactionGoalLinks,
  useUnlinkTransactionFromGoal,
} from "@/hooks/useGoals";
import { useCategories } from "@/hooks/useCategories";
import {
  useCreateMerchant,
  useUserPreferences,
  useUpdateMerchant,
} from "@/hooks/use-settings";
import {
  useCreateTransaction,
  useCreateTransfer,
  useUpdateTransfer,
  useUpdateTransaction,
  useDeleteTransaction,
} from "@/hooks/useTransactions";
import { useCreateRecurringTransaction } from "@/hooks/useRecurring";
import { useTransactionTags, useSetTransactionTags } from "@/hooks";
import { useTransactionReceipt } from "@/hooks/useTransactionReceipt";
import { useTransactionAttachments } from "@/hooks/useTransactionAttachments";
import { useSettings } from "@/contexts/SettingsContext";

import {
  generateIdempotencyKey,
  type Transaction,
  type MoneyDto,
} from "@/lib/api";
import {
  buildCreateModeDefaults,
  buildEditModeDefaults,
  cleanMerchantName,
} from "@/lib/transactionFormUtils";
import {
  transactionFormSchema,
  type TransactionFormValues,
} from "../form/schema";

interface UseTransactionFormProps {
  transaction?: Transaction | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSuccess?: () => void;
  initialValues?: Partial<TransactionFormValues>;
}

export function useTransactionForm({
  transaction,
  open,
  onOpenChange,
  onSuccess,
  initialValues,
}: UseTransactionFormProps) {
  const isEditMode = !!transaction;
  const isTransferTransaction = transaction?.type === "transfer";
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open !== undefined ? open : internalOpen;

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const attachmentManager = useTransactionAttachments();

  // Data hooks
  const { data: accounts, isLoading: accountsLoading } = useAccounts();
  const { data: goals, isLoading: goalsLoading } = useGoals();
  const { data: transactionGoalLinks = [] } = useTransactionGoalLinks(
    isEditMode && transaction?.id ? transaction.id : ""
  );

  const linkableGoals = useMemo(
    () => (goals ?? []).filter((goal) => goal.type === "save_up"),
    [goals]
  );
  const linkedGoalIds = useMemo(
    () => new Set(transactionGoalLinks.map((link) => link.goalId)),
    [transactionGoalLinks]
  );
  const availableLinkGoals = useMemo(
    () => linkableGoals.filter((goal) => !linkedGoalIds.has(goal.id)),
    [linkableGoals, linkedGoalIds]
  );

  const { data: categoriesData, isLoading: categoriesLoading } =
    useCategories();
  const categories = categoriesData?.categories ?? [];

  const createMerchant = useCreateMerchant();
  const updateMerchant = useUpdateMerchant();
  const settings = useSettings();
  const { data: userPrefs } = useUserPreferences();

  const { data: existingTransactionTags } = useTransactionTags(
    isEditMode && transaction?.id ? transaction.id : ""
  );
  const setTransactionTags = useSetTransactionTags();

  // Mutation hooks
  const createTransaction = useCreateTransaction();
  const createTransfer = useCreateTransfer();
  const updateTransfer = useUpdateTransfer();
  const updateTransaction = useUpdateTransaction();
  const deleteTransaction = useDeleteTransaction();
  const createRecurringTransaction = useCreateRecurringTransaction();

  // Form setup
  const form = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionFormSchema),
    defaultValues: {
      type: "expense",
      amount: "",
      merchantName: "",
      merchantId: "",
      date: new Date(),
      accountId: "",
      toAccountId: "",
      isRecurring: false,
      recurringFrequency: undefined,
      recurringIntervalValue: undefined,
      recurringIntervalUnit: undefined,
      recurringEndDate: undefined,
      recurringAmountType: "fixed",
      recurringAmountTolerance: 0,
      recurringReminderDays: 3,
      recurringReminderEmail: false,
      recurringReminderPush: false,
      recurringReminderInApp: true,
      recurringAutoLinkEnabled: true,
      recurringAutoMarkReviewed: false,
      recurringIsSubscription: false,
      recurringTrialEndDate: undefined,
      tags: [],
      ownerUserId: null,
    },
  });

  const receipt = useTransactionReceipt({
    onAutofill: (data) => {
      if (data.amount) form.setValue("amount", data.amount);
      if (data.merchantName) {
        form.setValue("merchantName", data.merchantName);
      }
      if (data.date) form.setValue("date", new Date(data.date));
    },
  });

  // Initialization
  useEffect(() => {
    if (transaction && isOpen) {
      const tagIds = existingTransactionTags?.map((t) => t.id) || [];
      form.reset(buildEditModeDefaults(transaction, tagIds));
    } else if (!transaction && isOpen && !isEditMode) {
      const lastAccountId = localStorage.getItem("lastAccountId");
      const defaults = buildCreateModeDefaults({
        userPrefs,
        lastAccountId,
        now: new Date(),
      });
      form.reset({ ...defaults, ...initialValues });
    }
  }, [
    transaction,
    isOpen,
    isEditMode,
    form,
    userPrefs,
    existingTransactionTags,
    initialValues,
  ]);

  const handleOpenChange = (newOpen: boolean) => {
    if (onOpenChange) {
      onOpenChange(newOpen);
    } else {
      setInternalOpen(newOpen);
    }

    if (!newOpen) {
      if (!isEditMode) {
        form.reset();
      }
      attachmentManager.clearAttachments();
    }
  };

  const resolveCurrency = (accountId?: string) => {
    const accountCurrency = accounts?.find(
      (account) => account.id === accountId
    )?.currency;
    return accountCurrency || settings.currency || "ZMW";
  };

  // Submission Logic
  const onSubmit = async (data: TransactionFormValues) => {
    try {
      const currency = resolveCurrency(data.accountId);
      const amountDto = { amount: data.amount, currency };

      if (isEditMode && transaction) {
        // UPDATE MODE
        if (isTransferTransaction) {
          const transferName = cleanMerchantName(
            data.merchantName?.trim() || "Transfer"
          );
          await updateTransfer.mutateAsync({
            id: transaction.id,
            data: {
              fromAccountId: data.accountId,
              toAccountId: data.toAccountId || "",
              amount: amountDto,
              date: format(data.date, "yyyy-MM-dd"),
              name: transferName,
              notes: data.notes,
            },
          });
          handleOpenChange(false);
          onSuccess?.();
          return;
        }

        const trimmedName = cleanMerchantName(data.merchantName?.trim() || "");
        const resolvedName =
          trimmedName ||
          (data.type === "income" ? transaction.name || "Income" : "");

        const updatePayload: Record<string, any> = {
          date: format(data.date, "yyyy-MM-dd"),
          name: resolvedName,
          amount: amountDto,
          notes: data.notes || null,
          ownerUserId: data.ownerUserId,
          type: data.type,
          categoryId:
            data.categoryId && !data.categoryId.startsWith("_")
              ? data.categoryId
              : null,
          merchantId: data.merchantId || null,
        };

        await updateTransaction.mutateAsync({
          id: transaction.id,
          data: updatePayload,
        });

        // Update tags
        if (data.tags) {
          await setTransactionTags.mutateAsync({
            transactionId: transaction.id,
            tagIds: data.tags,
          });
        }

        // Handle Preferences
        if (userPrefs?.rememberLastAccount && data.accountId) {
          localStorage.setItem("lastAccountId", data.accountId);
        }

        handleOpenChange(false);
        onSuccess?.();
      } else {
        // CREATE MODE
        const idempotencyKey = generateIdempotencyKey();

        if (data.type === "transfer") {
          await createTransfer.mutateAsync({
            fromAccountId: data.accountId,
            toAccountId: data.toAccountId || "",
            amount: amountDto,
            date: format(data.date, "yyyy-MM-dd"),
            name: cleanMerchantName(data.merchantName?.trim() || "Transfer"),
            notes: data.notes || undefined,
            idempotencyKey,
          });
          handleOpenChange(false);
          form.reset();
          attachmentManager.clearAttachments();
          onSuccess?.();
          return;
        }

        const transactionName =
          data.type === "income" && !data.merchantName?.trim()
            ? "Income"
            : cleanMerchantName(data.merchantName?.trim() || "");

        let createdTransaction: Transaction | undefined;

        if (data.isRecurring && data.recurringFrequency) {
          const recurringResult = await createRecurringTransaction.mutateAsync({
            accountId: data.accountId,
            date: format(data.date, "yyyy-MM-dd"),
            name: transactionName,
            amount: amountDto,
            type: data.type as "income" | "expense", // Cast to match type
            categoryId:
              data.categoryId && !data.categoryId.startsWith("_")
                ? data.categoryId
                : undefined,
            merchantId: data.merchantId || undefined,
            notes: data.notes || undefined,
            ownerUserId: data.ownerUserId ?? undefined,
            idempotencyKey,
            recurring: {
              frequency: data.recurringFrequency,
              startDate: format(data.date, "yyyy-MM-dd"),
              endDate: data.recurringEndDate
                ? format(data.recurringEndDate, "yyyy-MM-dd")
                : undefined,
              intervalValue: data.recurringIntervalValue,
              intervalUnit: data.recurringIntervalUnit,
              amountType: data.recurringAmountType,
              amountTolerance: data.recurringAmountTolerance,
              reminderDays: data.recurringReminderDays,
              reminderEmail: data.recurringReminderEmail,
              reminderPush: data.recurringReminderPush,
              reminderInApp: data.recurringReminderInApp,
              autoLinkEnabled: data.recurringAutoLinkEnabled,
              autoMarkReviewed: data.recurringAutoMarkReviewed,
              isSubscription: data.recurringIsSubscription,
              trialEndDate: data.recurringTrialEndDate
                ? format(data.recurringTrialEndDate, "yyyy-MM-dd")
                : undefined,
            },
          });
          createdTransaction = recurringResult.transaction;
        } else {
          const result = await createTransaction.mutateAsync({
            accountId: data.accountId,
            date: format(data.date, "yyyy-MM-dd"),
            name: transactionName,
            amount: amountDto,
            type: data.type as "income" | "expense",
            categoryId:
              data.categoryId && !data.categoryId.startsWith("_")
                ? data.categoryId
                : undefined,
            merchantId: data.merchantId || undefined,
            notes: data.notes || undefined,
            ownerUserId: data.ownerUserId ?? undefined,
            idempotencyKey,
          });
          createdTransaction = result.transaction;
        }

        // Add tags
        if (createdTransaction?.id && data.tags && data.tags.length > 0) {
          await setTransactionTags.mutateAsync({
            transactionId: createdTransaction.id,
            tagIds: data.tags,
          });
        }

        // Goal linking is handled separately through the goal detail modal
        // after transaction creation, as it requires the goal-specific mutation hook

        // Handle Preferences
        if (userPrefs?.rememberLastAccount && data.accountId) {
          localStorage.setItem("lastAccountId", data.accountId);
        }
        if (
          userPrefs?.rememberLastCategoryPerMerchant &&
          data.merchantId &&
          data.categoryId &&
          !data.categoryId.startsWith("_")
        ) {
          updateMerchant.mutate({
            id: data.merchantId,
            data: { defaultCategoryId: data.categoryId },
          });
        }

        if (
          attachmentManager.attachments.length > 0 &&
          createdTransaction?.id
        ) {
          await attachmentManager.uploadAll(createdTransaction.id);
        }

        handleOpenChange(false);
        form.reset();
        attachmentManager.clearAttachments();

        if (receipt.linkedReceiptId && createdTransaction?.id) {
          await receipt.linkReceiptToTransaction(createdTransaction.id);
        }

        onSuccess?.();
      }
    } catch (error) {
      console.error("Failed to save transaction:", error);
    }
  };

  const handleDelete = () => {
    if (!transaction) return;
    deleteTransaction.mutate(transaction.id, {
      onSuccess: () => {
        setShowDeleteConfirm(false);
        handleOpenChange(false);
        onSuccess?.();
      },
    });
  };

  const isSubmitting =
    createTransaction.isPending ||
    updateTransaction.isPending ||
    createTransfer.isPending ||
    updateTransfer.isPending ||
    createRecurringTransaction.isPending ||
    attachmentManager.isUploading;

  const isDeleting = deleteTransaction.isPending;

  return {
    form,
    isOpen,
    handleOpenChange,
    onSubmit,
    handleDelete,
    showDeleteConfirm,
    setShowDeleteConfirm,

    // Data
    accounts,
    categories,
    goals,
    settings,
    linkableGoals,
    availableLinkGoals,
    transactionGoalLinks,
    resolveCurrency,

    // Mutations/Hooks
    createMerchant,
    receipt,
    attachmentManager,

    // States
    isEditMode,
    isTransferTransaction,
    isSubmitting,
    isDeleting,
    accountsLoading,
    categoriesLoading,
    goalsLoading,
  };
}
