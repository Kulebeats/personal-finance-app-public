import { useId, useState } from "react";
import { useSession } from "@/contexts/SessionContext";
import { useAccounts } from "@/hooks/useAccounts";
import type { GrzBond } from "@/hooks/useGrzSecurities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { emptyEvidenceFields, type EvidenceFields, type EvidenceKind, type EvidencePayload } from "../grzEvidenceContract";
import type { GrzEvidenceController } from "../hooks/useGrzEvidenceRecord";

function resumeFields(payload?: EvidencePayload): EvidenceFields {
  if (!payload) return emptyEvidenceFields();
  return { ...emptyEvidenceFields(), sourceKind: payload.sourceKind, sourceDate: payload.sourceDate, sourceReference: payload.sourceReference,
    ...("principalCost" in payload ? { principalCost: payload.principalCost, purchasedInterest: payload.purchasedInterest, acquisitionFees: payload.acquisitionFees }
      : { quoteBasis: payload.quoteBasis, quoteUnits: payload.quoteUnits, quotedAmount: payload.quotedAmount, accruedInterest: payload.accruedInterest ?? "", unknownAccrued: payload.accruedInterest === null }) };
}
interface Props { bond: GrzBond; kind: EvidenceKind; trigger: HTMLButtonElement; controller: GrzEvidenceController; close: () => void }
export function GrzEvidenceDialog({ bond, kind, trigger, controller, close }: Props) {
  const prefix = useId(), { status } = useSession();
  const { data: accounts, isLoading, isError } = useAccounts({ includeArchived: true, includeHidden: true });
  const account = status?.state === "ready" ? accounts?.find(row => row.id === bond.accountId && row.householdId === status.household.id && row.currency === "ZMW" && row.isAsset && !row.deletedAt &&
    (!row.isPrivate || row.ownerUserId === status.subject.id)) : undefined;
  const [fields, setFields] = useState(() => resumeFields(controller.request?.payload));
  const locked = controller.request !== undefined || controller.status === "recorded";
  const update = <K extends keyof EvidenceFields>(key: K, value: EvidenceFields[K]) => { if (!locked) setFields(previous => ({ ...previous, [key]: value })); };
  const fixed = (name: string, value: string, type = "text") => <div className="space-y-1"><Label htmlFor={`${prefix}-${name}`}>{name}</Label>
    <Input id={`${prefix}-${name}`} type={type} value={value} readOnly /></div>;
  const input = (key: Exclude<keyof EvidenceFields, "unknownAccrued">, name: string, type = "text", required = true) => <div className="space-y-1">
    <Label htmlFor={`${prefix}-${key}`}>{name}</Label><Input id={`${prefix}-${key}`} type={type} value={fields[key]} disabled={locked}
      required={required} maxLength={key === "sourceReference" ? 500 : undefined} onChange={event => update(key, event.target.value)} /></div>;
  const select = (key: "sourceKind" | "quoteBasis" | "quoteUnits", name: string, options: Array<[string, string]>) => <div className="space-y-1">
    <Label htmlFor={`${prefix}-${key}`}>{name}</Label><Select value={fields[key]} disabled={locked} onValueChange={value => {
      if (locked) return;
      setFields(previous => ({ ...previous, [key]: value, ...(key === "quoteBasis" && value === "clean" ? { unknownAccrued: false } : {}) }));
    }}><SelectTrigger id={`${prefix}-${key}`}><SelectValue placeholder={`Choose ${name.toLowerCase()}`} /></SelectTrigger><SelectContent>
      {options.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>;
  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto"
    onCloseAutoFocus={event => {
      event.preventDefault();
      if (trigger.isConnected) trigger.focus();
    }}>
    <DialogHeader><DialogTitle>Record {kind} evidence</DialogTitle><DialogDescription>
      Record attributable evidence for this existing holding in ZMW. It does not post or deduct cash. The source is recorded as member-provided.
    </DialogDescription></DialogHeader>
    {isLoading ? <p role="status">Loading custody account…</p> : isError || !account ? <p role="alert">A visible ZMW custody account is required to record this evidence.</p> : <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!locked) void controller.submit(kind, fields); }}>
      <p className="text-sm">{bond.bondName} · {account.name}</p>
      {(account.isHidden || account.isArchived || account.excludeFromNetWorth) && <p className="text-sm">This account is excluded from current net worth.</p>}
      <div className="grid grid-cols-2 gap-3">{fixed("ISIN", bond.isin ?? "")}{fixed("Nominal principal (ZMW)", bond.faceValue.amount)}</div>
      {kind === "acquisition" && <div className="grid grid-cols-2 gap-3">{fixed("Acquisition date", bond.purchaseDate, "date")}{fixed("Purchase cash (ZMW)", bond.purchasePrice.amount)}</div>}
      {select("sourceKind", "Source type", kind === "acquisition" ? [["custodian_statement", "Custodian statement"], ["trade_confirmation", "Trade confirmation"], ["contract_note", "Contract note"]]
        : [["custodian_statement", "Custodian statement"], ["same_issue_quote", "Same-issue quote"], ["same_issue_trade", "Same-issue trade"]])}
      {input("sourceDate", kind === "acquisition" ? "Source date" : "Market evidence date", "date")}
      {input("sourceReference", "Source reference")}
      {kind === "acquisition" ? <>
        <p className="text-sm text-muted-foreground">Use the documented breakdown. Enter zero explicitly where the source confirms no purchased interest or fees.</p>
        {input("principalCost", "Principal cost (ZMW)")}{input("purchasedInterest", "Purchased interest (ZMW)")}{input("acquisitionFees", "Acquisition fees (ZMW)")}
      </> : <>
        <p className="text-sm text-muted-foreground">Use evidence for this same issue on the date shown. Historical marks stay dated and do not establish today's value.</p>
        {select("quoteBasis", "Price basis", [["clean", "Clean price"], ["dirty", "Dirty price"]])}
        {select("quoteUnits", "Quote units", [["holding_amount", "Whole holding"], ["per_100_nominal", "Per ZMW 100 nominal"]])}
        {input("quotedAmount", "Quoted amount (ZMW)")}
        {fields.quoteBasis === "dirty" && <div className="flex items-center gap-2"><Checkbox id={`${prefix}-unknown`} checked={fields.unknownAccrued} disabled={locked}
          onCheckedChange={value => { if (!locked) setFields(previous => ({ ...previous, unknownAccrued: value === true, ...(value === true ? { accruedInterest: "" } : {}) })); }} />
          <Label htmlFor={`${prefix}-unknown`}>Accrued breakdown unavailable</Label></div>}
        {!fields.unknownAccrued && input("accruedInterest", "Accrued interest in the same units (ZMW)")}
        <p className="text-sm text-muted-foreground">Accrued interest must use the same units as the quote, including explicit zero. An unseparated dirty value supplies no clean principal amount.</p>
      </>}
      {controller.message && <p role={controller.status === "recorded" ? "status" : "alert"}>{controller.message}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={close}>Close evidence</Button>
        {controller.status === "uncertain" ? <Button type="button" disabled={controller.retryDenied} onClick={() => { void controller.retry(); }}>Retry same evidence</Button>
          : controller.status !== "recorded" && <Button type="submit" disabled={locked}>{controller.status === "submitting" ? "Recording evidence…" : `Record ${kind} evidence`}</Button>}
      </div>
    </form>}
    {(!account || isError || isLoading) && <Button type="button" variant="outline" onClick={close}>Close evidence</Button>}
  </DialogContent></Dialog>;
}
