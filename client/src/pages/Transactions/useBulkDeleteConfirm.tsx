import { useState, type ReactNode } from "react";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";

const transactionsLabel = (count: number) => `${count} ${count === 1 ? "transaction" : "transactions"}`;

/**
 * Bulk delete on the Transactions page (toolbar button and keyboard shortcut)
 * confirms in the app's dialog (NEW-37). The selection is frozen when the
 * dialog opens, so confirm deletes exactly the transactions it named.
 */
export function useBulkDeleteConfirm(
  selectedIds: ReadonlySet<string>,
  onDelete: (ids: string[]) => void,
): { request: () => void; dialog: ReactNode } {
  const [pendingIds, setPendingIds] = useState<string[] | null>(null);

  const request = () => {
    const ids = Array.from(selectedIds);
    if (ids.length > 0) setPendingIds(ids);
  };

  const label = transactionsLabel(pendingIds?.length ?? 0);
  const dialog = (
    <ConfirmActionDialog
      open={pendingIds !== null}
      onOpenChange={(open) => { if (!open) setPendingIds(null); }}
      title={`Delete ${label}?`}
      description={`The selected ${label} will be permanently deleted. This cannot be undone.`}
      confirmLabel={`Delete ${label}`}
      onConfirm={() => { if (pendingIds) onDelete(pendingIds); }}
    />
  );
  return { request, dialog };
}
