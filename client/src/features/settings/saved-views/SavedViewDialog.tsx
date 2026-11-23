/**
 * Create or edit a named household saved view (owner and admin only).
 * The server validates the filter strictly; this form only offers the fields
 * the Transactions page can apply, and keeps tag filters it does not edit.
 */
import { useEffect, useState, type FormEvent } from "react";
import type { SavedViewFilter, SavedViewResponse } from "@shared/saved-views";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface SavedViewOption { id: string; name: string }

interface SavedViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: SavedViewResponse | null;
  accounts: SavedViewOption[];
  categories: SavedViewOption[];
  isSaving: boolean;
  onSave: (name: string, filter: SavedViewFilter) => Promise<void>;
}

type Draft = Record<"name" | "search" | "accountId" | "categoryId" | "type" | "owner" | "reviewed"
  | "startDate" | "endDate" | "amountMin" | "amountMax", string>;

function toDraft(view: SavedViewResponse | null): Draft {
  const filter = view?.filter ?? {};
  return {
    name: view?.name ?? "", search: filter.search ?? "", accountId: filter.accountId ?? "",
    categoryId: filter.categoryId ?? "", type: filter.type ?? "", owner: filter.owner ?? "",
    reviewed: filter.reviewed ?? "", startDate: filter.startDate ?? "", endDate: filter.endDate ?? "",
    amountMin: filter.amountMin ?? "", amountMax: filter.amountMax ?? "",
  };
}

/** Empty fields are left out, so the stored filter only holds the conditions the manager chose. */
function toFilter(draft: Draft, kept: SavedViewFilter | undefined): SavedViewFilter {
  const pick = (value: string) => (value.trim() ? value.trim() : undefined);
  const filter = {
    search: pick(draft.search), accountId: pick(draft.accountId), categoryId: pick(draft.categoryId),
    type: pick(draft.type), owner: pick(draft.owner), reviewed: pick(draft.reviewed),
    startDate: pick(draft.startDate), endDate: pick(draft.endDate),
    amountMin: pick(draft.amountMin), amountMax: pick(draft.amountMax), tagIds: kept?.tagIds,
  };
  return Object.fromEntries(Object.entries(filter).filter(([, value]) => value !== undefined)) as SavedViewFilter;
}

const selectClass = "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm";

function Choice({ id, label, value, onChange, options }: {
  id: string; label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]>;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} className={selectClass} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Any</option>
        {options.map(([optionValue, text]) => <option key={optionValue} value={optionValue}>{text}</option>)}
      </select>
    </div>
  );
}

function Text({ id, label, value, onChange, type = "text" }: {
  id: string; label: string; value: string; onChange: (value: string) => void; type?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} inputMode={id.startsWith("view-amount") ? "decimal" : undefined}
        onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

export function SavedViewDialog({ open, onOpenChange, view, accounts, categories, isSaving, onSave }: SavedViewDialogProps) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(view));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setDraft(toDraft(view)); setError(null); } }, [open, view]);
  const set = (field: keyof Draft) => (value: string) => setDraft((current) => ({ ...current, [field]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await onSave(draft.name.trim(), toFilter(draft, view?.filter));
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The view could not be saved. Please retry.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{view ? "Edit shared view" : "New shared view"}</DialogTitle>
            <DialogDescription>
              Every member can apply this view to the Transactions list. It only narrows what each member can already see.
            </DialogDescription>
          </DialogHeader>
          <Text id="view-name" label="Name" value={draft.name} onChange={set("name")} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Text id="view-search" label="Search text" value={draft.search} onChange={set("search")} />
            <Choice id="view-account" label="Shared account" value={draft.accountId} onChange={set("accountId")}
              options={accounts.map(({ id, name }) => [id, name])} />
            <Choice id="view-category" label="Category" value={draft.categoryId} onChange={set("categoryId")}
              options={categories.map(({ id, name }) => [id, name])} />
            <Choice id="view-type" label="Type" value={draft.type} onChange={set("type")}
              options={[["expense", "Expense"], ["income", "Income"], ["transfer", "Transfer"]]} />
            <Choice id="view-owner" label="Owner" value={draft.owner} onChange={set("owner")}
              options={[["mine", "The viewer's own"], ["shared", "Shared only"]]} />
            <Choice id="view-reviewed" label="Review status" value={draft.reviewed} onChange={set("reviewed")}
              options={[["reviewed", "Reviewed"], ["unreviewed", "Unreviewed"]]} />
            <Text id="view-from" label="From" type="date" value={draft.startDate} onChange={set("startDate")} />
            <Text id="view-to" label="To" type="date" value={draft.endDate} onChange={set("endDate")} />
            <Text id="view-amount-min" label="Minimum amount" value={draft.amountMin} onChange={set("amountMin")} />
            <Text id="view-amount-max" label="Maximum amount" value={draft.amountMax} onChange={set("amountMax")} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSaving || !draft.name.trim()}>{isSaving ? "Saving…" : "Save view"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
