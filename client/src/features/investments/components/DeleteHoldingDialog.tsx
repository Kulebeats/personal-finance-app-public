import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Decimal from "decimal.js";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useSession } from "@/contexts/SessionContext";
import { useDeleteHolding } from "@/hooks/investments/useHoldings";
import type { Holding } from "@/hooks/useInvestments";
import { assertOperationLifetime, type OperationLifetime } from "@/lib/operation-lifetime";

type Target = Readonly<{ id: string; label: string }>;
type Phase = "review" | "pending" | "unknown" | "refused";
interface RemovalControls {
  canWrite: boolean;
  review: (holding: Holding) => void;
  resume?: () => void;
  recovery?: string;
}
const Removal = createContext<RemovalControls>({ canWrite: false, review: () => {} });
export const useHoldingRemoval = () => useContext(Removal);

/** This is only a review affordance. History and financial eligibility belong to the server. */
export function isZeroQuantityHolding(holding: Holding) {
  try { return new Decimal(holding.quantity).isZero(); } catch { return false; }
}

export function DeleteHoldingProvider({ children }: { children: ReactNode }) {
  const { status, lifetime } = useSession();
  const operation = lifetime?.operation;
  // Match financial.write: professionals can edit metadata, but cannot post financial changes.
  const canWrite = status?.state === "ready" && ["owner", "admin", "member"].includes(status.household.role);
  if (!canWrite || !operation?.active || status?.state !== "ready" ||
      operation.expectations?.subject !== status.subject.id || operation.expectations?.household !== status.household.id) {
    return <Removal.Provider value={{ canWrite: false, review: () => {} }}>{children}</Removal.Provider>;
  }
  return <RemovalOwner key={operation.id} operation={operation}>{children}</RemovalOwner>;
}

function RemovalOwner({ children, operation }: { children: ReactNode; operation: OperationLifetime }) {
  const remove = useDeleteHolding();
  const [target, setTarget] = useState<Target | null>(null), [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("review"), [error, setError] = useState<string | null>(null);
  const frozen = useRef<Target | null>(null), claimed = useRef(false), mounted = useRef(true);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => {
    try { assertOperationLifetime(operation); return mounted.current; } catch { return false; }
  };
  const close = (next: boolean) => {
    if (claimed.current) return;
    setOpen(next);
    if (!next && phase !== "unknown") { frozen.current = null; setTarget(null); }
  };
  const review = (holding: Holding) => {
    if (!current() || !isZeroQuantityHolding(holding)) return;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // A second row or a layout refresh cannot replace an unresolved removal.
    if (!frozen.current) {
      const next = Object.freeze({ id: holding.id, label: holding.security?.symbol || holding.security?.name || "this holding" });
      frozen.current = next; setTarget(next); setPhase("review"); setError(null);
    }
    setOpen(true);
  };
  const submit = async () => {
    const attempt = frozen.current;
    if (!attempt || claimed.current || phase === "refused" || !current()) return;
    claimed.current = true; setPhase("pending"); setError(null);
    try {
      await remove.mutateAsync(attempt.id);
      if (!current() || frozen.current !== attempt) return;
      frozen.current = null; setTarget(null); setOpen(false); setPhase("review");
    } catch (failure) {
      if (!current() || frozen.current !== attempt) return;
      const response = failure as Error & { status?: number };
      setError(response.message || "Please try again.");
      setPhase([400, 401, 403, 404, 409].includes(response.status ?? 0) ? "refused" : "unknown");
    } finally {
      if (current()) claimed.current = false;
    }
  };

  return <Removal.Provider value={{ canWrite: true, review, recovery: phase === "unknown" && !open ? target?.label : undefined, resume: () => setOpen(true) }}>
    {children}
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent onEscapeKeyDown={event => { if (claimed.current) event.preventDefault(); }} onCloseAutoFocus={event => {
        const focus = trigger.current?.isConnected ? trigger.current : document.querySelector<HTMLElement>("[data-holding-opening-trigger]");
        if (focus) { event.preventDefault(); focus.focus(); }
      }}>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove holding?</AlertDialogTitle>
          <AlertDialogDescription>
            Review removal of {target?.label}. The server will check that the holding has zero shares and no posted investment history before removing it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <div role="alert" className="space-y-2 text-sm text-destructive">
          {phase === "unknown" && <p>Removal was not confirmed. Retry the same holding.</p>}
          <p>{error}</p>
        </div>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={phase === "pending"}>{phase === "review" || phase === "pending" ? "Cancel" : "Close"}</AlertDialogCancel>
          {phase !== "refused" && <AlertDialogAction disabled={phase === "pending"} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={event => { event.preventDefault(); void submit(); }}>
            {phase === "pending" ? "Removing…" : phase === "unknown" ? "Retry removal" : "Remove holding"}
          </AlertDialogAction>}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </Removal.Provider>;
}

export function HoldingDeleteRecovery() {
  const { recovery, resume } = useHoldingRemoval();
  if (!recovery) return null;
  return <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-4">
    <p className="text-sm">Removal of {recovery} was not confirmed. Review it to retry the same holding.</p>
    <Button type="button" variant="outline" onClick={resume}>Review removal</Button>
  </div>;
}
