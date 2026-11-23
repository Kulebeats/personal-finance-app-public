import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { z } from "zod";
import { isCanonicalImportDate } from "@shared/import-date";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSession } from "@/contexts/SessionContext";
import { useToast } from "@/hooks/use-toast";
import type { Holding } from "@/hooks/investments/types";
import { apiRequest } from "@/lib/queryClient";
import { assertOperationLifetime, type OperationLifetime } from "@/lib/operation-lifetime";
import { HouseholdPriceInstrumentPicker, type PriceInstrument } from "./HouseholdPriceInstrumentPicker";

interface Target { id: string; label: string; currency: string }
interface Terms { price: string; date: string; validThrough: string }
interface Attempt { target: Readonly<Target>; terms: Readonly<Terms> }
interface Controls {
  canRecord: boolean;
  review: (holding: Holding, trigger?: HTMLElement) => void;
  begin?: (trigger: HTMLElement) => void;
  recovery?: string;
  resume?: () => void;
}
const PriceControls = createContext<Controls>({ canRecord: false, review: () => {} });
const receiptSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string().uuid(), householdId: z.string(), securityId: z.string(), currency: z.string(),
    price: z.string(), effectiveDate: z.string(), validThrough: z.string(),
  }),
});
function validTerms(terms: Terms) {
  try {
    return new Decimal(terms.price).isFinite() &&
      isCanonicalImportDate(terms.date) && !terms.date.startsWith("0000-") &&
      isCanonicalImportDate(terms.validThrough) && !terms.validThrough.startsWith("0000-") &&
      terms.validThrough >= terms.date;
  } catch {
    return false;
  }
}
function assertReceipt(value: unknown, attempt: Attempt, household: string | undefined) {
  const parsed = receiptSchema.safeParse(value);
  if (!parsed.success || parsed.data.data.householdId !== household ||
      parsed.data.data.securityId !== attempt.target.id || parsed.data.data.currency !== attempt.target.currency ||
      parsed.data.data.effectiveDate !== attempt.terms.date || parsed.data.data.validThrough !== attempt.terms.validThrough ||
      !new Decimal(parsed.data.data.price).eq(attempt.terms.price)) {
    throw new Error("The response did not confirm this household price.");
  }
}

/** One form survives holdings refetches; session changes retire its draft and callbacks. */
export function HouseholdSecurityPriceProvider({ children }: { children: ReactNode }) {
  const { status, lifetime } = useSession();
  const operation = lifetime?.operation;
  if (status?.state !== "ready" || !["owner", "admin"].includes(status.household.role) || !operation?.active ||
      operation.expectations?.subject !== status.subject.id || operation.expectations?.household !== status.household.id) {
    return <PriceControls.Provider value={{ canRecord: false, review: () => {} }}>{children}</PriceControls.Provider>;
  }
  return <PriceOwner key={operation.id} operation={operation}>{children}</PriceOwner>;
}

function PriceOwner({ operation, children }: { operation: OperationLifetime; children: ReactNode }) {
  const client = useQueryClient();
  const { toast } = useToast();
  const fieldId = useId();
  const [target, setTarget] = useState<Target | null>(null);
  const [open, setOpen] = useState(false);
  const [terms, setTerms] = useState<Terms>({ price: "", date: "", validThrough: "" });
  const [phase, setPhase] = useState<"draft" | "pending" | "unknown">("draft");
  const [error, setError] = useState<string | null>(null);
  const original = useRef<Attempt | null>(null);
  const claimed = useRef(false);
  const mounted = useRef(true);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const current = () => {
    try {
      assertOperationLifetime(operation);
      return mounted.current;
    } catch {
      return false;
    }
  };
  const review = (holding: Holding, source?: HTMLElement) => {
    if (!current() || holding.householdId !== operation.expectations?.household || !holding.security ||
        holding.securityId !== holding.security.id || !/^[A-Z]{3}$/.test(holding.security.currency)) return;
    trigger.current = source ?? null;
    if (!original.current && target?.id !== holding.securityId) {
      setTarget({ id: holding.securityId, label: holding.security.symbol || holding.security.name, currency: holding.security.currency });
      setTerms({ price: "", date: "", validThrough: "" });
      setPhase("draft");
      setError(null);
    }
    setOpen(true);
  };
  const close = (next: boolean) => {
    if (current() && !claimed.current) setOpen(next);
  };
  const begin = (source: HTMLElement) => {
    if (!current()) return;
    trigger.current = source;
    setOpen(true);
  };
  const selectInstrument = (security: PriceInstrument) => {
    if (!current() || original.current || !z.string().uuid().safeParse(security.id).success || !/^[A-Z]{3}$/.test(security.currency)) return;
    setTarget({ id: security.id, label: security.symbol || security.name, currency: security.currency });
    setTerms({ price: "", date: "", validThrough: "" });
    setError(null);
    setPhase("draft");
  };
  const changeInstrument = () => {
    if (!current() || original.current || claimed.current) return;
    setTarget(null);
    setTerms({ price: "", date: "", validThrough: "" });
    setError(null);
  };
  const submit = async () => {
    if (!current() || claimed.current || !target) return;
    const nextTerms = { ...terms, price: terms.price.trim() };
    if (!original.current && !validTerms(nextTerms)) {
      setError("Enter an exact price and valid dates, with the end date on or after the effective date.");
      return;
    }
    const attempt = original.current ?? Object.freeze({ target: Object.freeze({ ...target }), terms: Object.freeze(nextTerms) });
    original.current = attempt;
    claimed.current = true;
    setPhase("pending");
    setError(null);
    try {
      const response = await apiRequest("PUT", `/api/investments/securities/${attempt.target.id}/price`, attempt.terms, operation);
      const value: unknown = await response.json();
      if (!current()) return;
      assertReceipt(value, attempt, operation.expectations?.household);
      original.current = null;
      setTarget(null);
      setOpen(false);
      setTerms({ price: "", date: "", validThrough: "" });
      setPhase("draft");
      for (const root of ["investments", "accounts", "goals"]) {
        void client.invalidateQueries({ queryKey: [root] });
      }
      toast({ title: "Household price recorded", description: `${attempt.target.label}: ${attempt.target.currency} ${attempt.terms.price}, valid through ${attempt.terms.validThrough}.` });
    } catch (failure) {
      if (!current()) return;
      const detail: Error & { status?: number } = failure instanceof Error
        ? failure
        : new Error("The price could not be confirmed.");
      const refused = [400, 401, 403, 404, 409, 422].includes(detail.status ?? 0);
      if (refused) original.current = null;
      setPhase(refused ? "draft" : "unknown");
      setError(detail.message || "The price could not be confirmed.");
    } finally {
      if (current()) claimed.current = false;
    }
  };
  const update = (key: keyof Terms, value: string) => {
    if (current() && !original.current) setTerms(previous => ({ ...previous, [key]: value }));
  };

  return <PriceControls.Provider value={{ canRecord: true, review, begin, recovery: phase === "unknown" && !open ? target?.label : undefined, resume: () => close(true) }}>
    {children}
    <Dialog open={open} onOpenChange={close}>
      <DialogContent onCloseAutoFocus={event => {
        if (trigger.current?.isConnected) {
          event.preventDefault();
          trigger.current.focus();
        }
      }}>
        <DialogHeader>
          <DialogTitle>Record household valuation price</DialogTitle>
          <DialogDescription>{target ? `This values your household's holdings in ${target.label}. It does not record a purchase or change units.` : "Choose the security whose household valuation price you want to record."}</DialogDescription>
        </DialogHeader>
        {open && !target && <HouseholdPriceInstrumentPicker onSelect={selectInstrument} />}
        {target && <form aria-label="Household valuation price" onSubmit={event => {
          event.preventDefault();
          void submit();
        }} className="space-y-4">
          <p className="text-sm text-muted-foreground">Choose both dates. They are inclusive. If they overlap an existing household price, you must resolve the dates before recording.</p>
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-price`}>Price per unit ({target?.currency})</Label>
            <Input id={`${fieldId}-price`} inputMode="decimal" value={terms.price} onChange={event => update("price", event.target.value)} disabled={phase !== "draft"} required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-from`}>Effective date</Label>
              <Input id={`${fieldId}-from`} type="date" min="0001-01-01" max="9999-12-31" value={terms.date} onChange={event => update("date", event.target.value)} disabled={phase !== "draft"} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-through`}>Valid through (inclusive)</Label>
              <Input id={`${fieldId}-through`} type="date" min={terms.date || "0001-01-01"} max="9999-12-31" value={terms.validThrough} onChange={event => update("validThrough", event.target.value)} disabled={phase !== "draft"} required />
            </div>
          </div>
          {error && <div role="alert" className="space-y-2 text-sm text-destructive">
            {phase === "unknown" && <p>Recording was not confirmed. Retry the original price. If it was already recorded, review the conflicting dates before changing anything.</p>}
            <p>{error}</p>
          </div>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={phase !== "draft"} onClick={changeInstrument}>Change security</Button>
            <Button type="button" variant="outline" disabled={phase === "pending"} onClick={() => close(false)}>Close for now</Button>
            <Button type="submit" disabled={phase === "pending"}>{phase === "pending" ? "Recording…" : phase === "unknown" ? "Retry original price" : "Record household price"}</Button>
          </DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
  </PriceControls.Provider>;
}

export function HouseholdPriceAction({ holding }: { holding: Holding }) {
  const controls = useContext(PriceControls);
  if (!controls.canRecord || !holding.security) return null;
  return <button type="button" aria-label={`Record household price for ${holding.security.symbol || holding.security.name}`} className="p-1.5 hover:bg-muted rounded text-xs font-medium text-primary" onClick={event => controls.review(holding, event.currentTarget)}>Price</button>;
}

export function HouseholdPriceTrigger() {
  const controls = useContext(PriceControls);
  if (!controls.canRecord) return null;
  return <Button type="button" variant="outline" onClick={event => controls.begin?.(event.currentTarget)}>Record household price</Button>;
}

export function HouseholdPriceRecovery() {
  const controls = useContext(PriceControls);
  if (!controls.recovery) return null;
  return <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-4">
    <p className="text-sm">The household price for {controls.recovery} was not confirmed.</p>
    <Button type="button" variant="outline" onClick={controls.resume}>Review unconfirmed price</Button>
  </div>;
}
