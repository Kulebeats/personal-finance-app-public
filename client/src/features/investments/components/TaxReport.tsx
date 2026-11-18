import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useTaxSummary } from "@/hooks/useInvestments";
import { useFormat } from "@/hooks/use-format";
import {
  Download,
  Calendar,
  Info,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  CreditCard,
  FileText,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function TaxReport() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data: summary, isLoading } = useTaxSummary(year);
  const { formatCurrency } = useFormat();
  // Server returns decimal strings (MoneyDto convention) for exact
  // regulatory precision; convert to a number only here, at the display
  // boundary, purely for formatting - no arithmetic is performed on it.
  const money = (value: string) => formatCurrency(Number(value));

  const handleExport = () => {
    window.open(
      `/api/investments/tax/zra-export?year=${year}&format=csv`,
      "_blank"
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  const taxYearSummary = summary ?? {
    year,
    realizedGains: "0.00",
    interestIncome: "0.00",
    dividendIncome: "0.00",
    grossIncome: "0.00",
    totalWht: "0.00",
    netIncome: "0.00",
    currency: "ZMW",
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Header & Controls */}
      <div className="relative overflow-hidden rounded-2xl bg-slate-900 text-white p-6 shadow-lg mb-4">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 rounded-full -mr-32 -mt-32 blur-3xl animate-pulse" />
        <div className="relative z-10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-black flex items-center gap-3 tracking-tight">
              <FileText className="h-6 w-6 text-primary" /> Investment Tax
              Report
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              Consolidated summary of income and withholding tax for legal
              compliance.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center bg-white/10 rounded-xl p-1 border border-white/20 backdrop-blur-sm">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white hover:bg-white/10"
                onClick={() => setYear((prev) => prev - 1)}
                aria-label="Previous year"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="px-4 font-bold text-sm min-w-[70px] text-center flex items-center justify-center gap-2">
                <Calendar className="h-4 w-4 text-primary" />
                {year}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white hover:bg-white/10"
                disabled={year >= new Date().getFullYear()}
                onClick={() => setYear((prev) => prev + 1)}
                aria-label="Next year"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <Button
              variant="default"
              size="sm"
              className="gap-2 bg-primary hover:bg-primary/90 shadow-xl"
              onClick={handleExport}
            >
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="glass-card border-l-4 border-l-primary overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <div className="h-1 w-4 bg-primary rounded-full" /> Gross Income
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black tracking-tight">
              {money(taxYearSummary.grossIncome)}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1.5 px-2 py-1 bg-emerald-50 rounded-full w-fit">
              <TrendingUp className="h-3 w-3 text-emerald-500" /> Pre-tax
              earnings
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-l-4 border-l-rose-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <div className="h-1 w-4 bg-rose-500 rounded-full" /> Total WHT
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black tracking-tight text-rose-500">
              {money(taxYearSummary.totalWht)}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 px-2 py-1 bg-rose-50 rounded-full w-fit">
              Standard 15% rate
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-l-4 border-l-emerald-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <div className="h-1 w-4 bg-emerald-50 rounded-full" /> Net Income
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black tracking-tight text-emerald-600">
              {money(taxYearSummary.netIncome)}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 px-2 py-1 bg-emerald-50 rounded-full w-fit">
              Available liquidity
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-l-4 border-l-amber-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <div className="h-1 w-4 bg-amber-500 rounded-full" /> Capital
              Gains
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black tracking-tight">
              {money(taxYearSummary.realizedGains)}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1.5 px-2 py-1 bg-amber-50 rounded-full w-fit">
              <Info className="h-3 w-3" /> Exemption threshold
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="text-lg font-black tracking-tight">
                Income Breakdown
              </CardTitle>
              <CardDescription className="text-xs uppercase font-bold text-muted-foreground/60">
                Detailed sources for the {year} period
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="space-y-6">
            <div className="group flex items-center justify-between p-4 rounded-2xl border border-transparent hover:border-primary/20 hover:bg-primary/5 transition-all duration-300">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-primary/10 rounded-2xl group-hover:scale-110 group-hover:bg-primary group-hover:text-white transition-all duration-500">
                  <TrendingUp className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-black uppercase tracking-tight">
                    Interest & Coupons
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Fixed Income securities history
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xl font-black tracking-tighter">
                  {money(taxYearSummary.interestIncome)}
                </p>
                <p className="text-[10px] uppercase font-black text-muted-foreground/50">
                  Gross Amount
                </p>
              </div>
            </div>

            <div className="group flex items-center justify-between p-4 rounded-2xl border border-transparent hover:border-purple-500/20 hover:bg-purple-500/5 transition-all duration-300">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-purple-500/10 rounded-2xl group-hover:scale-110 group-hover:bg-purple-500 group-hover:text-white transition-all duration-500">
                  <CreditCard className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-black uppercase tracking-tight">
                    Dividends
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Equity and fund distributions
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xl font-black tracking-tighter">
                  {money(taxYearSummary.dividendIncome)}
                </p>
                <p className="text-[10px] uppercase font-black text-muted-foreground/50">
                  Gross Amount
                </p>
              </div>
            </div>

            <div className="mt-8 pt-8 border-t-2 border-dashed flex justify-between items-center">
              <span className="text-sm font-black uppercase tracking-widest text-muted-foreground">
                Total Gross Income
              </span>
              <div className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-black text-lg shadow-2xl flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-primary animate-ping" />
                {money(taxYearSummary.grossIncome)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-lg border bg-muted/20 p-4 flex gap-4 items-start">
        <div className="mt-0.5">
          <Info className="h-5 w-5 text-blue-500" />
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-bold">ZRA Compliance Note</h4>
          <p className="text-xs text-muted-foreground leading-relaxed">
            In Zambia, Withholding Tax (WHT) of 15% is typically deducted at
            source for dividends and interest. The amounts shown above include
            the grossed-up income. Use the CSV export for your annual tax
            returns or to reconcile with the Zambia Revenue Authority.
          </p>
        </div>
      </div>
    </div>
  );
}
