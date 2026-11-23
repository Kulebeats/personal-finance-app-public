/**
 * The outcome of an amount handed to the Edit Budget scope chooser (A-17).
 *
 * Committing an amount only opens the chooser; the save happens there, or
 * not at all. `begin` returns a promise that `settle` resolves: true once the
 * save succeeded, false when the chooser closed without one (cancel, or after
 * a failed save, which leaves the chooser open until it is closed). A new
 * commit settles an unfinished one as not saved.
 */
import { useCallback, useRef } from "react";

export interface CommitOutcome {
  begin: () => Promise<boolean>;
  settle: (saved: boolean) => void;
}

export function useCommitOutcome(): CommitOutcome {
  const resolveRef = useRef<((saved: boolean) => void) | null>(null);

  const settle = useCallback((saved: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(saved);
  }, []);

  const begin = useCallback((): Promise<boolean> => {
    settle(false);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, [settle]);

  return { begin, settle };
}
