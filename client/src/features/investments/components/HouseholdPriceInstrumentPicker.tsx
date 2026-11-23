import { useSecurities } from "@/hooks/investments/useSecurities";
import type { Security } from "@/hooks/investments/types";
import { Button } from "@/components/ui/button";

export type PriceInstrument = Pick<Security, "id" | "symbol" | "name" | "currency">;

/** Instrument metadata remains usable when a holding has no valuation yet. */
export function HouseholdPriceInstrumentPicker({ onSelect }: { onSelect: (security: PriceInstrument) => void }) {
  const query = useSecurities();
  return (
    <div className="space-y-3">
      {query.isLoading && <p role="status">Loading securities…</p>}
      {query.isError && (
        <div role="alert" className="space-y-2 text-sm">
          <p>Security lookup is unavailable. Retry before recording a price.</p>
          <Button type="button" variant="outline" onClick={() => { void query.refetch(); }}>
            Retry securities
          </Button>
        </div>
      )}
      {!query.isLoading && !query.isError && query.data?.length === 0 && (
        <p>No securities are available. Add the security before recording its price.</p>
      )}
      {!query.isError && (
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {query.data?.map(security => (
            <Button
              key={security.id}
              type="button"
              variant="outline"
              className="h-auto w-full justify-start whitespace-normal text-left"
              aria-label={`Choose ${security.symbol || security.name} (${security.currency})`}
              onClick={() => onSelect(security)}
            >
              <span>
                <span className="font-semibold">{security.symbol || security.name}</span>{" "}
                <span className="text-muted-foreground">({security.currency}) — {security.name}</span>
              </span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
