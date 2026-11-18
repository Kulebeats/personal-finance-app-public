import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { parseMoney } from "@/lib/utils";
import { parseDate } from "@/lib/dates";
import { buildTransactionsUrl } from "@/features/transactions";
import type { MoneyDto } from "@/lib/api";
import type {
  GoalAccountAssignment,
  GoalTransfer,
  TransactionGoalLinkWithTransaction,
  GoalContribution,
} from "@/hooks/useGoals";
import { useRemoveAssignment } from "@/hooks/useGoals";

function parseAmount(value?: MoneyDto | string | number | null) {
  return parseMoney(value);
}

function formatDate(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

export function AssignmentRow({
  assignment,
  goalId,
  formatCurrency,
  canRemove = true,
}: {
  assignment: GoalAccountAssignment;
  goalId: string;
  formatCurrency: (amount: number) => string;
  canRemove?: boolean;
}) {
  const removeAssignment = useRemoveAssignment(goalId, assignment.accountId);
  const partialAmount = assignment.partialAmount
    ? formatCurrency(parseAmount(assignment.partialAmount))
    : formatCurrency(0);

  return (
    <div className="flex items-center justify-between border rounded-lg px-3 py-2">
      <div>
        <div className="text-sm font-medium text-foreground">
          {assignment.accountName}
        </div>
        <div className="text-xs text-muted-foreground">
          {assignment.assignmentType === "full_balance"
            ? "Full balance"
            : `Partial: ${partialAmount}`}
          {assignment.autoUpdate ? " | Auto sync" : ""}
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => removeAssignment.mutate()}
        disabled={removeAssignment.isPending || !canRemove}
      >
        Remove
      </Button>
    </div>
  );
}

export function TransfersList({
  transfers,
  goalId,
  formatCurrency,
}: {
  transfers: GoalTransfer[];
  goalId: string;
  formatCurrency: (amount: number) => string;
}) {
  if (transfers.length === 0) {
    return <p className="text-sm text-muted-foreground">No transfers yet.</p>;
  }

  return (
    <div className="grid gap-3">
      {transfers.map((transfer) => {
        const direction = transfer.fromGoalId === goalId ? "Sent" : "Received";
        const amount = parseAmount(transfer.amount);
        const signedAmount =
          direction === "Sent"
            ? `-${formatCurrency(amount)}`
            : `+${formatCurrency(amount)}`;
        return (
          <div
            key={transfer.id}
            className="flex items-center justify-between border rounded-lg px-3 py-2"
          >
            <div>
              <div className="text-sm font-medium text-foreground">
                {direction}
              </div>
              <div className="text-xs text-muted-foreground">
                {formatDate(transfer.createdAt)}
              </div>
            </div>
            <div className="text-sm font-semibold">{signedAmount}</div>
          </div>
        );
      })}
    </div>
  );
}

export function TransactionsList({
  items,
  formatCurrency,
  onUnlink,
  unlinking,
}: {
  items: TransactionGoalLinkWithTransaction[];
  formatCurrency: (amount: number) => string;
  onUnlink?: (transactionId: string) => void;
  unlinking?: boolean;
}) {
  const [, setLocation] = useLocation();

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No linked transactions.</p>
    );
  }

  // Audit v2 P2: linked transactions were listed but not navigable. There is
  // no single-transaction-id filter in R8's URL contract
  // (transactionFilterParams.ts), so route to the same account/category on
  // that transaction's date - narrow enough to land on (or very near) the
  // transaction itself, using the same contract every other deep link uses.
  const goToTransaction = (transaction: TransactionGoalLinkWithTransaction["transaction"]) => {
    const date = parseDate(transaction.date);
    setLocation(
      buildTransactionsUrl({
        accountId: transaction.accountId,
        categoryId: transaction.categoryId ?? undefined,
        startDate: date,
        endDate: date,
      }),
    );
  };

  return (
    <div className="grid gap-3">
      {items.map((item) => {
        const amount = parseAmount(item.amount);
        const label =
          item.linkType === "spending" ? "Spending" : "Contribution";
        const signedAmount =
          item.linkType === "spending"
            ? `-${formatCurrency(amount)}`
            : `+${formatCurrency(amount)}`;
        return (
          <div
            key={item.id}
            className="flex items-center justify-between border rounded-lg px-3 py-2"
          >
            <button
              type="button"
              onClick={() => goToTransaction(item.transaction)}
              className="text-left flex-1 min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={`View transactions for ${item.transaction.name}`}
            >
              <div className="text-sm font-medium text-foreground">
                {item.transaction.name}
              </div>
              <div className="text-xs text-muted-foreground">
                {formatDate(item.transaction.date)} - {label}
              </div>
            </button>
            <div className="flex items-center gap-3">
              <div className="text-sm font-semibold">{signedAmount}</div>
              {onUnlink ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onUnlink(item.transactionId)}
                  disabled={unlinking}
                >
                  Unlink
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PaymentHistoryList({
  items,
  formatCurrency,
}: {
  items: Array<{ id: string; name: string; date: string; amount: MoneyDto }>;
  formatCurrency: (amount: number) => string;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No payments recorded.</p>
    );
  }

  return (
    <div className="grid gap-3">
      {items.map((item) => {
        const amount = parseAmount(item.amount);
        return (
          <div
            key={item.id}
            className="flex items-center justify-between border rounded-lg px-3 py-2"
          >
            <div>
              <div className="text-sm font-medium text-foreground">
                {item.name}
              </div>
              <div className="text-xs text-muted-foreground">
                {formatDate(item.date)}
              </div>
            </div>
            <div className="text-sm font-semibold">
              {formatCurrency(amount)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ContributionHistoryList({
  items,
  formatCurrency,
}: {
  items: GoalContribution[];
  formatCurrency: (amount: number) => string;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No contributions recorded.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {items.map((item) => {
        const amount = parseAmount(item.amount);
        const notes = item.notes?.trim();
        return (
          <div
            key={item.id}
            className="flex items-center justify-between border rounded-lg px-3 py-2"
          >
            <div>
              <div className="text-sm font-medium text-foreground">
                {formatDate(item.date)}
              </div>
              {notes ? (
                <div className="text-xs text-muted-foreground">{notes}</div>
              ) : null}
            </div>
            <div className="text-sm font-semibold">
              {formatCurrency(amount)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
