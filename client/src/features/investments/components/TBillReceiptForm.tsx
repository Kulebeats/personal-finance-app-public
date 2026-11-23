import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { accountKeys, useAccounts } from "@/hooks/useAccounts";
import { grzKeys, type GrzTBill } from "@/hooks/useGrzSecurities";
import { transactionKeys } from "@/hooks/useTransactions";
import { invalidateReportsForChange } from "@/hooks/use-reports";
import { investmentKeys } from "@/hooks/investments/keys";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/contexts/SessionContext";
import { apiRequest } from "@/lib/queryClient";
import { generateIdempotencyKey } from "@/lib/api";
import type { OperationLifetime } from "@/lib/operation-lifetime";
import { useHouseholdCalendarTimeZone } from "@/lib/calendarZone";
import { householdCalendarDate } from "@shared/household-calendar";

const selectClass = "block w-full rounded-md border bg-background p-2";

interface ReceiptRequest {
  operationId: string;
  accountId: string;
  date: string;
  receiptConfirmed: true;
  receivedAmount: { amount: string; currency: "ZMW" };
}
interface Attempt { body: ReceiptRequest; editable: boolean; dispatch: number }
// An unacknowledged confirmation survives dialog remounts, so a retry resends the same operation.
const requests = new WeakMap<OperationLifetime, Map<string, Attempt>>();

/** A-36: confirm the bank credit of a T-bill awaiting receipt. */
export function TBillReceiptAction({ tbill }: { tbill: GrzTBill }) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const status = session.status, lifetime = session.lifetime?.operation;
  if (status?.state !== "ready" || !lifetime?.active || !["owner", "admin", "member"].includes(status.household.role)) return null;
  let attempts = requests.get(lifetime);
  if (!attempts) { attempts = new Map(); requests.set(lifetime, attempts); }
  const previous = attempts.has(tbill.id);
  if (!previous && (tbill.status !== "awaiting_receipt" || !tbill.maturityNetProceeds)) return null;
  return <Popover key={lifetime.id} open={open} onOpenChange={setOpen}><PopoverTrigger asChild>
    <Button size="sm" variant="outline">{previous ? "Review receipt" : "Confirm receipt"}</Button>
  </PopoverTrigger><PopoverContent className="max-h-[70vh] w-80 overflow-y-auto">
    <TBillReceiptForm tbill={tbill} attempts={attempts} lifetime={lifetime} />
  </PopoverContent></Popover>;
}

function TBillReceiptForm({ tbill, attempts, lifetime }: { tbill: GrzTBill; attempts: Map<string, Attempt>; lifetime: OperationLifetime }) {
  const client = useQueryClient();
  const accounts = useAccounts();
  const { toast } = useToast();
  const expected = tbill.maturityNetProceeds?.amount ?? "";
  const [accountId, setAccount] = useState(tbill.accountId ?? "");
  const [date, setDate] = useState("");
  const [credited, setCredited] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const attempt = attempts.get(tbill.id);
  // R1-04: the server accepts receipts up to today's household date, not UTC's.
  const today = householdCalendarDate(new Date(), useHouseholdCalendarTimeZone());
  const save = useMutation({
    mutationFn: async ({ body }: { body: ReceiptRequest; dispatch: number }) => {
      const response = await apiRequest("POST", `/api/grz/tbills/${tbill.id}/confirm-receipt`, body, lifetime);
      const { data } = await response.json();
      if (response.status === 200 && data?.id === tbill.id && data.status === "matured") return data;
      throw new Error("The receipt could not be verified. Retry with the same details.");
    },
    onSuccess: (_data, submission) => {
      const saved = attempts.get(tbill.id);
      if (!lifetime.active || saved?.body !== submission.body || saved.dispatch !== submission.dispatch) return;
      attempts.delete(tbill.id);
      setConfirmed(true);
      toast({ title: "T-bill receipt recorded" });
      void client.invalidateQueries({ queryKey: grzKeys.tbills() });
      void client.invalidateQueries({ queryKey: accountKeys.all });
      void client.invalidateQueries({ queryKey: transactionKeys.all });
      void client.invalidateQueries({ queryKey: investmentKeys.transactionsRoot() });
      invalidateReportsForChange(client, "transaction");
      invalidateReportsForChange(client, "account");
    },
    onError: (error: Error & { status?: number }, submission) => {
      const saved = attempts.get(tbill.id);
      if (lifetime.active && saved?.body === submission.body && saved.dispatch === submission.dispatch &&
          error.status && [400, 403, 404, 409, 422].includes(error.status)) saved.editable = true;
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending || confirmed || !accountId || !date || !credited || !expected || attempts.has(tbill.id)) return;
    const body: ReceiptRequest = { operationId: generateIdempotencyKey(), accountId, date, receiptConfirmed: true,
      receivedAmount: { amount: expected, currency: "ZMW" } };
    attempts.set(tbill.id, { body, editable: false, dispatch: 1 });
    save.mutate({ body, dispatch: 1 });
  }
  if (attempt) return <div className="space-y-2 text-left">
    <p>Receipt of ZMW {attempt.body.receivedAmount.amount} on {attempt.body.date}.</p>
    {save.isError && <p role="alert">{save.error.message}</p>}
    <Button type="button" disabled={save.isPending} onClick={() => { attempt.editable = false;
      save.mutate({ body: attempt.body, dispatch: ++attempt.dispatch }); }}>Retry original receipt</Button>
    {attempt.editable && <Button type="button" variant="outline" onClick={() => { attempts.delete(tbill.id); save.reset(); }}>Review new terms</Button>}
  </div>;
  return <form onSubmit={submit} className="space-y-3 text-left">
    <p>Expected bank credit: ZMW {expected}, the face value of ZMW {tbill.faceValue.amount} less ZMW {tbill.maturityWithholdingTax?.amount ?? "0.00"} withholding tax.</p>
    <p className="text-sm text-muted-foreground">ZMW {tbill.purchasePrice.amount} returns as principal; the rest is recorded as interest income.</p>
    <p role="note" className="text-sm">This records the bank credit for you. If you import bank statements, skip this credit's line there, or you will count it twice.</p>
    <fieldset disabled={save.isPending || confirmed} className="space-y-3">
      <label className="block">Receiving account<select required className={selectClass} value={accountId} onChange={e => setAccount(e.target.value)}>
        <option value="">Choose a ZMW account</option>{accounts.data?.filter(a => a.currency === "ZMW" && a.isAsset && !a.isArchived)
          .map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select></label>
      <label className="block">Date the bank credited it<Input required type="date" min={tbill.maturityDate}
        max={today} value={date} onChange={e => setDate(e.target.value)} /></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={credited} onChange={e => setCredited(e.target.checked)} />
        The bank credited ZMW {expected}</label>
      <Button type="submit" disabled={save.isPending || confirmed || !credited}>Confirm receipt</Button>
    </fieldset>
    {save.isError && <p role="alert">{save.error.message}</p>}
    {confirmed && <p role="status">T-bill receipt recorded.</p>}
  </form>;
}
