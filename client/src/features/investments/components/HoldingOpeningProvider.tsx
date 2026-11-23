import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { useSession } from "@/contexts/SessionContext";
import { AddHoldingModal } from "./AddHoldingModal";

const OpenHolding = createContext<(() => void) | null>(null);

/** A single lifetime-owned form keeps the original draft, attempt and synchronous
 * submission latch above both triggers and every holdings-query layout branch. */
export function HoldingOpeningProvider({ children }: { children: ReactNode }) {
  const { status, lifetime } = useSession();
  const operation = lifetime?.operation;
  if (status?.state !== "ready" || !operation?.active || operation.expectations?.subject !== status.subject.id ||
      operation.expectations?.household !== status.household.id) {
    return <OpenHolding.Provider value={() => {}}>{children}</OpenHolding.Provider>;
  }
  return <OpeningOwner key={operation.id}>{children}</OpeningOwner>;
}

function OpeningOwner({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  return <OpenHolding.Provider value={() => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }}>
    {children}
    <AddHoldingModal open={open} onOpenChange={setOpen} onCloseAutoFocus={event => {
      const target = trigger.current?.isConnected ? trigger.current : document.querySelector<HTMLElement>("[data-holding-opening-trigger]");
      if (target) { event.preventDefault(); target.focus(); }
    }} />
  </OpenHolding.Provider>;
}

export function useOpenHolding() {
  const open = useContext(OpenHolding);
  if (!open) throw new Error("Holding opening triggers require HoldingOpeningProvider");
  return open;
}
