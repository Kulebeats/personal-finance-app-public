import {
  ChevronDown,
  Edit3,
  Download,
  Upload,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getCurrencySymbol } from "@/lib/format";
import { getAccountDisplayNumber } from "../../utils/accountValue";
import { TimeRangeSelector, type DateRange } from "@/components/accounts";
import { useToast } from "@/hooks/use-toast";
import { useExportTransactions, useExportBalanceHistory } from "@/hooks";
import { type Account } from "@/lib/api";
import { ReactNode } from "react";

interface AccountDetailHeaderProps {
  account: Account;
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  onEdit: () => void;
  onImportTransactions: () => void;
  onImportBalanceHistory: () => void;
  hasHistory: boolean;
  children?: ReactNode; // Chart goes here
}

export function AccountDetailHeader({
  account,
  dateRange,
  setDateRange,
  onEdit,
  onImportTransactions,
  onImportBalanceHistory,
  hasHistory,
  children,
}: AccountDetailHeaderProps) {
  const { toast } = useToast();
  const exportTransactions = useExportTransactions();
  const exportBalanceHistory = useExportBalanceHistory();

  const balance = getAccountDisplayNumber(account);
  const currencySymbol = getCurrencySymbol(account.currency || "ZMW");
  const isEstimatedValue =
    (account.type === "real_estate" || account.type === "vehicle") &&
    account.estimatedValue !== null &&
    account.estimatedValue !== undefined &&
    account.estimatedValue !== "";

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-6">
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-semibold text-foreground">
              {account.name}
            </h2>
            {account.institution && (
              <span className="text-sm text-muted-foreground">
                • {account.institution}
              </span>
            )}
          </div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
            {isEstimatedValue ? "Estimated Value" : "Current Balance"}
          </div>
          <div className="flex items-baseline gap-3">
            <h1 className="text-3xl font-bold text-foreground">
              {currencySymbol}
              {Math.abs(balance).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </h1>
          </div>
        </div>
        <div className="flex gap-2">
          {/* Edit Dropdown Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="default">
                Edit
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={onEdit}>
                <Edit3 className="mr-2 h-4 w-4" />
                Edit account
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => exportTransactions.mutate({ id: account.id })}
                disabled={exportTransactions.isPending}
              >
                <Download className="mr-2 h-4 w-4" />
                Download transactions
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onImportTransactions}>
                <Upload className="mr-2 h-4 w-4" />
                Import transactions
              </DropdownMenuItem>
              {/* TODO-042: "Transfer data" removed - implement when transfer flow is designed */}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  toast({
                    title: "Feature moved",
                    description:
                      "Please export balance history using the option below.",
                  });
                }}
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy balance history
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => exportBalanceHistory.mutate(account.id)}
                disabled={exportBalanceHistory.isPending}
              >
                <Download className="mr-2 h-4 w-4" />
                Download balance history
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onImportBalanceHistory}>
                <Upload className="mr-2 h-4 w-4" />
                Import balance history
              </DropdownMenuItem>
              {/* TODO-043: "Edit balance history" removed - implement when history editor is designed */}
            </DropdownMenuContent>
          </DropdownMenu>

          <TimeRangeSelector value={dateRange} onChange={setDateRange} />
        </div>
      </div>

      {children}
    </div>
  );
}
