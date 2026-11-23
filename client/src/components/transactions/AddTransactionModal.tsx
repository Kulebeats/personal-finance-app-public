import { Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Form } from "@/components/ui/form";
import { ReceiptScanModal } from "@/components/receipts/ReceiptScanModal";
import { AttachmentsSection } from "@/components/transactions/AttachmentsSection";
import type { Transaction } from "@/lib/api";

import { useTransactionForm } from "./hooks/useTransactionForm";
import { TransactionFormFields } from "./form/TransactionFormFields";
import { TransactionPrivacyField } from "./form/TransactionPrivacyField";
import { TransactionCreateRecovery } from "./form/TransactionCreateRecovery";
import { RecurringSettingsSection } from "./form/RecurringSettingsSection";
import { GoalLinkingSection } from "./form/GoalLinkingSection";
import { TagsSection } from "./form/TagsSection";
import { TransactionFormValues, TRANSACTION_FIELD_LABELS } from "./form/schema";
import { notifyInvalidSubmit } from "@/lib/forms/notifyInvalidSubmit";

export interface TransactionModalProps {
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  transaction?: Transaction | null;
  onSuccess?: () => void;
  initialValues?: Partial<TransactionFormValues>;
}

export function AddTransactionModal({
  children,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  transaction,
  onSuccess,
  initialValues,
}: TransactionModalProps) {
  const {
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
    settings,
    linkableGoals,
    availableLinkGoals,
    transactionGoalLinks,
    resolveCurrency,

    // Hooks/Mutations
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
    goalsLoading, ordinaryRecovery,
    canEditTags,
    transactionTagsFailed,
  } = useTransactionForm({
    transaction,
    open: controlledOpen,
    onOpenChange: controlledOnOpenChange,
    onSuccess,
    initialValues,
  });

  const isControlled = controlledOpen !== undefined;
  const isTransferMode = form.watch("type") === "transfer";

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        {children && <DialogTrigger asChild>{children}</DialogTrigger>}
        {!children && !isControlled && (
          <DialogTrigger asChild>
            <Button className="gap-2 bg-orange-500 hover:bg-orange-600">
              <Plus className="h-4 w-4" /> Add Transaction
            </Button>
          </DialogTrigger>
        )}
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto duration-700 ease-out">
          <DialogHeader>
            <DialogTitle>
              {isEditMode ? "Edit Transaction" : "Add Transaction"}
            </DialogTitle>
            <DialogDescription>
              {isEditMode
                ? "Update the transaction details below."
                : "Add a new income or expense transaction."}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit, notifyInvalidSubmit(TRANSACTION_FIELD_LABELS))} className="space-y-6">
              <TransactionCreateRecovery recovery={ordinaryRecovery} busy={isSubmitting} />
              <fieldset disabled={isSubmitting} className="space-y-6">
              <TransactionFormFields
                form={form}
                settings={settings}
                accounts={accounts || []}
                categories={categories}
                isEditMode={isEditMode}
                isTransferTransaction={isTransferTransaction}
                receipt={receipt}
                createMerchant={createMerchant}
                isLoading={{
                  accounts: accountsLoading,
                  categories: categoriesLoading,
                }}
              />

              <TransactionPrivacyField form={form} />
              <GoalLinkingSection
                form={form}
                isEditMode={isEditMode}
                isTransferMode={isTransferMode}
                goals={linkableGoals}
                goalsLoading={goalsLoading}
                transaction={transaction}
                linkableGoals={linkableGoals}
                availableLinkGoals={availableLinkGoals}
                transactionGoalLinks={transactionGoalLinks}
                resolveCurrency={resolveCurrency}
              />

              <RecurringSettingsSection
                form={form}
                isEditMode={isEditMode}
                isTransferMode={isTransferMode}
              />

              {canEditTags ? <TagsSection form={form} /> : <p role="status" className="text-sm text-muted-foreground">
                {transactionTagsFailed ? "Tags could not be loaded. Existing tags will be kept." : "Loading tags. Existing tags will be kept."}
              </p>}

              {/* Attachments */}
              {isEditMode && transaction ? (
                <AttachmentsSection transactionId={transaction.id} />
              ) : (
                <div className="space-y-2">
                  <div className="font-medium text-sm">
                    Attachments (Optional)
                  </div>
                  <div className="flex flex-col gap-2">
                    <input
                      ref={attachmentManager.fileInputRef}
                      type="file"
                      className="hidden"
                      accept=".jpg,.jpeg,.png,.pdf"
                      multiple
                      onChange={attachmentManager.handleFileSelect}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        attachmentManager.fileInputRef.current?.click()
                      }
                      className="w-fit"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add files
                    </Button>
                    {attachmentManager.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {attachmentManager.attachments.map((file, index) => (
                          <div
                            key={index}
                            className="flex items-center gap-2 bg-muted px-2 py-1 rounded text-sm"
                          >
                            <span className="truncate max-w-[150px]">
                              {file.name}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                attachmentManager.removeAttachment(index)
                              }
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="text-[0.8rem] text-muted-foreground">
                    Upload receipts or relevant documents (JPEG, PNG, PDF - max
                    5MB each).
                  </p>
                </div>
              )}

              </fieldset><DialogFooter className="flex items-center gap-2">
                {isEditMode && (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={isSubmitting || isDeleting}
                    className="mr-auto"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Delete
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleOpenChange(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                {!ordinaryRecovery.canRetryOriginal && <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-orange-500 hover:bg-orange-600"
                >
                  {isSubmitting && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {isEditMode ? "Save Changes" : ordinaryRecovery.pending ? "Retry entered details" : "Add Transaction"}
                </Button>}
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ReceiptScanModal
        open={receipt.scanModalOpen}
        onOpenChange={receipt.setScanModalOpen}
        onUploadSuccess={receipt.handleReceiptUploadSuccess}
      />

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Transaction</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this transaction? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
