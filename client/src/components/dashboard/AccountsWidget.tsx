import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAccounts } from "@/hooks/use-finance-data";
import { Link, useLocation } from "wouter";
import { BankLogo } from "@/components/BankLogo";
import { formatCurrency as formatWithCurrency } from "@/lib/format";
import { Loader2 } from "lucide-react";
import { WidgetErrorState } from "./WidgetErrorState";

export default function AccountsWidget() {
  const { accounts, loading, error, refresh } = useAccounts();
  const [, setLocation] = useLocation();

  const navigateToAccount = (accountId: string) => {
    setLocation(`/accounts/${accountId}`);
  };

  const handleRowKeyDown = (
    event: React.KeyboardEvent,
    accountId: string
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      navigateToAccount(accountId);
    }
  };

  if (loading) {
    return (
      <Card className="col-span-1 shadow-sm border-border/50 bg-card h-full flex flex-col justify-center items-center p-6">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (error) {
    return (
      <WidgetErrorState
        title="Unable to load accounts"
        message="We couldn't fetch your account list."
        onRetry={() => refresh()}
        className="h-full shadow-sm border-border/50"
      />
    );
  }

  return (
    <Card className="col-span-1 shadow-sm border-border/50 bg-card hover:shadow-md transition-shadow duration-300 h-full">
        <CardHeader className="pb-4 border-b border-border/40">
            <CardTitle className="text-base font-semibold text-foreground">Accounts</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
            {accounts.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                No accounts yet. Add your first account!
              </div>
            ) : (
            <div className="divide-y divide-border/40">
                {accounts.slice(0, 5).map((acc) => {
                    const isCredit = acc.type === 'credit';
                    const accountCurrency = acc.currency || "ZMW";
                    const displayBalance = formatWithCurrency(
                      isCredit ? -acc.balance : acc.balance,
                      accountCurrency
                    );
                    return (
                    <button
                        key={acc.id}
                        type="button"
                        aria-label={`View ${acc.name} account details`}
                        onClick={() => navigateToAccount(acc.id)}
                        onKeyDown={(e) => handleRowKeyDown(e, acc.id)}
                        className="block w-full text-left p-4 hover:bg-muted/30 transition-colors cursor-pointer group focus:outline-none focus:ring-2 focus:ring-primary focus:ring-inset"
                    >
                        <div className="flex items-start justify-between mb-1">
                            <div className="flex items-center gap-3">
                                <BankLogo
                                  institution={acc.institution || acc.name}
                                  size="md"
                                />
                                <div>
                                    <div className="font-medium text-sm text-foreground">{acc.name}</div>
                                    <div className="text-xs text-muted-foreground capitalize">{acc.type}</div>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className={cn(
                                    "font-semibold text-sm",
                                    isCredit ? "text-foreground" : "text-emerald-600 dark:text-emerald-400"
                                )}>
                                    {displayBalance}
                                </div>
                            </div>
                        </div>
                    </button>
                )})}
            </div>
            )}
            <div className="p-3 bg-muted/20 text-center border-t border-border/40">
                <Link href="/accounts">
                    <span className="text-xs font-medium text-primary hover:underline cursor-pointer">View all accounts</span>
                </Link>
            </div>
        </CardContent>
    </Card>
  );
}
