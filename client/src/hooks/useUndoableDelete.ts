/**
 * useUndoableDelete Hook
 *
 * Provides undo functionality for destructive delete actions.
 * Shows a toast with an undo button that allows reverting the action
 * before a timeout expires. If not undone, the actual deletion is performed.
 */

import { useCallback, useRef } from "react";
import { toast } from "sonner";

export interface UndoableDeleteOptions<T> {
  /** Display name for the item being deleted */
  itemLabel: string;
  /** Called to perform the actual deletion after timeout */
  onDelete: (item: T) => Promise<void>;
  /** Called when undo is triggered */
  onUndo?: (item: T) => void;
  /** Timeout in ms before deletion is finalized (default: 5000) */
  timeout?: number;
  /** Called if deletion fails */
  onError?: (error: Error) => void;
}

interface PendingDelete<T> {
  item: T;
  toastId: string | number;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * useUndoableDelete - Hook for undoable delete operations
 *
 * @example
 * const { scheduleDelete, cancelAllPending } = useUndoableDelete({
 *   itemLabel: "transaction",
 *   onDelete: async (tx) => await deleteTransaction(tx.id),
 *   onUndo: (tx) => console.log("Restored", tx),
 * });
 *
 * // In component
 * <button onClick={() => scheduleDelete(transaction)}>Delete</button>
 */
export function useUndoableDelete<T extends { id: string }>({
  itemLabel,
  onDelete,
  onUndo,
  timeout = 5000,
  onError,
}: UndoableDeleteOptions<T>) {
  const pendingDeletes = useRef<Map<string, PendingDelete<T>>>(new Map());

  const performDelete = useCallback(
    async (item: T) => {
      try {
        await onDelete(item);
        pendingDeletes.current.delete(item.id);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        toast.error(`Failed to delete ${itemLabel}`, {
          description: error.message,
        });
        onError?.(error);
      }
    },
    [onDelete, itemLabel, onError],
  );

  const scheduleDelete = useCallback(
    (item: T, options?: { immediate?: boolean }) => {
      // If immediate, skip the undo flow
      if (options?.immediate) {
        performDelete(item);
        return;
      }

      // Cancel any existing pending delete for this item
      const existing = pendingDeletes.current.get(item.id);
      if (existing) {
        clearTimeout(existing.timeoutId);
        toast.dismiss(existing.toastId);
      }

      // Schedule the actual deletion
      const timeoutId = setTimeout(() => {
        performDelete(item);
      }, timeout);

      // Show undo toast
      const toastId = toast.info(`${itemLabel} deleted`, {
        description: "Click to undo",
        duration: timeout,
        action: {
          label: "Undo",
          onClick: () => {
            // Cancel the pending delete
            const pending = pendingDeletes.current.get(item.id);
            if (pending) {
              clearTimeout(pending.timeoutId);
              pendingDeletes.current.delete(item.id);
              toast.success(`${itemLabel} restored`);
              onUndo?.(item);
            }
          },
        },
      });

      // Store the pending delete
      pendingDeletes.current.set(item.id, {
        item,
        toastId,
        timeoutId,
      });
    },
    [itemLabel, timeout, performDelete, onUndo],
  );

  const cancelDelete = useCallback((id: string) => {
    const pending = pendingDeletes.current.get(id);
    if (pending) {
      clearTimeout(pending.timeoutId);
      toast.dismiss(pending.toastId);
      pendingDeletes.current.delete(id);
    }
  }, []);

  const cancelAllPending = useCallback(() => {
    pendingDeletes.current.forEach(({ timeoutId, toastId }) => {
      clearTimeout(timeoutId);
      toast.dismiss(toastId);
    });
    pendingDeletes.current.clear();
  }, []);

  const hasPendingDeletes = useCallback(() => {
    return pendingDeletes.current.size > 0;
  }, []);

  return {
    scheduleDelete,
    cancelDelete,
    cancelAllPending,
    hasPendingDeletes,
  };
}

export default useUndoableDelete;
