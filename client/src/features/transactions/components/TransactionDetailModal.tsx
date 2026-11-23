/**
 * Transaction Detail Modal Component
 *
 * Slide-over panel showing transaction details with edit capabilities.
 * Fixed: Tags now use IDs instead of names for proper API integration.
 */

import { useState, useEffect, useMemo } from "react";
import { Link, useLocation } from "wouter";
import {
  X,
  Check,
  ArrowRight,
  Tag,
  Copy,
  Scissors,
  Repeat,
  Pencil,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { useCategories, type Category } from "@/hooks/useCategories";
import {
  useTransactionTags,
  useAddTagsToTransaction,
  useRemoveTagFromTransaction,
  useCreateTag,
  useTags,
} from "@/hooks/useTags";
import {
  useReviewTransaction,
  useCreateTransaction,
} from "@/hooks/useTransactions";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { duplicateTransaction } from "../utils/export";
import { toast } from "sonner";
import type { TransactionWithDetails } from "../types";
import { TransactionAmountHeader } from "./TransactionAmountHeader";

// Import directly from the sibling module (not the feature barrel) to avoid
// a circular import back into this file via features/transactions/index.ts.
import { buildTransactionsUrl } from "../transactionFilterParams";

// TODO(audit v2 P2 - linked receipt): this modal has no link to a linked
// receipt. Unlike account/recurring/category, there is no client-visible
// data to link from: `Transaction` (client/src/lib/api.ts) does not carry a
// receiptId, and the relationship is one-directional in the schema
// (pendingReceipts.matchedTransactionId -> transactions.id, no reverse FK
// or index). Wiring this needs either a `GET /transactions/:id` field or a
// dedicated "receipt by transactionId" query before a link can be built -
// out of scope for this client-only deep-link change.

interface TransactionDetailModalProps {
  transaction: TransactionWithDetails | null;
  onClose: () => void;
  onUpdate: (id: string, updates: Record<string, unknown>) => void;
  onOpenRule: (merchant: string, categoryId: string | null, categoryName: string) => void;
  onOpenRecurring: (transaction: TransactionWithDetails) => void;
  onOpenSplit?: (transaction: TransactionWithDetails) => void;
  onEdit?: (transaction: TransactionWithDetails) => void;
  /** @deprecated Use tag hooks internally instead */
  availableTags?: string[];
}

export function TransactionDetailModal({
  transaction,
  onClose,
  onUpdate,
  onOpenRule,
  onOpenRecurring,
  onOpenSplit,
  onEdit,
}: TransactionDetailModalProps) {
  const [, setLocation] = useLocation();
  const { data: categoriesData } = useCategories();
  const categories = categoriesData?.categories || [];

  // Tag hooks - use IDs, not names (T-07 fix)
  const { data: allTags = [] } = useTags();
  const { data: transactionTags = [] } = useTransactionTags(
    transaction?.id ?? "",
  );
  const addTagMutation = useAddTagsToTransaction();
  const removeTagMutation = useRemoveTagFromTransaction();
  const createTagMutation = useCreateTag();

  // Review hook - use dedicated /review endpoint instead of general update
  const reviewMutation = useReviewTransaction();

  // Create hook for duplication
  const createMutation = useCreateTransaction();

  // Focus trap for accessibility
  const modalRef = useFocusTrap<HTMLDivElement>(!!transaction);

  const [categoryId, setCategoryId] = useState(transaction?.categoryId || "");
  const [newTag, setNewTag] = useState("");

  // Get tag IDs that are already on this transaction
  const currentTagIds = useMemo(
    () => new Set(transactionTags.map((t) => t.id)),
    [transactionTags],
  );

  // Reset state when transaction changes
  useEffect(() => {
    setCategoryId(transaction?.categoryId || "");
  }, [transaction?.id]);

  if (!transaction) return null;

  const displayName = transaction.merchantName || transaction.name || "Unknown";
  const selectedRuleCategory = categories.find((category) => category.id === categoryId);

  // Group categories
  const groupedCategories = categories.reduce(
    (acc, cat) => {
      const group = cat.groupName || "Other";
      if (!acc[group]) acc[group] = [];
      acc[group].push(cat);
      return acc;
    },
    {} as Record<string, Category[]>,
  );

  const handleCategoryChange = (newCategoryId: string) => {
    setCategoryId(newCategoryId);
    onUpdate(transaction.id, { categoryId: newCategoryId });
  };

  // T-07: Handle adding tags using tag IDs, not names
  const handleAddTag = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && newTag.trim()) {
      e.preventDefault();
      const tagName = newTag.trim();

      // Find existing tag by name
      const existingTag = allTags.find(
        (t) => t.name.toLowerCase() === tagName.toLowerCase(),
      );

      if (existingTag) {
        // Add existing tag by ID
        if (!currentTagIds.has(existingTag.id)) {
          addTagMutation.mutate({
            transactionId: transaction.id,
            tagIds: [existingTag.id],
          });
        }
      } else {
        // Create new tag first, then add it
        createTagMutation.mutate(
          { name: tagName },
          {
            onSuccess: (createdTag) => {
              addTagMutation.mutate({
                transactionId: transaction.id,
                tagIds: [createdTag.id],
              });
            },
          },
        );
      }
      setNewTag("");
    }
  };

  // T-07: Handle removing tags using tag ID, not name
  const handleRemoveTag = (tagId: string) => {
    removeTagMutation.mutate({
      transactionId: transaction.id,
      tagId,
    });
  };

  // Audit v2 P2: "View transactions" was a dead button. Route via R8's URL
  // filter contract (transactionFilterParams.ts) to the same category if the
  // transaction has one, else the same account.
  const handleViewTransactions = () => {
    setLocation(
      buildTransactionsUrl(
        transaction.categoryId
          ? { categoryId: transaction.categoryId }
          : { accountId: transaction.accountId },
      ),
    );
  };

  // Handle duplicating the transaction
  const handleDuplicate = () => {
    const duplicateData = duplicateTransaction(transaction);
    createMutation.mutate(
      duplicateData as Parameters<typeof createMutation.mutate>[0],
      {
        onSuccess: () => {
          toast.success(`Duplicated "${transaction.name}"`);
          onClose();
        },
        onError: () => {
          toast.error("Failed to duplicate transaction");
        },
      },
    );
  };

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 bg-black/40 z-50 flex items-stretch justify-end backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label="Transaction details"
      aria-describedby="transaction-detail-description"
    >
      <Card className="w-full max-w-lg bg-card shadow-2xl overflow-hidden flex flex-col h-full animate-in slide-in-from-right-10 duration-300 rounded-l-xl">
        <p id="transaction-detail-description" className="sr-only">
          Review and update this transaction, or create a rule using its merchant and category.
        </p>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/10">
          <div className="flex items-center gap-1">
            {onEdit && (transaction.type === "income" || transaction.type === "expense") && (
              <button aria-label="Edit transaction" onClick={() => onEdit(transaction)}
                className="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground">
                <Pencil className="w-4 h-4" />
              </button>
            )}
            <button
              aria-label={
                transaction.reviewedAt
                  ? "Mark as Unreviewed"
                  : "Mark as Reviewed"
              }
              className="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground disabled:opacity-50"
              onClick={() =>
                reviewMutation.mutate({
                  id: transaction.id,
                  reviewed: !transaction.reviewedAt,
                })
              }
              disabled={reviewMutation.isPending}
            >
              <Check
                className={cn(
                  "w-4 h-4",
                  transaction.reviewedAt && "text-green-500",
                )}
              />
            </button>
            <button
              aria-label="Mark as Recurring"
              className="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground disabled:opacity-50"
              onClick={() => onOpenRecurring(transaction)}
              disabled={transaction.isRecurring}
            >
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              aria-label="Duplicate Transaction"
              className="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground disabled:opacity-50"
              onClick={handleDuplicate}
              disabled={createMutation.isPending}
            >
              <Copy className="w-4 h-4" />
            </button>
            {onOpenSplit && (
              <button
                aria-label="Split Transaction"
                className="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground"
                onClick={() => onOpenSplit(transaction)}
              >
                <Scissors className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            aria-label="Close"
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {/* Amount Header */}
          <TransactionAmountHeader
            transaction={transaction}
            displayName={displayName}
            onViewTransactions={handleViewTransactions}
          />

          {/* Details */}
          <div className="space-y-6">
            {/* Meta Info */}
            <div className="grid grid-cols-2 gap-4 p-4 bg-muted/20 rounded-lg border border-dashed">
              <div>
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                  Date
                </Label>
                <div className="text-sm">
                  {format(parseISO(transaction.date), "MMMM d, yyyy")}
                </div>
              </div>
              <div>
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                  Status
                </Label>
                <div className="text-sm">
                  {transaction.reviewedAt ? "Reviewed" : "Pending Review"}
                </div>
              </div>
            </div>

            {/* Audit v2 P2: recurring transactions had no way back to the
                recurring rule that generated them - the "Mark as Recurring"
                button above is disabled once a transaction is recurring, so
                without this link there was no path forward at all. Deep
                link via the same ?ruleId= param the RecurringExpensesWidget
                dashboard widget and Recurring.tsx now share. */}
            {transaction.isRecurring && transaction.recurringTransactionId && (
              <Link
                href={`/recurring?ruleId=${transaction.recurringTransactionId}`}
                className="flex items-center gap-1.5 text-sm text-primary hover:underline w-fit"
              >
                <Repeat className="w-3.5 h-3.5" />
                View recurring rule
              </Link>
            )}

            {/* Category */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Category</Label>
                {/* Audit v2 P2: no route drills into a single budget by
                    category (see BudgetStatusWidget/DashboardBudgetWidget)
                    - link to the Budget page, which lists every category's
                    budget. */}
                <Link
                  href="/budget"
                  className="text-xs text-primary hover:underline"
                >
                  View budget
                </Link>
              </div>
              <Select value={categoryId} onValueChange={handleCategoryChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {Object.entries(groupedCategories).map(([group, cats]) => (
                    <SelectGroup key={group}>
                      <SelectLabel>{group}</SelectLabel>
                      {cats.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tags - T-07: Use tag objects with IDs instead of names */}
            <div className="space-y-2">
              <Label>Tags</Label>
              <div className="flex flex-wrap gap-2 p-3 border rounded-md min-h-[50px]">
                {transactionTags.map((tag) => (
                  <div
                    key={tag.id}
                    className="bg-muted px-2 py-1 rounded text-sm flex items-center gap-1"
                  >
                    <Tag className="w-3 h-3" />
                    {tag.name}
                    <button
                      aria-label={`Remove tag ${tag.name}`}
                      onClick={() => handleRemoveTag(tag.id)}
                      className="ml-1 hover:text-destructive p-1"
                      disabled={removeTagMutation.isPending}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <Input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={handleAddTag}
                  placeholder="Add tag..."
                  className="flex-1 min-w-[100px] h-7 border-0 shadow-none"
                  disabled={
                    addTagMutation.isPending || createTagMutation.isPending
                  }
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input
                defaultValue={transaction.notes || ""}
                placeholder="Add a note..."
                onBlur={(e) =>
                  onUpdate(transaction.id, { notes: e.target.value })
                }
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-between">
          <Button
            variant="outline"
            onClick={() =>
              onOpenRule(
                displayName,
                selectedRuleCategory?.id || null,
                selectedRuleCategory?.name || "",
              )
            }
          >
            Create Rule
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </Card>
    </div>
  );
}
