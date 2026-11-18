import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFormatters } from "@/contexts/SettingsContext";
import { useTransactions } from "@/hooks/useTransactions";
import { useLinkTransaction, type Goal } from "@/hooks/useGoals";
import { useToast } from "@/hooks/use-toast";
import {
  formatDate,
  parseAmount,
  type LinkDraft,
  type LinkType,
} from "./GoalTransactionLinkTypes";
import {
  GoalTransactionLinkList,
  type GoalLinkTransaction,
} from "./GoalTransactionLinkList";

export function GoalTransactionLinkModal({
  open,
  onClose,
  goal,
  linkedIds,
}: {
  open: boolean;
  onClose: () => void;
  goal: Goal | null;
  linkedIds: Set<string>;
}) {
  const { formatCurrency, currency: defaultCurrency } = useFormatters();
  const { toast } = useToast();
  const { data, isLoading } = useTransactions(
    { limit: 50 },
    { enabled: open }
  );
  const linkTransaction = useLinkTransaction(goal?.id ?? "");

  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, LinkDraft>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLinking, setBulkLinking] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setDrafts({});
      setSelectedIds(new Set());
      setBulkLinking(false);
    }
  }, [open]);

  const transactions = useMemo<GoalLinkTransaction[]>(() => {
    const list = data?.transactions ?? [];
    const filtered = list.filter((transaction) => {
      if (linkedIds.has(transaction.id)) return false;
      if (transaction.type === "transfer") return false;
      if (search.trim().length === 0) return true;
      return transaction.name.toLowerCase().includes(search.toLowerCase());
    });
    return filtered;
  }, [data, linkedIds, search]);

  const updateDraft = (id: string, patch: Partial<LinkDraft>) => {
    setDrafts((prev) => {
      const current = prev[id] ?? {
        linkType: "contribution" as LinkType,
        amount: "",
      };
      return { ...prev, [id]: { ...current, ...patch } };
    });
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const isContributionGoal =
    goal?.type === "save_up" ||
    (goal?.type === "investment" && goal.progressSource === "contributions");
  const allowSpending = goal?.type === "save_up";

  const getDefaultLinkType = (type: string): LinkType => {
    if (!allowSpending) return "contribution";
    return type === "expense" ? "spending" : "contribution";
  };

  const canLink = (transactionType: string, linkType: LinkType) => {
    if (linkType === "spending" && !goal?.spendingReducesProgress) return false;
    if (linkType === "spending" && transactionType !== "expense") return false;
    if (!allowSpending && linkType === "spending") return false;
    return true;
  };

  const handleBulkLink = async () => {
    if (selectedIds.size === 0) return;
    setBulkLinking(true);

    const selected = transactions.filter((transaction) =>
      selectedIds.has(transaction.id)
    );

    const results = await Promise.allSettled(
      selected.map(async (transaction) => {
        const transactionAmount = Math.abs(parseAmount(transaction.amount));
        const draft = drafts[transaction.id] ?? {
          linkType: getDefaultLinkType(transaction.type),
          amount: "",
        };
        const amountValue = draft.amount || transactionAmount.toFixed(2);

        if (!canLink(transaction.type, draft.linkType)) {
          throw new Error("Transaction cannot be linked with selected type.");
        }

        const currency =
          transaction.currency || goal?.currency || defaultCurrency || "ZMW";
        await linkTransaction.mutateAsync({
          transactionId: transaction.id,
          linkType: draft.linkType,
          amount: { amount: amountValue, currency },
        });
      })
    );

    const successCount = results.filter((result) => result.status === "fulfilled")
      .length;
    const failedCount = results.length - successCount;

    if (successCount > 0) {
      toast({
        title: "Transactions linked",
        description: `${successCount} transaction${
          successCount === 1 ? "" : "s"
        } linked to ${goal?.name ?? "goal"}.`,
      });
    }

    if (failedCount > 0) {
      toast({
        title: "Some links failed",
        description: `${failedCount} transaction${
          failedCount === 1 ? "" : "s"
        } could not be linked.`,
        variant: "destructive",
      });
    }

    setSelectedIds(new Set());
    setBulkLinking(false);
  };

  const handleLinkTransaction = (
    transaction: GoalLinkTransaction,
    linkType: LinkType,
    amountValue: string
  ) => {
    const currency =
      transaction.currency || goal?.currency || defaultCurrency || "ZMW";
    linkTransaction.mutate({
      transactionId: transaction.id,
      linkType,
      amount: { amount: amountValue, currency },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : null)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Link a transaction</DialogTitle>
        </DialogHeader>

        {!goal || !isContributionGoal ? (
          <p className="text-sm text-muted-foreground">
            Transaction linking is only available for Save Up goals and
            contribution-tracked investment goals.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="transaction-search">Search transactions</Label>
              <Input
                id="transaction-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name"
              />
            </div>

            {isLoading ? (
              <p className="text-sm text-muted-foreground">
                Loading transactions...
              </p>
            ) : transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No transactions available to link.
              </p>
            ) : (
              <GoalTransactionLinkList
                transactions={transactions}
                selectedIds={selectedIds}
                onToggleSelected={toggleSelected}
                drafts={drafts}
                updateDraft={updateDraft}
                getDefaultLinkType={getDefaultLinkType}
                allowSpending={allowSpending}
                canLink={canLink}
                formatDate={formatDate}
                formatCurrency={formatCurrency}
                onLinkTransaction={handleLinkTransaction}
                onBulkLink={handleBulkLink}
                isBulkLinking={bulkLinking}
                isLinking={linkTransaction.isPending}
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
