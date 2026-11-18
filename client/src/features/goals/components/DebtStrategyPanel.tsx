import { format } from "date-fns";

function formatDateHelper(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

type StrategyRow = {
  id: string;
  order: number;
  name: string;
  balance: number | null;
  payoffDate: string | null;
};

export function DebtStrategyPanel({
  title,
  rows,
  formatCurrency,
}: {
  title: string;
  rows: StrategyRow[];
  formatCurrency: (amount: number) => string;
}) {
  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="text-sm font-medium text-foreground">{title}</div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Run the strategy to see the payoff order.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-muted-foreground">#{row.order}</span>
                <span className="font-medium truncate">{row.name}</span>
                {row.balance !== null ? (
                  <span className="text-muted-foreground">
                    ({formatCurrency(row.balance)})
                  </span>
                ) : null}
              </div>
              <span className="text-muted-foreground">
                {row.payoffDate ? formatDateHelper(row.payoffDate) : "N/A"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
