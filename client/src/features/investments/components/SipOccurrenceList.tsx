import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useSipOccurrenceCommands, useSipOccurrences } from "@/hooks/investments/useSipOccurrences";
import type { SipClosedOccurrence } from "@/hooks/investments/sipOccurrenceApi";
import { SipOccurrenceConfirmation } from "./SipOccurrenceConfirmation";
import { SipHouseholdCalendar } from "./SipHouseholdCalendar";

function RecordedFills({ occurrence }: { occurrence: SipClosedOccurrence }) {
  const { result, planned } = occurrence;
  return <div className="space-y-2 text-sm">
    <h5 className="font-semibold">{result.outcome === "unfilled" ? "Final unfilled — no purchases"
      : result.outcome === "partially_filled" ? "Final partially filled" : "Final filled"}</h5>
    <p>Planned: {planned.currency} {planned.amount}. Actual total: {planned.currency} {result.totals.amount}.</p>
    {result.fills.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-xs">
      <caption className="sr-only">Recorded actual fills</caption>
      <thead><tr><th scope="col">Date</th><th scope="col">Quantity</th><th scope="col">Price ({planned.currency})</th><th scope="col">Fees</th><th scope="col">Amount</th></tr></thead>
      <tbody>{result.fills.map(fill => <tr key={fill.purchaseId} className="border-t">
        <td className="py-2 pr-2">{fill.executionDate}</td><td className="pr-2">{fill.quantity}</td><td className="pr-2">{fill.price}</td><td className="pr-2">{fill.fees}</td><td>{fill.amount}</td>
      </tr>)}</tbody>
    </table></div>}
  </div>;
}

export function SipOccurrenceList({ planId, accounts = [], securities = [], planDetails }: {
  planId: string;
  accounts?: ReadonlyArray<{ id: string; name: string }>;
  securities?: ReadonlyArray<{ id: string; name: string; symbol: string }>;
  planDetails?: ReactNode;
}) {
  const [view, setView] = useState<"pending" | "closed">("pending");
  const [before, setBefore] = useState<string | undefined>();
  const [selected, setSelected] = useState<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const query = useSipOccurrences(planId, { state: view, limit: 25, ...(before ? { before } : {}) });
  const commands = useSipOccurrenceCommands();
  useEffect(() => {
    if (query.detailsWithheld) setSelected(null);
  }, [query.detailsWithheld]);
  const row = query.data?.data.find(item => item.scheduledDate === selected);
  const original = commands.draft?.occurrence.planId === planId && commands.draft.occurrence.scheduledDate === selected
    ? commands.draft.occurrence : null;
  const pending = row?.state === "pending" ? row : row?.detailsAvailable === false ? null : commands.pending && original;
  const changeView = (next: "pending" | "closed") => {
    setView(next);
    setBefore(undefined);
    setSelected(null);
  };
  return <>
    {!query.detailsWithheld && planDetails}
    <section aria-label="Scheduled purchase confirmations" className="space-y-4 border-t pt-4">
      <h4 className="font-semibold">Scheduled purchases</h4>
      {query.canRead && <SipHouseholdCalendar />}
      {!query.detailsWithheld && pending ? <SipOccurrenceConfirmation occurrence={pending} readFailed={query.isError}
        accountLabel={accounts.find(account => account.id === pending.planned.accountId)?.name}
        securityLabel={securities.find(security => security.id === pending.planned.securityId)?.name}
        onClose={() => {
          setSelected(null);
          queueMicrotask(() => document.getElementById(`sip-review-${planId}-${pending.scheduledDate}`)?.focus());
        }} onRecorded={() => {
          if (mounted.current && commands.isCurrent()) changeView("closed");
        }} /> : <>
        <div className="flex gap-2" role="group" aria-label="Occurrence state">
          <Button size="sm" variant={view === "pending" ? "default" : "outline"} onClick={() => changeView("pending")}>Pending</Button>
          <Button size="sm" variant={view === "closed" ? "default" : "outline"} onClick={() => changeView("closed")}>Closed</Button>
        </div>
        {query.isLoading && <p role="status" className="text-sm">Loading scheduled purchases…</p>}
        {(query.isError || query.detailsWithheld) && <div role="alert" className="space-y-2 text-sm">
          <p>The scheduled purchase list could not be refreshed.</p>
          <Button size="sm" variant="outline" disabled={!query.canRead || (query.detailsWithheld && query.isFetching)}
            onClick={() => void query.refetch()}>Retry scheduled purchases</Button>
        </div>}
        {!query.detailsWithheld && commands.message && <p role="status" className="text-sm">{commands.message}</p>}
        {!query.detailsWithheld && commands.allowed && commands.pending?.planId === planId && <Button size="sm" variant="outline"
          onClick={() => setSelected(commands.pending!.scheduledDate)}>Resume original confirmation</Button>}
        {query.data?.data.map(item => <article key={item.scheduledDate} className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Scheduled {item.scheduledDate}</p>
          {item.state === "pending" ? <>
            <p className="text-sm">Pending final broker statement</p>
            <p className="text-sm text-muted-foreground">Planned: {item.planned.currency} {item.planned.amount}</p>
            {commands.allowed && item.permittedActions.includes("confirm") && <Button id={`sip-review-${planId}-${item.scheduledDate}`}
              size="sm" variant="outline" disabled={query.isError || query.isFetching ||
                (!!commands.pending && (commands.pending.planId !== planId || commands.pending.scheduledDate !== item.scheduledDate))}
              onClick={() => setSelected(item.scheduledDate)}>Review final statement for {item.scheduledDate}</Button>}
          </> : item.detailsAvailable ? <RecordedFills occurrence={item} /> : <p className="text-sm">Closed</p>}
        </article>)}
        {!query.isError && query.data?.data.length === 0 && <p className="text-sm text-muted-foreground">
          {view === "pending" ? "No pending scheduled purchases." : "No closed scheduled purchases on this page."}
        </p>}
        <div className="flex gap-2">
          {!query.detailsWithheld && before && <Button size="sm" variant="outline" onClick={() => setBefore(undefined)}>Latest scheduled purchases</Button>}
          {query.data?.pagination.hasMore && <Button size="sm" variant="outline" disabled={query.isFetching}
            onClick={() => setBefore(query.data?.pagination.nextBefore ?? undefined)}>Older scheduled purchases</Button>}
        </div>
      </>}
      <p className="text-xs text-muted-foreground">Future plan terms stay unchanged. Actual fills may differ from the planned amount.</p>
    </section>
  </>;
}
