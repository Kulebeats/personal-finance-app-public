import { useEffect, useId, useRef } from "react";
import Decimal from "decimal.js";
import { calculateSipFillEconomics, SIP_OCCURRENCE_MAX_FILLS } from "@shared/sip-occurrence-contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSipOccurrenceCommands } from "@/hooks/investments/useSipOccurrences";
import type { SipConfirmationDraft, SipPendingOccurrence } from "@/hooks/investments/sipOccurrenceApi";
import { SipOccurrenceFillEditor } from "./SipOccurrenceFillEditor";

const Exact = Decimal.clone({ precision: 60 });
const blankFill = () => ({ executionDate: "", quantity: "", price: "", fees: "" });
const emptyDraft = (): SipConfirmationDraft => ({ finalStatement: false, outcome: "", fills: [blankFill()] });

function preview(draft: SipConfirmationDraft) {
  if (!draft.fills.length && draft.outcome !== "unfilled") return null;
  try {
    return draft.fills.reduce((total, fill) => total.plus(calculateSipFillEconomics(fill).amount), new Exact(0));
  } catch {
    // Incomplete input has no actual-total preview; never substitute zero facts.
    return null;
  }
}

export function SipOccurrenceConfirmation({ occurrence, accountLabel, securityLabel, readFailed, onClose, onRecorded }: {
  occurrence: SipPendingOccurrence;
  accountLabel?: string;
  securityLabel?: string;
  readFailed: boolean;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const commands = useSipOccurrenceCommands();
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const stored = commands.draft?.occurrence.planId === occurrence.planId && commands.draft.occurrence.scheduledDate === occurrence.scheduledDate
    ? commands.draft : null;
  const draft: SipConfirmationDraft = stored ? { ...stored.terms, fills: stored.terms.fills.map(fill => ({ ...fill })) } : emptyDraft();
  const pendingHere = commands.pending?.planId === occurrence.planId && commands.pending.scheduledDate === occurrence.scheduledDate;
  const locked = !commands.allowed || !!commands.pending || readFailed || !occurrence.permittedActions.includes("confirm");
  const update = (next: SipConfirmationDraft) => commands.setDraft(occurrence, next);
  const actual = preview(draft);
  const record = async (retry = false) => {
    const accepted = await (retry ? commands.retry() : commands.confirm(occurrence, draft));
    if (accepted && commands.isCurrent()) onRecorded();
  };
  return (
    <form aria-label={`Confirm final statement for ${occurrence.scheduledDate}`} className="space-y-4"
      onSubmit={event => {
        event.preventDefault();
        void record();
      }}>
      <div>
        <h4 ref={heading} tabIndex={-1} className="font-semibold">Confirm final statement</h4>
        <p className="text-sm">Pending final broker statement — scheduled {occurrence.scheduledDate}</p>
        <p className="text-sm">Planned: {occurrence.planned.currency} {occurrence.planned.amount}</p>
        <dl className="mt-2 grid grid-cols-2 gap-1 text-xs">
          <dt>Original custody account</dt><dd className="break-all">{accountLabel ?? occurrence.planned.accountId}</dd>
          <dt>Original instrument</dt><dd className="break-all">{securityLabel ?? occurrence.planned.securityId}</dd>
          <dt>Original cadence</dt><dd>{occurrence.planned.authorizedFrequency.replace(/_/g, " ")}</dd>
          <dt>Original initial date</dt><dd>{occurrence.planned.authorizedInitialDate}</dd>
        </dl>
      </div>
      <p className="text-sm text-muted-foreground">Record each actual fill from the final statement. This does not place broker orders or move cash.</p>
      <div className="space-y-1">
        <Label htmlFor={`${id}-outcome`}>Final order outcome</Label>
        <select id={`${id}-outcome`} required value={draft.outcome} disabled={locked}
          onChange={event => update({ ...draft, outcome: event.target.value as SipConfirmationDraft["outcome"] })}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Choose the final outcome</option>
          <option value="filled">Filled</option>
          <option value="partially_filled">Partially filled (final)</option>
          <option value="unfilled">Unfilled (final)</option>
        </select>
      </div>
      {draft.fills.map((fill, index) => <SipOccurrenceFillEditor key={index} index={index} fill={fill}
        currency={occurrence.planned.currency} disabled={locked} fields={commands.fields}
        onChange={changed => update({ ...draft, fills: draft.fills.map((item, position) => position === index ? changed : item) })}
        onRemove={() => update({ ...draft, fills: draft.fills.filter((_item, position) => position !== index) })} />)}
      {commands.fields.fills && <p role="alert" className="text-sm text-destructive">{commands.fields.fills.join(" ")}</p>}
      {draft.outcome === "unfilled" && draft.fills.length > 0 && <p className="text-sm">Remove the fill rows to declare a final unfilled order. Existing rows are never discarded automatically.</p>}
      <Button type="button" variant="outline" size="sm" disabled={locked || draft.fills.length >= SIP_OCCURRENCE_MAX_FILLS}
        onClick={() => update({ ...draft, fills: [...draft.fills, blankFill()] })}>Add actual fill</Button>
      <p className="text-xs text-muted-foreground">Up to 100 actual fills per final statement. Do not average fills or allocate an order-level fee between them.</p>
      <div className="space-y-1">
        <Label htmlFor={`${id}-reference`}>Broker reference (optional)</Label>
        <Input id={`${id}-reference`} value={draft.brokerReference ?? ""} disabled={locked} autoComplete="off"
          aria-invalid={!!commands.fields.brokerReference} aria-describedby={commands.fields.brokerReference ? `${id}-reference-error` : undefined} onChange={event => {
            const next = { ...draft };
            if (event.target.value === "") {
              delete next.brokerReference;
            } else {
              next.brokerReference = event.target.value;
            }
            update(next);
          }} />
        <p className="text-xs text-muted-foreground">Optional supplied reference, up to 200 characters. Leave blank if none was supplied.</p>
        {commands.fields.brokerReference && <p id={`${id}-reference-error`} role="alert" className="text-sm text-destructive">{commands.fields.brokerReference.join(" ")}</p>}
      </div>
      {actual && <p className="rounded-md bg-muted p-3 text-sm">Actual total: {occurrence.planned.currency} {actual.toFixed(2)}.
        {" "}Difference from plan: {actual.minus(occurrence.planned.amount).toFixed(2)}.</p>}
      <div className="flex items-start gap-2">
        <input id={`${id}-final`} type="checkbox" checked={draft.finalStatement} disabled={locked}
          onChange={event => update({ ...draft, finalStatement: event.target.checked })} />
        <Label htmlFor={`${id}-final`}>I have the final broker statement</Label>
      </div>
      {commands.message && <p role="alert" className="text-sm">{commands.message}</p>}
      {commands.busy && pendingHere && <p role="status" className="text-sm">Submitting the original final statement…</p>}
      {readFailed && <p role="alert" className="text-sm">Refresh the occurrence list before starting a new confirmation.</p>}
      <div className="flex flex-wrap gap-2">
        {commands.uncertain && pendingHere ? <Button type="button" disabled={!commands.allowed || commands.busy}
          onClick={() => void record(true)}>Retry original confirmation</Button> : <Button type="submit" disabled={locked || !draft.finalStatement}>Record final statement</Button>}
        <Button type="button" variant="outline" onClick={onClose}>Back to scheduled purchases</Button>
      </div>
    </form>
  );
}
