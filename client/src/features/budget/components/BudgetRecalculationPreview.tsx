import { useId, useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { BudgetPreviewController } from "../hooks/useBudgetRecalculationPreview";
import { formatPreviewMoney, previewMonthLabel } from "../previewContract";

type VisibleName = { id: string; name: string; isArchived?: boolean; deletedAt?: string | null };
export interface BudgetPreviewNames { categories: readonly VisibleName[]; categoryGroups: readonly VisibleName[] }

export function BudgetRecalculationPreview({ categories, categoryGroups, preview }: BudgetPreviewNames & { preview: BudgetPreviewController }) {
  const confirmationId = useId();
  const opener = useRef<HTMLButtonElement>(null), open = useRef(preview.open); open.current = preview.open;
  const names = useMemo(() => {
    const result = new Map<string, string>();
    for (const [kind, rows] of [["category", categories], ["group", categoryGroups]] as const) {
      for (const row of rows) if (!row.isArchived && !row.deletedAt && row.name.trim()) result.set(`${kind}:${row.id}`, row.name);
    }
    return result;
  }, [categories, categoryGroups]);
  const rows = preview.data?.suggestions.map(suggestion => ({ suggestion,
    name: names.get(suggestion.categoryId ? `category:${suggestion.categoryId}` : `group:${suggestion.categoryGroupId}`) }));
  const unknownNames = rows?.some(row => !row.name);
  const selectedRows = rows?.filter((_, index) => preview.selected.includes(index));
  const locked = preview.applicationStatus !== undefined;

  return <Dialog open={preview.open} onOpenChange={preview.onOpenChange}>
    <div className="flex items-center justify-between p-3 bg-muted/20 rounded-lg border border-border/50">
      <div><div className="font-medium text-sm">Historical budget averages</div>
        <p className="text-xs text-muted-foreground">Review suggestions and choose any changes individually.</p></div>
      <DialogTrigger asChild><button ref={opener} disabled={!preview.allowed || (!preview.canApply && !locked)}
        className="text-xs font-medium px-3 py-1.5 border rounded disabled:opacity-60">Preview averages</button></DialogTrigger>
    </div>
    <DialogContent className="max-w-3xl" onCloseAutoFocus={event => {
      event.preventDefault();
      if (open.current && opener.current?.isConnected) return;
      if (opener.current?.isConnected && !opener.current.disabled) opener.current.focus();
      else document.querySelector<HTMLButtonElement>("[data-budget-settings-opener]")?.focus();
    }}>
      <DialogHeader><DialogTitle>Budget suggestions</DialogTitle>
        <DialogDescription>Review averages from activity visible to you. Budgets change only after your confirmation.</DialogDescription></DialogHeader>
      {preview.status === "checking" && <p role="status" aria-live="polite">Checking budget suggestions…</p>}
      {(preview.status === "error" || unknownNames) && <p role="alert">{preview.message || "Unable to verify the visible budget names. Refresh preview to try again. Your budgets have not changed."}</p>}
      {preview.status === "applied" && <p role="status" aria-live="polite">{preview.message}</p>}
      {preview.applicationStatus === "submitting" && <p role="status" aria-live="polite">Applying confirmed changes…</p>}
      {preview.applicationStatus === "uncertain" && <div className="space-y-3">
        <p role="alert">{preview.message}</p>
        {preview.rechecking && <p role="status" aria-live="polite">Checking current budgets…</p>}
        <div className="flex flex-wrap gap-3">
          {preview.canRetry && <button type="button" disabled={preview.rechecking} onClick={() => { void preview.apply(); }}
            className="px-3 py-2 text-sm border rounded disabled:opacity-60">Retry the same confirmed changes</button>}
          <button type="button" disabled={preview.rechecking} onClick={() => { void preview.recheck(); }}
            className="px-3 py-2 text-sm border rounded disabled:opacity-60">Recheck current budgets</button>
        </div>
      </div>}
      {preview.status === "ready" && preview.data && !unknownNames && <>
        <h3 className="font-medium">Suggestions for {previewMonthLabel(preview.data.targetPeriod)}</h3>
        <p>Included {preview.data.periods.length} completed months, including months with no activity:</p>
        <ul aria-label="Included completed months" className="flex flex-wrap gap-3 text-sm">
          {preview.data.periods.map(month => <li key={month}>{previewMonthLabel(month)}</li>)}</ul>
        {rows?.length ? <div className="overflow-x-auto"><table className="w-full text-sm">
          <caption className="sr-only">Monthly budget suggestions</caption>
          <thead><tr><th scope="col">Select</th><th scope="col" className="text-left">Budget</th><th scope="col">Current amount</th>
            <th scope="col">Historical total</th><th scope="col">Suggested monthly amount</th></tr></thead>
          <tbody>{rows.map(({ suggestion, name }, index) => <tr key={suggestion.categoryId ? `category:${suggestion.categoryId}` : `group:${suggestion.categoryGroupId}`}>
            <td className="px-3"><input type="checkbox" aria-label={`Select ${name}`} checked={preview.selected.includes(index)}
              disabled={preview.confirming || locked || !preview.canApply} onChange={event => preview.changeSelection(index, event.target.checked)} /></td>
            <th scope="row" className="text-left py-2">{name}</th>
            <td className="px-3">{suggestion.currentBudget ? formatPreviewMoney(suggestion.currentBudget.amount) : "No current budget"}</td>
            <td className="px-3">{formatPreviewMoney(suggestion.historicalTotal)}</td><td className="px-3">{formatPreviewMoney(suggestion.amount)}</td>
          </tr>)}</tbody>
        </table></div> : <p>No budget suggestions for these months.</p>}
        {rows?.length && !preview.confirming ? <button type="button" onClick={() => preview.reviewSelection(true)} disabled={!preview.selected.length || !preview.canApply}
          className="justify-self-start px-3 py-2 text-sm border rounded disabled:opacity-60">Review selected changes</button> : null}
        {preview.confirming && <section role="region" aria-labelledby={confirmationId} className="space-y-3 border rounded p-4">
          <h3 id={confirmationId} className="font-semibold">Confirm budget changes</h3>
          <p>Apply only the selected changes for {previewMonthLabel(preview.data.targetPeriod)}. Other months and unselected budgets stay unchanged.</p>
          <ul className="space-y-2">{selectedRows?.map(({ suggestion, name }) => <li key={suggestion.categoryId || suggestion.categoryGroupId}>
            <span className="font-medium">{name}: </span>
            {suggestion.currentBudget ? formatPreviewMoney(suggestion.currentBudget.amount) : "No current budget"} → {formatPreviewMoney(suggestion.amount)}
            {!suggestion.currentBudget && <p className="text-sm text-muted-foreground">This new limit applies only to {previewMonthLabel(preview.data!.targetPeriod)}; no future-month default is created.</p>}
          </li>)}</ul>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={locked} onClick={() => preview.reviewSelection(false)}
              className="px-3 py-2 text-sm border rounded disabled:opacity-60">Back to suggestions</button>
            <button type="button" disabled={!preview.canApply} onClick={() => { void preview.apply(); }}
              className="px-3 py-2 text-sm border rounded bg-primary text-primary-foreground disabled:opacity-60">
              {`Confirm changes for ${previewMonthLabel(preview.data.targetPeriod)}`}
            </button>
          </div>
        </section>}
      </>}
      <button onClick={() => { void preview.refresh(); }} disabled={preview.status === "checking" || locked}
        className="justify-self-start px-3 py-2 text-sm border rounded disabled:opacity-60">Refresh preview</button>
    </DialogContent>
  </Dialog>;
}
