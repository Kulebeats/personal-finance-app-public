import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRecurringInvestments } from "@/hooks/useInvestments";
import { useRecurringPlanCommands } from "@/hooks/investments/useRecurringInvestments";
import { useFormat } from "@/hooks/use-format";
import {
  Repeat,
  Plus,
  Calendar,
  ArrowRightLeft,
  ChevronRight,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { toMoneyNumber } from "@/lib/money";
import { AddRecurringInvestmentForm } from "./AddRecurringInvestmentForm";
import { authorizationLabels, RecurringInvestmentDetails, RecurringPlanFeedback } from "./RecurringInvestmentDetails";

export function RecurringInvestmentSetup() {
  const { data: recurring, isLoading, isError, refetch } = useRecurringInvestments();
  const commands = useRecurringPlanCommands();
  const [showAdd, setShowAdd] = useState(false);
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);
  const detailOpen = recurring?.some(plan => plan.id === openPlanId);
  const { formatCurrency } = useFormat();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-40" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Repeat className="h-5 w-5 text-primary" /> Recurring Investments
          </h2>
          <p className="text-sm text-muted-foreground">
            Review recurring plans and their terms.
          </p>
        </div>

        {commands.allowed && <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" /> {commands.pending?.kind === "create" ? "Record plan (resume setup)" : "Record plan"}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Setup Recurring Investment</DialogTitle>
              <DialogDescription>
                Record a systematic investment plan or a pending rollover declaration.
              </DialogDescription>
            </DialogHeader>
            <AddRecurringInvestmentForm onSuccess={() => setShowAdd(false)} />
          </DialogContent>
        </Dialog>}
      </div>

      {isError && (
        <div role="alert" className="rounded-lg border p-4 space-y-2">
          <p>Recurring plans could not be refreshed. Try again to review the current records.</p>
          <Button variant="outline" onClick={() => void refetch()}>Retry</Button>
        </div>
      )}
      {!detailOpen && !showAdd && commands.pending?.kind !== "create" && (
        <RecurringPlanFeedback commands={commands} />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {recurring?.map((item) => (
          <Card key={item.id} className="relative overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    {item.type === "sip" ? (
                      <Zap className="h-4 w-4 text-blue-600" />
                    ) : (
                      <ArrowRightLeft className="h-4 w-4 text-orange-600" />
                    )}
                  </div>
                  <CardTitle className="text-base lowercase first-letter:uppercase">
                    {item.type} Plan
                  </CardTitle>
                </div>
                <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-bold">
                  {authorizationLabels[item.authorizationStatus] ?? "Authorization unavailable"}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                    Amount
                  </p>
                  <p className="text-lg font-bold">
                    {formatCurrency(toMoneyNumber(item.amount), item.currency)}
                  </p>
                </div>

                <div className="flex justify-between items-center text-sm">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>
                      Next:{" "}
                      {item.nextExecutionDate}
                    </span>
                  </div>
                  <div className="font-medium text-xs bg-muted px-2 py-0.5 rounded lowercase">
                    {item.frequency}
                  </div>
                </div>

                <div className="pt-2 border-t flex justify-between items-center">
                  <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                    Custody: {item.accountName || "Selected Account"}
                  </span>
                  <Dialog open={openPlanId === item.id} onOpenChange={open => setOpenPlanId(open ? item.id : null)}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 text-xs px-2">
                        Details <ChevronRight className="h-3 w-3 ml-1" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent onOpenAutoFocus={event => {
                      const title = event.target instanceof HTMLElement
                        ? event.target.querySelector<HTMLElement>("[data-recurring-plan-title]")
                        : null;
                      if (title) {
                        event.preventDefault();
                        title.focus();
                      }
                    }}>
                      <RecurringInvestmentDetails plan={item} commands={commands} readFailed={isError} refresh={() => void refetch()} />
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {!isError && (!recurring || recurring.length === 0) && (
          <Card className="md:col-span-2 lg:col-span-3 border-dashed bg-muted/20">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <div className="p-4 bg-background rounded-full mb-4 shadow-sm">
                <Repeat className="h-8 w-8 text-muted-foreground opacity-50" />
              </div>
              <h3 className="font-bold text-lg">No recurring plans</h3>
              <p className="text-sm text-muted-foreground max-w-sm mt-1">
                Record a recurring plan and review its authorization and terms.
              </p>
              {commands.allowed && <Button
                variant="outline"
                className="mt-6"
                onClick={() => setShowAdd(true)}
              >
                Get Started
              </Button>}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-100 flex gap-4 items-start">
        <div className="mt-0.5">
          <ShieldCheck className="h-5 w-5 text-emerald-600" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-emerald-900">
            Record-only investment plans
          </h4>
          <p className="text-xs text-emerald-800/80 leading-relaxed mt-0.5">
            Scheduled purchases stay pending until an authorized user confirms each
            actual fill from the final broker statement. This records purchases without placing orders or moving cash. Rollover
            declarations remain pending while execution terms are unresolved.
          </p>
        </div>
      </div>
    </div>
  );
}
