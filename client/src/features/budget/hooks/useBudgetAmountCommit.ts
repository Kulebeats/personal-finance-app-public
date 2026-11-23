/**
 * Commit handler for the budget detail dialog's amount input.
 *
 * Skips the commit when the typed amount equals the last amount saved from
 * this dialog, not the amount the row had when it was clicked: otherwise
 * 500 -> save 750 -> type 500 is skipped (page shows 500, 750 is saved) and
 * blurring an already-saved 750 re-commits it. A commit only opens the scope
 * chooser, so the baseline moves only when onCommitBudget reports a save
 * (A-17): after a cancel or a failed save, the same amount commits again.
 * The baseline resets when the dialog closes or opens for another item.
 */
import { useEffect, useRef } from "react";
import { parseMoney } from "@/lib/utils";
import type { SelectedItem, BudgetCategory, BudgetGroup } from "../types";

/** Resolves true once the amount was saved, false when it was not. */
type CommitBudget = (item: BudgetCategory, group: BudgetGroup, value: number) => Promise<boolean>;

export function useBudgetAmountCommit(
  snapshot: SelectedItem | null,
  groups: BudgetGroup[] | undefined,
  onCommitBudget: CommitBudget | undefined,
): (raw: string) => void {
  const lastCommitted = useRef<{ itemId: string; amount: number } | null>(null);
  const openItemId = snapshot?.itemId;
  useEffect(() => {
    lastCommitted.current = null;
  }, [openItemId]);

  return (raw: string) => {
    if (!snapshot || !onCommitBudget) return;
    const group = groups?.find((g) => g.id === snapshot.groupId);
    // Same rows as the inline row edit: group-budget and flexible rows don't commit here.
    if (!group || group.isGroupBudget || group.isFlexible) return;
    const liveItem = group.items.find((i) => i.id === snapshot.itemId) ?? snapshot.item;
    const val = parseMoney(raw);
    const saved = lastCommitted.current;
    const savedAmount = saved?.itemId === snapshot.itemId ? saved.amount : snapshot.item.budget;
    if (!Number.isFinite(val) || val === savedAmount) return;
    const { itemId } = snapshot;
    void onCommitBudget(liveItem, group, val).then((saved) => {
      if (saved) lastCommitted.current = { itemId, amount: val };
    });
  };
}
