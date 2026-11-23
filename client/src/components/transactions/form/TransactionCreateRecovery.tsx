import { Button } from "@/components/ui/button";

export interface OrdinaryCreateRecovery {
  pending: boolean;
  canRetryOriginal: boolean;
  followupsUnavailable: boolean;
  error: string | null;
  retry: () => void;
  startAnother: () => void;
}
export function TransactionCreateRecovery({ recovery, busy }: { recovery: OrdinaryCreateRecovery; busy: boolean }) {
  if (!recovery.pending && !recovery.error) return null;
  return <section className="space-y-2 rounded-md border p-3" aria-label="Transaction submission recovery">
    <p role="status">{recovery.pending ? "An earlier submission is unresolved. It may already have completed. Retry safely, or start another transaction."
      : recovery.error}</p>
    {recovery.error && recovery.pending && !recovery.error.startsWith("An earlier submission is unresolved") && <p role="alert">{recovery.error}</p>}
    {recovery.pending && <p>{recovery.followupsUnavailable ? "Original follow-up selections are unavailable after the session changed. Recover the transaction, then open its details to finish tags, attachments or receipts."
      : "Retry uses the original tags, files and receipt selection. Start another transaction to use replacements."}</p>}
    {recovery.pending && <div className="flex gap-2">
      {recovery.canRetryOriginal && <Button type="button" disabled={busy} onClick={recovery.retry}>Retry original transaction</Button>}
      <Button type="button" variant="outline" disabled={busy} onClick={recovery.startAnother}>Start another transaction</Button>
    </div>}
  </section>;
}
