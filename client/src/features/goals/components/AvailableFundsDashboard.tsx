import { Card } from "@/components/ui/card";
import { useAvailableFunds } from "@/hooks/useGoals";
import { useFormatters } from "@/contexts/SettingsContext";
import { PiggyBank } from "lucide-react";
import { parseMoney } from "@/lib/utils";

export function AvailableFundsDashboard() {
  const { formatCurrency } = useFormatters();
  const { data = [], isLoading } = useAvailableFunds();

  const totals = data.reduce(
    (acc, row) => {
      acc.balance += parseMoney(row.balance);
      acc.assigned += parseMoney(row.assignedAmount);
      acc.available += parseMoney(row.availableAmount);
      return acc;
    },
    { balance: 0, assigned: 0, available: 0 }
  );

  return (
    <Card className="p-5 space-y-4">
      <div className="flex flex-col gap-1">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            Available funds
          </h3>
          <p className="text-xs text-muted-foreground">
            Funds ready to allocate to your goals.
          </p>
        </div>
        <div className="mt-2">
          <div className="text-3xl font-bold tracking-tight text-foreground">
            {formatCurrency(totals.available)}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
            <PiggyBank className="h-3 w-3" />
            <span>Total available across all accounts</span>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <div className="h-4 w-40 bg-muted rounded animate-pulse" />
          <div className="h-4 w-56 bg-muted rounded animate-pulse" />
          <div className="h-4 w-48 bg-muted rounded animate-pulse" />
        </div>
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No account balances available yet.
        </p>
      ) : (
        <div className="grid gap-3">
          {data.map((row) => {
            const balance = parseMoney(row.balance);
            const assigned = parseMoney(row.assignedAmount);
            const available = parseMoney(row.availableAmount);

            return (
              <div
                key={row.accountId}
                className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {row.accountName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Balance: {formatCurrency(balance)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">
                    Assigned {formatCurrency(assigned)}
                  </div>
                  <div className="text-sm font-semibold text-foreground">
                    {formatCurrency(available)} available
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
