import { useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { generateIdempotencyKey, type Account, type ApiError } from "@/lib/api";
import { captureOperationLifetime } from "@/lib/operation-lifetime";
import { invalidateReconciliationQueries } from "@/lib/invalidate-import-queries";
import { applyBalance, previewBalance, statementAmount, type Review } from "../../reconciliation";

// SessionBoundary replaces the QueryClient on identity changes. Keep an unresolved
// apply available if the user closes the dialog or navigates away in this session.
const pending = new WeakMap<QueryClient, Map<string, Review>>();
export function hasPendingReconciliation(client: QueryClient, accountId: string) {
  return pending.get(client)?.has(accountId) ?? false;
}

type Props = { account: Account; close: () => void; refresh: () => Promise<unknown> };
export function ReconcileBalanceDialog({ account, close, refresh }: Props) {
  const client = useQueryClient();
  const saved = pending.get(client)?.get(account.id);
  const [review, setReview] = useState(saved);
  const [amount, setAmount] = useState(saved?.draft.targetBalance.amount ?? "");
  const [reason, setReason] = useState(saved?.draft.reason ?? "");
  const [uncertain, setUncertain] = useState(!!saved);
  const [receipt, setReceipt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  async function submit() {
    if (running.current || receipt || (account.isArchived && !uncertain)) return;
    running.current = true;
    setBusy(true);
    setError("");
    const operation = captureOperationLifetime();
    try {
      if (!review) {
        const draft = { targetBalance: { amount: amount.trim(), currency: account.currency },
          expectedUpdatedAt: account.updatedAt, idempotencyKey: generateIdempotencyKey(), reason: reason.trim() };
        setReview(await previewBalance(account.id, draft, operation));
      } else {
        let packets = pending.get(client);
        if (!packets) { packets = new Map(); pending.set(client, packets); }
        packets.set(account.id, review);
        const result = await applyBalance(account.id, review, operation);
        if (packets.get(account.id) === review) packets.delete(account.id);
        setReceipt(result.transactionId);
        setUncertain(false);
      }
    } catch (cause) {
      const failure = (cause instanceof Error ? cause : new Error("Unable to reconcile this balance.")) as ApiError;
      // A transport failure, malformed receipt or server error can follow a committed posting.
      if (review && failure.status !== 409 && (uncertain || !failure.status || failure.status >= 500)) {
        setUncertain(true);
        setError("The adjustment could not be confirmed. Retry the same adjustment to check its receipt.");
      } else {
        const packets = pending.get(client);
        if (packets?.get(account.id) === review) packets?.delete(account.id);
        setError(failure.message);
        if (failure.status === 409) {
          setUncertain(false);
          setReview(undefined);
          if (uncertain) setError("The earlier adjustment could not be confirmed. Check the account transactions and compare the current balance before making a new preview.");
          if (captureOperationLifetime() === operation && operation?.active !== false) await refresh();
        }
      }
    } finally {
      // A lost response can follow a committed adjustment. Refresh the originating views in either case.
      if (review) await invalidateReconciliationQueries(client, operation);
      running.current = false;
      setBusy(false);
    }
  }

  const canPreview = statementAmount.test(amount.trim()) && !!reason.trim();
  const quote = review?.quote;
  return <Dialog open onOpenChange={open => { if (!open && !running.current) close(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Reconcile balance</DialogTitle>
        <DialogDescription>Compare the statement for {account.name} with its recorded balance. Applying the adjustment adds a dated transaction.</DialogDescription>
      </DialogHeader>
      {receipt ? <div role="status"><p>Adjustment recorded</p><p>Transaction ID {receipt}</p></div> : <>
        {quote ? <div className="space-y-3">
          <dl className="space-y-2">
            {([["Recorded balance", quote.currentBalance], ["Statement balance", quote.targetBalance], ["Adjustment", quote.adjustment]] as const)
              .map(([label, value]) => <div key={label} className="flex justify-between"><dt>{label}</dt><dd>{value.currency} {value.amount}</dd></div>)}
            <div className="flex justify-between"><dt>Posting date</dt><dd>{quote.postingDate}</dd></div>
          </dl>
          <p>Reason: {review.draft.reason}</p>
          {quote.adjustment.amount === "0.00" && <p>The balances already match.</p>}
          {uncertain && !error && <p role="status">An earlier adjustment is awaiting confirmation.</p>}
        </div> : <div className="space-y-3">
          <div><Label htmlFor="reconcile-amount">Statement balance ({account.currency})</Label>
            <Input id="reconcile-amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} disabled={busy} /></div>
          {!account.isAsset && <p>Enter the amount owed, or zero for a paid-off account. Reconciliation does not support a credit balance on a liability.</p>}
          <div><Label htmlFor="reconcile-reason">Reason</Label>
            <Textarea id="reconcile-reason" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} /></div>
        </div>}
        {account.isArchived && !uncertain && <p>This account is archived.</p>}
        {error && <p role="alert">{error}</p>}
        <DialogFooter>
          {review && !uncertain && <Button variant="outline" disabled={busy} onClick={() => { setReview(undefined); setError(""); }}>Edit details</Button>}
          <Button disabled={busy || (account.isArchived && !uncertain) || (quote ? quote.adjustment.amount === "0.00" : !canPreview)} onClick={() => void submit()}>
            {quote ? (uncertain ? "Retry same adjustment" : "Apply adjustment") : "Preview"}
          </Button>
        </DialogFooter>
      </>}
    </DialogContent>
  </Dialog>;
}
