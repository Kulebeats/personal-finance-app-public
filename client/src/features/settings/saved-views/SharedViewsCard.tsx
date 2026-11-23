/**
 * R05.2 Settings > Members "Shared views": lists the household's named saved
 * views, applies one to the Transactions list, and (owner and admin) creates,
 * edits and deletes them. Replaces the dead "Configure shared views" link.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Filter, Pencil, Plus, Trash2 } from "lucide-react";
import type { SavedViewFilter, SavedViewResponse } from "@shared/saved-views";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import { SavedViewDialog } from "./SavedViewDialog";
import { savedViewUrl } from "./savedViewUrl";
import { useDeleteSavedView, useSaveSavedView, useSavedViews } from "./useSavedViews";

interface SharedViewsCardProps {
  canManage: boolean;
}

export function SharedViewsCard({ canManage }: SharedViewsCardProps) {
  const [, setLocation] = useLocation();
  const views = useSavedViews();
  const accounts = useAccounts(undefined, canManage);
  const categories = useCategories();
  const save = useSaveSavedView();
  const remove = useDeleteSavedView();
  const [editing, setEditing] = useState<{ view: SavedViewResponse | null } | null>(null);
  const [deleting, setDeleting] = useState<SavedViewResponse | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const sharedAccounts = (accounts.data ?? []).filter((account) => !account.isPrivate)
    .map(({ id, name }) => ({ id, name }));
  const categoryOptions = (categories.data && "categories" in categories.data ? categories.data.categories : [])
    .map(({ id, name }) => ({ id, name }));

  const onSave = async (name: string, filter: SavedViewFilter) => {
    const view = editing?.view;
    await save.mutateAsync(view
      ? { mode: "update", id: view.id, input: { name, filter, version: view.version } }
      : { mode: "create", input: { name, filter } });
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteError(null);
    try {
      await remove.mutateAsync(deleting);
      setDeleting(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "The view could not be deleted. Please retry.");
    }
  };

  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-semibold">Shared views</CardTitle>
        {canManage && (
          <Button size="sm" variant="outline" onClick={() => setEditing({ view: null })}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />New view
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Named filters for the Transactions list that every member can apply. A view never shows anyone
          a private account or transaction they cannot already see.
        </p>
        {views.isLoading && <p className="text-sm text-muted-foreground">Loading shared views…</p>}
        {views.error && (
          <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
            Shared views could not be loaded.
            <Button size="sm" variant="link" className="px-0" onClick={() => views.refetch()}>Retry</Button>
          </div>
        )}
        {views.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {canManage ? "No shared views yet. Create one to give every member the same starting filter." : "No shared views yet."}
          </p>
        )}
        <ul className="divide-y divide-border" aria-label="Shared views">
          {views.data?.map((view) => (
            <li key={view.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{view.name}</div>
                {view.restricted && (
                  <div className="text-xs text-muted-foreground">Uses an account you can't see, so it can't be applied.</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" variant="ghost" disabled={view.restricted}
                  aria-label={`Apply ${view.name}`} onClick={() => setLocation(savedViewUrl(view.filter))}>
                  <Filter className="mr-1 h-4 w-4" aria-hidden="true" />Apply
                </Button>
                {canManage && (
                  <>
                    <Button size="icon" variant="ghost" aria-label={`Edit ${view.name}`} disabled={view.restricted}
                      onClick={() => setEditing({ view })}>
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label={`Delete ${view.name}`}
                      onClick={() => { setDeleteError(null); setDeleting(view); }}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>

      {canManage && (
        <SavedViewDialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}
          view={editing?.view ?? null} accounts={sharedAccounts} categories={categoryOptions}
          isSaving={save.isPending} onSave={onSave} />
      )}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The view is removed for every member. Transactions are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void confirmDelete(); }}
              disabled={remove.isPending}>
              Delete view
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
