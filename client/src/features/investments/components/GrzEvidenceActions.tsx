import { useState } from "react";
import { useSession } from "@/contexts/SessionContext";
import { Button } from "@/components/ui/button";
import type { GrzBond } from "@/hooks/useGrzSecurities";
import { holdingEvidenceKey, type EvidenceKind } from "../grzEvidenceContract";
import { useGrzEvidenceRecord } from "../hooks/useGrzEvidenceRecord";
import { GrzEvidenceDialog } from "./GrzEvidenceDialog";

function WriterActions({ bond }: { bond: GrzBond }) {
  const controller = useGrzEvidenceRecord(bond);
  const [open, setOpen] = useState<{ kind: EvidenceKind; trigger: HTMLButtonElement } | null>(null);
  return <>
    {(["acquisition", "market"] as const).map(kind => <Button key={kind} type="button" variant="outline" size="sm"
      aria-label={`Record ${kind} evidence for ${bond.bondName}`} disabled={!!controller.request && controller.request.kind !== kind}
      onClick={event => { controller.begin(); setOpen({ kind, trigger: event.currentTarget }); }}>Record {kind} evidence</Button>)}
    {open && <GrzEvidenceDialog key={open.kind} bond={bond} kind={open.kind} trigger={open.trigger} controller={controller} close={() => setOpen(null)} />}
  </>;
}
function AuthorizedActions({ bond }: { bond: GrzBond }) {
  const { status, lifetime } = useSession(), operation = lifetime?.operation;
  if (status?.state !== "ready" || !lifetime || !operation?.active || !["owner", "admin", "member"].includes(status.household.role) ||
    operation.expectations?.subject !== status.subject.id || operation.expectations.household !== status.household.id) return null;
  // Withdraw the complete draft/controller synchronously on identity, grant or
  // holding reassignment; a late result can never repopulate another lifetime.
  return <WriterActions key={JSON.stringify([lifetime.key, holdingEvidenceKey(bond)])} bond={bond} />;
}
export function GrzEvidenceActions({ bond }: { bond: GrzBond }) {
  if (bond.status !== "active") return null;
  if (!bond.accountId || !bond.isin) return <span className="text-xs text-muted-foreground">Evidence requires a custody account and ISIN.</span>;
  return <AuthorizedActions bond={bond} />;
}
