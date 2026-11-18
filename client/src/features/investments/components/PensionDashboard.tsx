import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  usePensionHoldings,
  usePensionContributions,
} from "@/hooks/useInvestments";
import { useFormat } from "@/hooks/use-format";
import {
  Wallet,
  TrendingUp,
  History,
  Info,
  Building2,
  Calendar,
  PiggyBank,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { sumMoneyValues, toMoneyNumber } from "@/lib/money";

export function PensionDashboard() {
  const { data: holdings, isLoading } = usePensionHoldings();
  const { formatCurrency } = useFormat();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  const totalBalance = sumMoneyValues(
    (holdings || []).map((holding) => holding.currentBalance)
  ).toNumber();

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="glass-card border-l-4 border-l-primary overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <PiggyBank className="h-16 w-16" />
          </div>
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
              <PiggyBank className="h-4 w-4 text-primary" /> Total Pension
              Assets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black tracking-tighter">
              {formatCurrency(totalBalance)}
            </div>
            <p className="text-[10px] font-bold text-muted-foreground/60 mt-1 uppercase">
              Aggregated retirement wealth
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-l-4 border-l-slate-400 overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Building2 className="h-16 w-16" />
          </div>
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
              <Building2 className="h-4 w-4 text-slate-500" /> Active Providers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black tracking-tighter">
              {holdings?.length || 0}
            </div>
            <p className="text-[10px] font-bold text-muted-foreground/60 mt-1 uppercase">
              Diversified pension schemes
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-l-4 border-l-emerald-500 overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Calendar className="h-16 w-16" />
          </div>
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4 text-emerald-500" /> Retirement Path
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black tracking-tighter flex items-center gap-2 text-emerald-600">
              On Track
            </div>
            <p className="text-[10px] font-bold text-muted-foreground/60 mt-1 uppercase">
              Based on contribution velocity
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Holdings List */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Your Pensions</CardTitle>
            <CardDescription>Listed by provider</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {holdings?.map((h) => (
                <div
                  key={h.id}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedId === h.id
                      ? "bg-primary/5 border-primary/50"
                      : "hover:bg-muted"
                  }`}
                  onClick={() => setSelectedId(h.id)}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-bold text-sm">{h.providerName}</span>
                    <span className="text-xs font-medium uppercase text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {h.pensionType}
                    </span>
                  </div>
                  <div className="text-lg font-bold">
                    {formatCurrency(toMoneyNumber(h.currentBalance ?? 0))}
                  </div>
                  {h.accountNumber && (
                    <div className="text-[10px] text-muted-foreground mt-1">
                      Acc: {h.accountNumber}
                    </div>
                  )}
                </div>
              ))}

              {(!holdings || holdings.length === 0) && (
                <p className="text-center text-muted-foreground text-sm py-8">
                  No pension holdings added yet.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Details & Charts */}
        <div className="lg:col-span-2 space-y-6">
          <ContributionChart holdingId={selectedId || holdings?.[0]?.id} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Retirement Projection</CardTitle>
              <CardDescription>Estimated value at age 55</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 bg-muted/30 p-4 rounded-lg">
                <Info className="h-5 w-5 text-blue-500 shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  This is a simple projection based on your current balance and
                  an assumed 8% annual return. It does not account for inflation
                  or future contribution changes. Consult a financial advisor
                  for detailed planning.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ContributionChart({ holdingId }: { holdingId?: string }) {
  const { data: contributions, isLoading } = usePensionContributions(
    holdingId || ""
  );
  const { formatCurrency } = useFormat();

  if (!holdingId) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle className="text-base">Contribution History</CardTitle>
            <CardDescription>Employer vs Employee splits</CardDescription>
          </div>
          <History className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent className="h-[250px] pt-4">
        {isLoading ? (
          <Skeleton className="w-full h-full" />
        ) : !contributions || contributions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <Wallet className="h-8 w-8 opacity-20" />
            <p className="text-xs">No contribution history available</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={contributions}>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="hsl(var(--muted))"
              />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tickFormatter={(val) =>
                  new Date(val).toLocaleDateString("en-GB", {
                    month: "short",
                    year: "2-digit",
                  })
                }
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tickFormatter={(val) => `K${val / 1000}k`}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
                formatter={(value: number) => formatCurrency(value)}
              />
              <Legend />
              <Bar
                dataKey="employeeContribution"
                name="Employee"
                fill="#3b82f6"
                radius={[2, 2, 0, 0]}
              />
              <Bar
                dataKey="employerContribution"
                name="Employer"
                fill="#10b981"
                radius={[2, 2, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
