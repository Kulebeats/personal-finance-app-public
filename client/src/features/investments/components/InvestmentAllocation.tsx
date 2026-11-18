import { Card } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

interface AllocationItem {
  name: string;
  value: number;
  amount: number;
  color: string;
}

interface InvestmentAllocationProps {
  data: AllocationItem[];
  totalValue: number;
  displayCurrency: string;
  formatCurrency: (amount: number, currency: string) => string;
}

export function InvestmentAllocation({
  data,
  totalValue,
  displayCurrency,
  formatCurrency,
}: InvestmentAllocationProps) {
  return (
    <div className="grid grid-cols-2 gap-6">
      <Card className="p-6 shadow-sm border-border flex items-center justify-center">
        <div className="w-[300px] h-[300px] relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={80}
                outerRadius={110}
                paddingAngle={5}
                dataKey="value"
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex items-center justify-center flex-col pointer-events-none">
            <span className="text-sm font-medium text-muted-foreground">
              Total Assets
            </span>
            <span className="text-2xl font-bold text-foreground">
              {formatCurrency(totalValue, displayCurrency)}
            </span>
          </div>
        </div>
      </Card>
      <Card className="p-6 shadow-sm border-border">
        <h3 className="font-semibold mb-4">Asset Class Breakdown</h3>
        <div className="space-y-4">
          {data.length > 0 ? (
            data.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: item.color }}
                  ></div>
                  <span className="font-medium text-foreground">
                    {item.name}
                  </span>
                </div>
                <div className="text-right">
                  <div className="font-bold">{item.value}%</div>
                  <div className="text-xs text-muted-foreground">
                    {formatCurrency(item.amount, displayCurrency)}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground text-sm text-center py-4">
              Add holdings to see allocation
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
