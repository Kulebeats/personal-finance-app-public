import { useLayoutEffect, useRef, useState } from "react";
import type { AccountHistoryState } from "../types";
import { AccountList, accountListKind, type AccountListKind, type AccountListProps } from "./AccountList";

interface AccountListRegionProps extends Omit<AccountListProps, "pendingEmptyState"> {
  historyState: AccountHistoryState;
}

/**
 * C3-30: the accounts list stays in one mounted region across a same-member
 * access re-check. Account rows are withheld until the new frame is confirmed;
 * the last confirmed empty state's action stays mounted so keyboard focus on it
 * survives. When a focused element must be removed (a withheld row, or an
 * action the new frame no longer offers), focus moves to this region rather
 * than falling to the page body.
 */
export function AccountListRegion({ historyState, ...list }: AccountListRegionProps) {
  const region = useRef<HTMLElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const confirmed: AccountListKind | null = historyState === "ready" ? accountListKind(list) : null;
  // Remember the last confirmed shape (React's "state from previous render" pattern).
  const [lastConfirmed, setLastConfirmed] = useState<AccountListKind | null>(confirmed);
  if (confirmed !== null && confirmed !== lastConfirmed) setLastConfirmed(confirmed);

  const checking = historyState === "checking";
  const pendingEmptyState = checking && lastConfirmed !== null && lastConfirmed !== "rows" ? lastConfirmed : undefined;
  const showList = historyState === "ready" || pendingEmptyState !== undefined;

  useLayoutEffect(() => {
    const previous = lastFocused.current;
    if (!previous || previous.isConnected) return;
    lastFocused.current = null;
    const active = document.activeElement;
    // Only recover focus that was dropped; never take it from somewhere the user moved it.
    if (active && active !== document.body) return;
    region.current?.focus({ preventScroll: true });
  });

  return (
    <section
      ref={region}
      aria-label="Accounts"
      aria-busy={checking}
      tabIndex={-1}
      onFocus={event => { if (event.target instanceof HTMLElement) lastFocused.current = event.target; }}
      className="space-y-6 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      {historyState !== "ready" && <p role={historyState === "error" ? "alert" : "status"}>
        {historyState === "error" ? "Unable to refresh account history. Refresh to try again." : "Checking current access…"}
      </p>}
      {showList && <AccountList {...list} pendingEmptyState={pendingEmptyState} />}
    </section>
  );
}
