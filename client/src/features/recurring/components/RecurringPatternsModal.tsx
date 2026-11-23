import { useEffect, useRef, useState } from "react";
import { Sparkles, Loader2, Check, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  useDetectPatterns,
  useConfirmPattern,
  type DetectedPattern,
} from "@/hooks/useRecurring";
import { formatCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAccounts } from "@/hooks/useAccounts";
import { useSession } from "@/contexts/SessionContext";
import { assertOperationLifetime, type OperationLifetime } from "@/lib/operation-lifetime";

const emptyPreview = (identity: string | null, epoch = 0) => ({ identity, epoch, rows: [] as DetectedPattern[], destinations: {} as Record<string, string> });

export function RecurringPatternsModal({
  children,
}: {
  children: React.ReactNode;
}) {
  const { lifetime } = useSession();
  const identity = lifetime?.key ?? null;
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(() => emptyPreview(identity));
  const currentIdentity = useRef(identity), requestEpoch = useRef(0), isOpen = useRef(false);
  currentIdentity.current = identity;
  const detectMutation = useDetectPatterns();
  const confirmMutation = useConfirmPattern();
  const accounts = useAccounts({ ownerUserId: "all", includeHidden: true }, open && identity !== null);
  const patterns = preview.identity === identity && identity !== null ? preview.rows : [];
  const destinations = preview.identity === identity ? preview.destinations : {};
  const keyFor = (pattern: DetectedPattern) => pattern.selection?.fingerprint ?? `${pattern.name}:${pattern.type}:${pattern.estimatedAmount.currency}`;
  useEffect(() => {
    ++requestEpoch.current;
    isOpen.current = false;
    setOpen(false);
    setPreview(emptyPreview(identity));
    detectMutation.reset?.();
    confirmMutation.reset?.();
  }, [identity, detectMutation.reset, confirmMutation.reset]);
  useEffect(() => () => { ++requestEpoch.current; isOpen.current = false; }, []);

  const fresh = (key: string | null, epoch: number, operation: OperationLifetime | null) => {
    if (!key || !operation || key !== currentIdentity.current || epoch !== requestEpoch.current || !isOpen.current) return false;
    try { assertOperationLifetime(operation); return true; } catch { return false; }
  };
  const scan = () => {
    const key = identity, epoch = ++requestEpoch.current, operation = lifetime?.operation ?? null;
    setPreview(emptyPreview(key, epoch));
    detectMutation.reset?.();
    confirmMutation.reset?.();
    if (!fresh(key, epoch, operation)) return;
    detectMutation.mutate({}, {
      onSuccess: rows => { if (fresh(key, epoch, operation)) setPreview({ identity: key, epoch, rows, destinations: {} }); },
      onError: () => { if (fresh(key, epoch, operation)) setPreview(emptyPreview(key)); },
    });
  };

  const handleOpenChange = (newOpen: boolean) => {
    ++requestEpoch.current;
    isOpen.current = newOpen;
    setOpen(newOpen);
    setPreview(emptyPreview(identity));
    if (newOpen) scan();
    else { detectMutation.reset?.(); confirmMutation.reset?.(); }
  };

  const handleConfirm = (pattern: DetectedPattern) => {
    const key = identity, epoch = preview.epoch, operation = lifetime?.operation ?? null;
    const accountId = destinations[keyFor(pattern)];
    if (!fresh(key, epoch, operation)) {
      if (key === currentIdentity.current && epoch === requestEpoch.current) setPreview(emptyPreview(key));
      return;
    }
    if (preview.identity !== key || !accountId || !pattern.selection || pattern.confirmationIssue) return;
    confirmMutation.mutate(
      {
        pattern,
        accountId,
      },
      {
        onSuccess: () => {
          if (fresh(key, epoch, operation)) setPreview(previous => previous.identity === key
            ? { ...previous, rows: previous.rows.filter(item => keyFor(item) !== keyFor(pattern)) } : previous);
        },
        onError: () => { if (fresh(key, epoch, operation)) setPreview(emptyPreview(key)); },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Recurring Patterns
          </DialogTitle>
          <DialogDescription>
            Scan your history to find potential recurring transactions.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden p-1">
          {detectMutation.isPending ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Scanning transactions...</p>
            </div>
          ) : patterns.length > 0 ? (
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-4">
                {patterns.map(pattern => (
                  <div
                    key={keyFor(pattern)}
                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border rounded-lg bg-card hover:bg-muted/20 transition-colors gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-semibold truncate">
                          {pattern.name}
                        </h4>
                        <span
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded-full uppercase tracking-wider font-medium",
                            pattern.confidence >= 80
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                              : "bg-yellow-100 text-yellow-700",
                          )}
                        >
                          {pattern.confidence}% Match
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground flex gap-4">
                        <span>{pattern.frequency}</span>
                        <span>•</span>
                        <span
                          className={
                            pattern.type === "income"
                              ? "text-chart-income"
                              : "text-foreground"
                          }
                        >
                          {pattern.estimatedAmount.currency ? formatCurrency(pattern.estimatedAmount) : `${pattern.estimatedAmount.amount} (currency missing)`}
                        </span>
                        <span>•</span>
                        <span>{pattern.occurrences} detected</span>
                      </div>
                      {pattern.selection && <p className="text-sm">Personal history window: {pattern.selection.startDate} to {pattern.selection.endDate} ({pattern.selection.timezone}).</p>}
                      {pattern.confirmationIssue ? <p role="status" className="text-sm text-destructive">{pattern.confirmationIssue}</p> : (
                        <label className="block text-sm mt-2">
                          Destination account for {pattern.name}
                          <select aria-label={`Destination account for ${pattern.name}`} className="block w-full border rounded p-2 bg-background"
                            value={destinations[keyFor(pattern)] ?? ""}
                            onChange={event => { const value = event.target.value; setPreview(previous => previous.identity === identity
                              ? { ...previous, destinations: { ...previous.destinations, [keyFor(pattern)]: value } } : previous); }}>
                            <option value="">Choose an account</option>
                            {(accounts.data ?? []).filter(account => account.currency === pattern.estimatedAmount.currency && !account.isArchived && !account.deletedAt)
                              .map(account => <option key={account.id} value={account.id}>{account.name} ({account.currency})</option>)}
                          </select>
                        </label>
                      )}
                      {pattern.amountTolerance !== undefined && pattern.amountVariance > 0 && (
                        <p className="text-sm">Measured relative deviation: {pattern.amountVariance.toFixed(2)}%. Rule tolerance: {pattern.amountTolerance}% (maximum 50%).</p>
                      )}
                      {!pattern.selection && !pattern.confirmationIssue && <p role="status" className="text-sm">Scan again to obtain a complete selection.</p>}
                      {accounts.isError && <p role="alert" className="text-sm text-destructive">Unable to load destination accounts.</p>}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleConfirm(pattern)}
                      disabled={confirmMutation.isPending || !pattern.selection || !!pattern.confirmationIssue || !destinations[keyFor(pattern)]}
                      className="shrink-0"
                    >
                      {confirmMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          Add Rule
                        </>
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              {detectMutation.isError ? (
                <div className="flex flex-col items-center gap-2 text-destructive">
                  <AlertCircle className="w-8 h-8" />
                  <p>Failed to scan: {detectMutation.error.message}</p>
                </div>
              ) : (
                <p>No recurring patterns found.</p>
              )}
              <Button
                variant="outline"
                className="mt-4"
                onClick={scan}
              >
                Scan Again
              </Button>
            </div>
          )}
        </div>
        {patterns.length > 0 && <Button variant="outline" onClick={scan} disabled={detectMutation.isPending}>Scan Again</Button>}
        {confirmMutation.isError && <p role="alert" className="text-sm text-destructive">{confirmMutation.error.message} Scan again to refresh this selection.</p>}
      </DialogContent>
    </Dialog>
  );
}
