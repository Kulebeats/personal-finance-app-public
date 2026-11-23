import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { accountKeys, useAccounts } from "@/hooks/useAccounts";
import { grzKeys, type GrzBondPayment } from "@/hooks/useGrzSecurities";
import { transactionKeys, useTransactions } from "@/hooks/useTransactions";
import { invalidateReportsForChange } from "@/hooks/use-reports";
import { apiRequest } from "@/lib/queryClient";
import { generateIdempotencyKey } from "@/lib/api";
import { parseMoneyString } from "@/lib/money";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/contexts/SessionContext";
import type { OperationLifetime } from "@/lib/operation-lifetime";
import { investmentKeys } from "@/hooks/investments/keys";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const amountPattern = "[0-9]{1,13}(\\.[0-9]{1,2})?";
const amountFormat = new RegExp(`^${amountPattern}$`);
const selectClass = "block w-full rounded-md border bg-background p-2";

interface PrincipalRequest {
  operationId: string;
  accountId: string;
  date: string;
  receiptConfirmed: true;
  receivedAmount: { amount: string; currency: "ZMW" };
  fees: { amount: string; currency: "ZMW" };
  receiptTransactionId?: string;
}
interface Attempt { body: PrincipalRequest; editable: boolean; dispatch: number }
// Keep an unacknowledged receipt across dialog and page remounts in this identity lifetime.
const requests = new WeakMap<OperationLifetime, Map<string, Attempt>>();
export function PrincipalReceiptAction({ payment, active }: { payment: GrzBondPayment; active: boolean }) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const status = session.status, lifetime = session.lifetime?.operation;
  if (status?.state !== "ready" || !lifetime?.active || !["owner", "admin", "member"].includes(status.household.role)) return null;
  let attempts = requests.get(lifetime);
  if (!attempts) { attempts = new Map(); requests.set(lifetime, attempts); }
  const previous = attempts.has(payment.id);
  if (!previous && (!active || payment.status !== "scheduled")) return null;
  return <Popover key={lifetime.id} open={open} onOpenChange={setOpen}><PopoverTrigger asChild>
    <Button size="sm" variant="outline" disabled={!previous && payment.paymentDate > new Date().toISOString().slice(0, 10)}>
      {previous ? "Review principal receipt" : "Record principal"}
    </Button>
  </PopoverTrigger><PopoverContent className="max-h-[70vh] w-80 overflow-y-auto">
    <PrincipalReceiptForm payment={payment} attempts={attempts} lifetime={lifetime} />
  </PopoverContent></Popover>;
}

function PrincipalReceiptForm({ payment, attempts, lifetime }: { payment: GrzBondPayment; attempts: Map<string, Attempt>; lifetime: OperationLifetime }) {
  const client = useQueryClient();
  const accounts = useAccounts();
  const { toast } = useToast();
  const [accountId, setAccount] = useState("");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [fees, setFees] = useState("0.00");
  const [mode, setMode] = useState("");
  const [receipt, setReceipt] = useState("");
  const [offset, setOffset] = useState(0);
  const [notice, setNotice] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const attempt = attempts.get(payment.id);
  const listEnabled = mode === "existing" && !!accountId && !!date && amountFormat.test(amount);
  const receipts = useTransactions({ accountId, type: "income", startDate: date, endDate: date, offset, limit: 50 }, { enabled: listEnabled });
  const matches = listEnabled ? receipts.data?.transactions.filter(row => row.accountId === accountId && row.date === date &&
    row.amount.currency === "ZMW" && row.amount.amount === parseMoneyString(amount).toFixed(2) && !row.isPending && row.status !== "pending") ?? [] : [];
  const save = useMutation({
    mutationFn: async ({ body }: { body: PrincipalRequest; dispatch: number }) => {
      const response = await apiRequest("POST", `/api/grz/payments/${payment.id}/pay`, body, lifetime);
      const { data } = await response.json();
      const result = data?.settlement;
      if (result?.operationId === body.operationId && data.id === payment.id) {
        if (response.status === 200 && result.status === "confirmed" && data.status === "paid" && result.pendingReason === null &&
            typeof result.cashTransactionId === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(result.cashTransactionId) &&
            (!body.receiptTransactionId || result.cashTransactionId === body.receiptTransactionId)) return { pending: false };
        if (response.status === 202 && result.status === "pending" && data.status === "scheduled" && result.cashTransactionId === null &&
            ["basis_unavailable", "valuation_unavailable", "coupon_component_unresolved"].includes(result.pendingReason)) return { pending: true, reason: String(result.pendingReason) };
      }
      throw new Error("The repayment result could not be verified. Retry with the same details.");
    },
    onSuccess: (result, submission) => {
      const saved = attempts.get(payment.id);
      if (!lifetime.active || saved?.body !== submission.body || saved.dispatch !== submission.dispatch) return;
      if (result.pending) {
        saved.editable = true;
        setNotice(result.reason === "basis_unavailable"
          ? "Pending. Record the purchase breakdown from your acquisition statement, then retry."
          : result.reason === "coupon_component_unresolved" ? "Pending. Reconcile the coupon schedule and any separate cash receipt, then retry."
          : `Pending. Record a principal valuation for the contractual maturity date (${payment.paymentDate}), then retry. Keep the date you actually received the cash.`);
        return;
      }
      attempts.delete(payment.id);
      setConfirmed(true);
      setNotice("Principal repayment recorded.");
      toast({ title: "Principal repayment recorded" });
      void client.invalidateQueries({ queryKey: grzKeys.bonds() });
      void client.invalidateQueries({ queryKey: accountKeys.all });
      void client.invalidateQueries({ queryKey: transactionKeys.all });
      void client.invalidateQueries({ queryKey: investmentKeys.transactionsRoot() });
      invalidateReportsForChange(client, "transaction");
      invalidateReportsForChange(client, "account");
    },
    onError: (error: Error & { status?: number }, submission) => {
      const saved = attempts.get(payment.id);
      if (lifetime.active && saved?.body === submission.body && saved.dispatch === submission.dispatch &&
          error.status && [400, 403, 404, 409, 422].includes(error.status)) saved.editable = true;
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending || confirmed || !accountId || !date || !amountFormat.test(amount) || !amountFormat.test(fees) ||
        !["existing", "new"].includes(mode) || (mode === "existing" && !matches.some(row => row.id === receipt))) return;
    const body: PrincipalRequest = { operationId: generateIdempotencyKey(), accountId, date, receiptConfirmed: true, receivedAmount: { amount, currency: "ZMW" },
      fees: { amount: fees, currency: "ZMW" }, ...(mode === "existing" ? { receiptTransactionId: receipt } : {}) };
    if (attempts.has(payment.id)) return;
    attempts.set(payment.id, { body, editable: false, dispatch: 1 });
    setNotice("");
    save.mutate({ body, dispatch: 1 });
  }
  function resetMatches() { setReceipt(""); setOffset(0); setNotice(""); }
  if (attempt) return <div className="space-y-2 text-left">
    <p>Principal receipt for ZMW {attempt.body.receivedAmount.amount} on {attempt.body.date}.</p>
    <p>{attempt.body.receiptTransactionId ? "Link the previously selected receipt." : "Record the original cash entry."}</p>
    {notice && <p role="status">{notice}</p>}{save.isError && <p role="alert">{save.error.message}</p>}
    <Button type="button" disabled={save.isPending} onClick={() => { attempt.editable = false; setNotice("");
      save.mutate({ body: attempt.body, dispatch: ++attempt.dispatch }); }}>Retry original receipt</Button>
    {attempt.editable && <Button type="button" variant="outline" onClick={() => { attempts.delete(payment.id); save.reset(); setNotice(""); }}>Review new terms</Button>}
  </div>;
  return <form onSubmit={submit} className="space-y-3 text-left">
    <p>Record the actual repayment of ZMW {payment.grossAmount.amount} principal.</p>
    <fieldset disabled={save.isPending || confirmed} className="space-y-3">
      <label className="block">Receiving account<select required className={selectClass} value={accountId}
        onChange={e => { setAccount(e.target.value); resetMatches(); }}>
        <option value="">Choose a ZMW account</option>{accounts.data?.filter(a => a.currency === "ZMW" && !a.isArchived)
          .map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select></label>
      <label className="block">Receipt date<Input required type="date" min={payment.paymentDate} max={new Date().toISOString().slice(0, 10)}
        value={date} onChange={e => { setDate(e.target.value); resetMatches(); }} /></label>
      <label className="block">Cash received (ZMW)<Input required inputMode="decimal" pattern={amountPattern} value={amount}
        onChange={e => { setAmount(e.target.value); resetMatches(); }} /></label>
      <label className="block">Redemption fees (ZMW)<Input required inputMode="decimal" pattern={amountPattern} value={fees}
        onChange={e => { setFees(e.target.value); setNotice(""); }} /></label>
      <label className="block">Cash entry<select required className={selectClass} value={mode}
        onChange={e => { setMode(e.target.value); resetMatches(); }}>
        <option value="">Choose how to record the receipt</option><option value="existing">Link an existing receipt</option>
        <option value="new">Add a new cash entry</option>
      </select></label>
      {mode === "existing" && <div>
        <label>Matching income receipt<select required className={selectClass} value={receipt} onChange={e => setReceipt(e.target.value)}>
          <option value="">Choose the receipt</option>{matches.map(row => <option key={row.id} value={row.id}>{row.name} · ZMW {row.amount.amount} · {row.id.slice(-8)}</option>)}
        </select></label>
        {listEnabled && receipts.isSuccess && !matches.length && <p>No matching receipt on this page.</p>}
        {receipts.isError && <Button type="button" variant="outline" onClick={() => void receipts.refetch()}>Retry receipt search</Button>}
        {offset > 0 && <Button type="button" onClick={() => { setReceipt(""); setOffset(offset - 50); }}>Previous receipts</Button>}
        {listEnabled && receipts.data?.pagination.hasNext && <Button type="button" onClick={() => { setReceipt(""); setOffset(offset + 50); }}>Next receipts</Button>}
      </div>}
      <Button type="submit" disabled={save.isPending || confirmed}>Confirm principal repayment</Button>
    </fieldset>
    {save.isError && <p role="alert">{save.error.message}</p>}{notice && <p role="status">{notice}</p>}
  </form>;
}
