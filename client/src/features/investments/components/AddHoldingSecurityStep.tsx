import { Loader2, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SecurityItem = {
  id: string;
  symbol: string;
  name: string;
  currentPrice?: string | null;
  exchange?: string | null;
};

type AddHoldingSecurityStepProps = {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  securities: SecurityItem[];
  loadingSecurities: boolean;
  formatCurrency: (value: number) => string;
  onSelectSecurity: (securityId: string) => void;
  onCreateNew: () => void;
};

export function AddHoldingSecurityStep({
  searchQuery,
  onSearchQueryChange,
  securities,
  loadingSecurities,
  formatCurrency,
  onSelectSecurity,
  onCreateNew,
}: AddHoldingSecurityStepProps) {
  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search securities (e.g. ZCCM, ZANACO, GRZ Bond)"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          className="pl-10"
        />
      </div>

      <div className="max-h-[300px] overflow-y-auto space-y-2">
        {loadingSecurities ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : securities.length > 0 ? (
          securities.map((security) => (
            <button
              key={security.id}
              onClick={() => onSelectSecurity(security.id)}
              className={cn(
                "w-full flex items-center justify-between p-3 rounded-lg border transition-colors text-left",
                "hover:bg-muted/50 hover:border-primary/50"
              )}
            >
              <div>
                <div className="font-semibold">{security.symbol}</div>
                <div className="text-sm text-muted-foreground">
                  {security.name}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium">
                  {security.currentPrice
                    ? formatCurrency(Number(security.currentPrice))
                    : "N/A"}
                </div>
                <div className="text-xs text-muted-foreground uppercase">
                  {security.exchange}
                </div>
              </div>
            </button>
          ))
        ) : searchQuery ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No securities found for "{searchQuery}"</p>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <p>Search for a security or create a new one</p>
          </div>
        )}
      </div>

      <Button variant="outline" className="w-full" onClick={onCreateNew}>
        <Plus className="w-4 h-4 mr-2" />
        Add New Security
      </Button>
    </div>
  );
}
