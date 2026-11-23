import { useState, useEffect, useMemo, useRef } from "react";
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
  useProfile,
} from "@/hooks/use-settings";
import {
  useCreateTransaction,
  useCreateTransfer,
  useUpdateTransfer,
  useUpdateTransaction,
  useDeleteTransaction,
} from "@/hooks/useTransactions";
import { useCreateRecurringTransaction } from "@/hooks/useRecurring";
import { buildRecurringTransactionRequest, mapServerFieldErrors } from "@/lib/recurringTransactionRequest";
import { useTransactionTags, useSetTransactionTags, useAddTagsToTransaction } from "@/hooks";
import { useTransactionReceipt } from "@/hooks/useTransactionReceipt";
import { useTransactionAttachments } from "@/hooks/useTransactionAttachments";
import { useSettings } from "@/contexts/SettingsContext";
import { assertOperationLifetime, captureOperationLifetime, StaleOperationError, type OperationLifetime } from "@/lib/operation-lifetime";
import { claimOrdinaryDraft, releaseOrdinaryDraft, OrdinaryDraftBusyError, completeOrdinaryDraft, ordinaryDraftForm, ordinaryDraftRequest, ordinaryDraftState,
  prepareOrdinaryDraft, runOrdinaryDraftFollowups, startAnotherOrdinaryDraft, type OrdinaryDraftFollowup, type PreparedOrdinaryDraft } from "@/lib/ordinary-transaction-draft";
import { assertNoUnresolvedKeyedCreate, completeKeyedCreate, confirmKeyedCreate, currentKeyedCreate, keyedCreateState,
  prepareKeyedCreate, runKeyedCreateFollowups, settleKeyedCreateFailure, startAnotherKeyedCreate,
  UNRESOLVED_SUBMISSION_MESSAGE, type KeyedCreateOperation } from "@/lib/keyed-create-operation";

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
  const createLifetime = useRef<OperationLifetime | null>(null);
  const [recovery, setRecovery] = useState({ pending: false, canRetryOriginal: false, followupsUnavailable: false });
  const [createError, setCreateError] = useState<string | null>(null);
  const refreshRecovery = () => {
    const keyed = keyedCreateState(createLifetime.current);
    setRecovery(keyed.pending ? keyed : ordinaryDraftState(createLifetime.current));
  };
  const generation = useRef(0), mounted = useRef(true), submission = useRef<object | null>(null);
  const [submissionBusy, setSubmissionBusy] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++generation.current; }; }, []);
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
  const { data: profile } = useProfile();

  const { data: existingTransactionTags, isSuccess: transactionTagsReady, isError: transactionTagsFailed } = useTransactionTags(
    isEditMode && transaction?.id ? transaction.id : ""
  );
  const setTransactionTags = useSetTransactionTags();
  const addTransactionTags = useAddTagsToTransaction();

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
      isPrivate: false,
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

  const transferDraft = useRef<{ id: string; updatedAt: string; date: string; merchantName?: string; notes?: string | null } | null>(null);
  const inflowSourceCurrency = transaction?.isTransferIn
    ? accounts?.find(account => account.id === transaction.transferAccountId)?.currency : undefined;
  const waitingForInflowSource = !!transaction?.isTransferIn && accountsLoading;
  const draft = useRef<{ identity: string; fingerprint: string; version?: string } | null>(null);
  // Subscribe to dirtyFields so reset can hydrate untouched fields without
  // replacing the member's unsaved privacy, owner, or other input.
  const { isDirty, dirtyFields } = form.formState;
  void dirtyFields;

  useEffect(() => {
    if (!isOpen || transaction?.type !== "transfer") transferDraft.current = null;
    if (!isOpen) {
      if (draft.current) ++generation.current;
      draft.current = null;
      createLifetime.current = null;
      return;
    }
    if (transaction?.type === "transfer") {
      if (draft.current) ++generation.current;
      draft.current = null;
      createLifetime.current = null;
      const defaults = buildEditModeDefaults(transaction, existingTransactionTags?.map(t => t.id) ?? []);
      if (transferDraft.current?.id === transaction.id) return;
      if (transaction.isTransferIn) {
        if (waitingForInflowSource) return;
        defaults.accountId = transaction.transferAccountId || "";
        defaults.toAccountId = transaction.accountId;
        // A rounded destination amount cannot be used to recover a foreign source amount.
        defaults.amount = inflowSourceCurrency === transaction.amount.currency ? transaction.amount.amount : "";
      } else {
        defaults.amount = transaction.amount.amount;
      }
      transferDraft.current = { id: transaction.id, updatedAt: transaction.updatedAt, date: format(defaults.date, "yyyy-MM-dd"), merchantName: defaults.merchantName, notes: transaction.notes };
      form.reset(defaults);
      return;
    }
    const identity = transaction?.id ?? "new";
    if (draft.current?.identity !== identity) { ++generation.current; createLifetime.current = captureOperationLifetime(); refreshRecovery(); }
    const fingerprint = JSON.stringify({ transaction, tags: existingTransactionTags?.map(t => t.id), userPrefs, initialValues });
    if (draft.current?.identity === identity && draft.current.fingerprint === fingerprint) return;
    const preserveDraft = draft.current?.identity === identity && isDirty;
    const keyedForm = currentKeyedCreate(createLifetime.current)?.form;
    const defaults = transaction
      ? buildEditModeDefaults(transaction, existingTransactionTags?.map(t => t.id) ?? [])
      : (keyedForm ? structuredClone(keyedForm) : ordinaryDraftForm<TransactionFormValues>(createLifetime.current)) ?? { ...buildCreateModeDefaults({ userPrefs, lastAccountId: localStorage.getItem("lastAccountId"), now: new Date() }), ...initialValues };
    form.reset(defaults, preserveDraft ? { keepDirtyValues: true } : undefined);
    draft.current = { identity, fingerprint, version: preserveDraft ? draft.current?.version : transaction?.updatedAt };
  }, [
    transaction,
    waitingForInflowSource,
    inflowSourceCurrency,
    isOpen,
    isEditMode,
    form,
    userPrefs,
    existingTransactionTags,
    initialValues,
    isDirty,
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
  const submitTransaction = async (data: TransactionFormValues, originalRequest?: PreparedOrdinaryDraft, originalKeyed?: KeyedCreateOperation) => {
    if (submission.current) return;
    if (data.isPrivate && !originalRequest) {
      const message = data.type === "transfer" ? "Private transactions require the ordinary income or expense form. Clear Private before creating a transfer."
        : !isEditMode && data.isRecurring ? "Private transactions cannot be created with a recurring template in this form. Turn off recurring or clear Private."
          : !profile?.id || data.ownerUserId !== profile.id ? "Choose yourself for a private transaction. Your current profile must be available." : null;
      if (message) { form.setError("isPrivate", { type: "validate", message }); return; }
    }
    const claim = { generation: generation.current, lifetime: originalRequest?.lifetime ?? originalKeyed?.lifetime ?? createLifetime.current };
    submission.current = claim; setSubmissionBusy(true);
    const assertCurrent = () => {
      assertOperationLifetime(claim.lifetime);
      if (!mounted.current || submission.current !== claim || generation.current !== claim.generation) throw new StaleOperationError();
    };
    let ordinaryOperation: PreparedOrdinaryDraft | undefined;
    let createClaim: ReturnType<typeof claimOrdinaryDraft> | undefined;
    const sendKeyed = async (operation: KeyedCreateOperation) => {
      assertCurrent();
      if (operation.confirmation) return;
      const { request, identity } = operation;
      try {
        if (request.kind === "transfer") {
          await createTransfer.mutateAsync({ ...request.body, idempotencyKey: identity.key });
          confirmKeyedCreate(operation);
        } else {
          const { transaction } = await createRecurringTransaction.mutateAsync({ ...request.body, idempotencyKey: identity.key });
          if (!transaction?.id) throw new Error("The saved transaction could not be confirmed.");
          confirmKeyedCreate(operation, transaction.id);
        }
      } catch (error) {
        settleKeyedCreateFailure(operation, error);
        throw error;
      }
    };
    try {
      assertCurrent();
      if (!isEditMode) {
        createClaim = claimOrdinaryDraft(claim.lifetime);
        if (data.type === "transfer" || (data.isRecurring && data.recurringFrequency)) {
          if (ordinaryDraftState(claim.lifetime).pending) throw new Error(UNRESOLVED_SUBMISSION_MESSAGE);
        } else {
          assertNoUnresolvedKeyedCreate(claim.lifetime);
        }
      }
      setCreateError(null);
      const replaceTags = isEditMode && transactionTagsReady && form.getFieldState("tags").isDirty;
      const currency = resolveCurrency(data.accountId);
      const amountDto = { amount: data.amount, currency };

      if (isEditMode && transaction) {
        // UPDATE MODE
        if (isTransferTransaction) {
          const transferName = cleanMerchantName(
            data.merchantName?.trim() || "Transfer"
          );
          if (transferDraft.current?.id !== transaction.id || !transferDraft.current.updatedAt) {
            throw new Error("Reopen the transfer to load its current version.");
          }
          const date = format(data.date, "yyyy-MM-dd");
          await updateTransfer.mutateAsync({
            id: transaction.id,
            data: {
              expectedUpdatedAt: transferDraft.current.updatedAt,
              fromAccountId: data.accountId,
              toAccountId: data.toAccountId || "",
              amount: amountDto,
              ...(date !== transferDraft.current.date ? { date } : {}),
              ...(data.merchantName !== transferDraft.current.merchantName ? { name: transferName } : {}),
              ...((data.notes || "") !== (transferDraft.current.notes || "") ? { notes: data.notes || null } : {}),
            },
          });
          assertCurrent();
          handleOpenChange(false);
          onSuccess?.();
          return;
        }

        const trimmedName = cleanMerchantName(data.merchantName?.trim() || "");
        const resolvedName = data.merchantName === (transaction.merchantName || transaction.name)
          ? transaction.name
          : trimmedName || (data.type === "income" ? transaction.name || "Income" : "");
        const merchantChanged = data.merchantName !== (transaction.merchantName || transaction.name) ||
          (data.merchantId || null) !== (transaction.merchantId || null);

        const updatePayload: Record<string, any> = {
          date: format(data.date, "yyyy-MM-dd"),
          ...(merchantChanged ? { name: resolvedName, merchantId: data.merchantId || null } : {}),
          amount: amountDto,
          ...((data.notes || null) !== (transaction.notes || null) ? { notes: data.notes || null } : {}),
          ownerUserId: data.ownerUserId,
          isPrivate: data.isPrivate,
          updatedAt: draft.current?.version ?? transaction.updatedAt,
          type: data.type,
          categoryId:
            data.categoryId && !data.categoryId.startsWith("_")
              ? data.categoryId
              : null,
        };

        await updateTransaction.mutateAsync({
          id: transaction.id,
          data: updatePayload,
        });
        assertCurrent();

        // Update tags
        if (replaceTags && data.tags) {
          await setTransactionTags.mutateAsync({
            transactionId: transaction.id,
            tagIds: data.tags,
          });
          assertCurrent();
        }

        // Handle Preferences
        if (userPrefs?.rememberLastAccount && data.accountId) {
          localStorage.setItem("lastAccountId", data.accountId);
        }

        handleOpenChange(false);
        onSuccess?.();
      } else {
        // CREATE MODE
        if (data.type === "transfer") {
          const transferRequest = {
            fromAccountId: data.accountId,
            toAccountId: data.toAccountId || "",
            amount: amountDto,
            date: format(data.date, "yyyy-MM-dd"),
            name: cleanMerchantName(data.merchantName?.trim() || "Transfer"),
            notes: data.notes || undefined,
          };
          const operation = originalKeyed ?? await prepareKeyedCreate(createClaim!.lifetime, { kind: "transfer", body: transferRequest }, data,
            generateIdempotencyKey, [], assertCurrent);
          await sendKeyed(operation);
          assertCurrent();
          completeKeyedCreate(operation);
          refreshRecovery();
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
        let keyedOperation: KeyedCreateOperation | undefined;
        const followups: OrdinaryDraftFollowup[] = [];
        if (data.tags?.length) {
          const tagIds = data.tags.slice();
          const mutation = data.isRecurring && data.recurringFrequency ? setTransactionTags : addTransactionTags;
          followups.push({ run: transactionId => mutation.mutateAsync({ transactionId, tagIds }) });
        }
        if (attachmentManager.attachments.length) { const upload = attachmentManager.uploadAll; followups.push({ run: transactionId => upload(transactionId) }); }
        const link = receipt.captureReceiptLink?.();
        if (link) followups.push({ run: link });

        if (data.isRecurring && data.recurringFrequency) {
          const recurringRequest = buildRecurringTransactionRequest(data, { name: transactionName, currency });
          keyedOperation = originalKeyed ?? await prepareKeyedCreate(createClaim!.lifetime, { kind: "recurring", body: recurringRequest }, data,
            generateIdempotencyKey, followups, assertCurrent);
          await sendKeyed(keyedOperation);
          assertCurrent();
          await runKeyedCreateFollowups(keyedOperation, assertCurrent);
          assertCurrent();
        } else {
          ordinaryOperation = originalRequest ?? await prepareOrdinaryDraft(claim.lifetime, {
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
            ownerUserId: data.ownerUserId,
            isPrivate: data.isPrivate,
          }, data, generateIdempotencyKey, followups, assertCurrent);
          assertCurrent();
          refreshRecovery();
          const result = await createTransaction.mutateAsync(ordinaryOperation.request);
          assertCurrent();
          createdTransaction = result.transaction;
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

        if (ordinaryOperation && createdTransaction?.id) { await runOrdinaryDraftFollowups(ordinaryOperation, createdTransaction.id, assertCurrent); assertCurrent(); }
        if (ordinaryOperation) completeOrdinaryDraft(ordinaryOperation);
        if (keyedOperation) completeKeyedCreate(keyedOperation);
        refreshRecovery();
        if (ordinaryOperation?.followupsUnavailable || keyedOperation?.followupsUnavailable) toast.success("Transaction recovered. Open its details to finish any original tags, attachments or receipt links.");
        handleOpenChange(false);
        form.reset();
        attachmentManager.clearAttachments();
        onSuccess?.();
      }
    } catch (error) {
      if (!(error instanceof StaleOperationError) && mounted.current && generation.current === claim.generation &&
          (claim.lifetime === null || claim.lifetime.active)) {
        // A 400 names the fields the server rejected; show each on its field.
        const serverFields = mapServerFieldErrors(error);
        serverFields.fieldErrors.forEach(({ field, message }) => form.setError(field, { type: "server", message }));
        if (!isEditMode) { setCreateError(serverFields.summary ?? (error instanceof Error ? error.message : "Transaction could not be saved.")); refreshRecovery(); }
        if (!(error instanceof OrdinaryDraftBusyError)) console.error("Failed to save transaction:", error);
      }
    } finally {
      if (createClaim) releaseOrdinaryDraft(createClaim);
      if (submission.current === claim) { submission.current = null; if (mounted.current) setSubmissionBusy(false); }
    }
  };
  const onSubmit = (data: TransactionFormValues) => submitTransaction(data);

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
    submissionBusy ||
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
    canEditTags: !isEditMode || transactionTagsReady,
    transactionTagsFailed,
    ordinaryRecovery: {
      ...(!isEditMode ? recovery : { pending: false, canRetryOriginal: false, followupsUnavailable: false }),
      error: !isEditMode ? createError : null,
      retry: () => {
        if (submission.current) return;
        const keyed = currentKeyedCreate(createLifetime.current);
        if (keyed) {
          const original = structuredClone(keyed.form);
          form.reset(original);
          void submitTransaction(original, undefined, keyed);
          return;
        }
        const original = ordinaryDraftForm<TransactionFormValues>(createLifetime.current), request = ordinaryDraftRequest(createLifetime.current);
        if (original && request) { form.reset(original); void submitTransaction(original, request); }
      },
      startAnother: () => {
        if (submission.current) return;
        try {
          startAnotherOrdinaryDraft(createLifetime.current);
          startAnotherKeyedCreate(createLifetime.current);
          ++generation.current;
          setCreateError(null);
          refreshRecovery();
        } catch (error) { setCreateError(error instanceof Error ? error.message : "Your session changed."); }
      },
    },
  };
}
