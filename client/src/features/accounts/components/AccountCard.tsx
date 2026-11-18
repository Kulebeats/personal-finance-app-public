import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { BankLogo } from "@/components/BankLogo";
import { getCurrencySymbol } from "@/lib/format";
import { getAccountDisplayNumber } from "../utils/accountValue";
import type { Account } from "@/lib/api";

interface AccountCardProps {
  account: Account;
}

export function AccountCard({ account }: AccountCardProps) {
  const balance = getAccountDisplayNumber(account);
  const isNegative = balance < 0;
  const accountCurrency = account.currency || "ZMW";
  const currencySymbol = getCurrencySymbol(accountCurrency);
  const isNonDefaultCurrency = accountCurrency !== "ZMW";
  const displayBalance = Math.abs(balance).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <Link href={`/accounts/${account.id}`}>
      <div className="flex items-center justify-between p-4 bg-card border border-border rounded-lg hover:shadow-sm hover:border-primary/20 transition-all cursor-pointer mb-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
        <div className="flex items-center gap-4">
          <BankLogo
            institution={account.institution || account.name}
            size="lg"
          />
          <div>
            <div className="font-bold text-foreground text-sm flex items-center gap-2">
              {account.name}
              {isNonDefaultCurrency && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {accountCurrency}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {account.institution || "Manual"} • {account.type}
            </div>
          </div>
        </div>

        <div className="text-right">
          <div
            className={cn(
              "font-bold",
              isNegative ? "text-rose-600 dark:text-rose-400" : "text-foreground",
            )}
          >
            {isNegative && "-"}
            {currencySymbol}
            {displayBalance}
          </div>
          <div className="text-xs text-muted-foreground">
            {account.updatedAt
              ? new Date(account.updatedAt).toLocaleDateString()
              : "Just now"}
          </div>
        </div>
      </div>
    </Link>
  );
}
