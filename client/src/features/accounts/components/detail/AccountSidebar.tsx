import { RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { type Account } from "@/lib/api";
import { formatCurrency } from "@/lib/money";
import { formatDisplayDate, parseDateWithFormat } from "@/lib/dates";

interface AccountSidebarProps {
  account: Account;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

// MED-002: Accept onRefresh prop to use React Query refetch instead of full page reload
export function AccountSidebar({
  account,
  onRefresh,
  isRefreshing,
}: AccountSidebarProps) {
  const isPropertyOrVehicle =
    account.type === "real_estate" || account.type === "vehicle";
  const showAddress = account.type === "real_estate";
  const formattedPurchaseDate = account.purchaseDate
    ? (() => {
        const parsed = parseDateWithFormat(account.purchaseDate, "yyyy-MM-dd");
        return parsed ? formatDisplayDate(parsed) : account.purchaseDate;
      })()
    : "";

  return (
    <div className="space-y-6">
      <Card className="p-5 shadow-sm border-border">
        <h3 className="font-semibold mb-4">Summary</h3>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between border-b border-border/40 pb-2">
            <span className="text-muted-foreground">Institution</span>
            <span className="text-foreground font-medium text-right">
              {account.institution || "Manual"}
            </span>
          </div>
          <div className="flex justify-between border-b border-border/40 pb-2">
            <span className="text-muted-foreground">Account Type</span>
            <span className="text-foreground text-right capitalize">
              {account.type}
            </span>
          </div>
          {account.subtype && (
            <div className="flex justify-between border-b border-border/40 pb-2">
              <span className="text-muted-foreground">Subtype</span>
              <span className="text-foreground text-right">
                {account.subtype}
              </span>
            </div>
          )}
          {isPropertyOrVehicle && account.estimatedValue && (
            <div className="flex justify-between border-b border-border/40 pb-2">
              <span className="text-muted-foreground">Estimated Value</span>
              <span className="text-foreground text-right">
                {formatCurrency(account.estimatedValue, account.currency)}
              </span>
            </div>
          )}
          {isPropertyOrVehicle && formattedPurchaseDate && (
            <div className="flex justify-between border-b border-border/40 pb-2">
              <span className="text-muted-foreground">Purchase Date</span>
              <span className="text-foreground text-right">
                {formattedPurchaseDate}
              </span>
            </div>
          )}
          {showAddress && account.address && (
            <div className="flex justify-between border-b border-border/40 pb-2">
              <span className="text-muted-foreground">Address</span>
              <span className="text-foreground text-right">
                {account.address}
              </span>
            </div>
          )}
          <div className="flex justify-between border-b border-border/40 pb-2">
            <span className="text-muted-foreground">Currency</span>
            <span className="text-foreground text-right">
              {account.currency}
            </span>
          </div>
          <div className="flex justify-between border-b border-border/40 pb-2">
            <span className="text-muted-foreground">Last Updated</span>
            <span className="text-foreground text-right">
              {account.updatedAt
                ? new Date(account.updatedAt).toLocaleDateString()
                : "Never"}
            </span>
          </div>
          <div className="flex justify-between pt-1">
            <span className="text-muted-foreground">Created</span>
            <span className="text-foreground text-right">
              {account.createdAt
                ? new Date(account.createdAt).toLocaleDateString()
                : "Unknown"}
            </span>
          </div>
        </div>
      </Card>

      <Card className="p-5 shadow-sm border-border">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold text-sm">Account Status</h3>
          <button
            type="button"
            aria-label="Refresh account status"
            className="p-1 rounded hover:bg-muted transition-colors disabled:opacity-50"
            onClick={onRefresh}
            disabled={isRefreshing || !onRefresh}
          >
            <RefreshCw
              className={cn(
                "w-4 h-4 text-muted-foreground hover:text-primary transition-colors",
                isRefreshing && "animate-spin"
              )}
            />
          </button>
        </div>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Visibility</span>
            <span className="text-foreground">
              {account.isHidden ? "Hidden" : "Visible"}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Status</span>
            <span
              className={cn(
                "font-medium",
                account.isArchived ? "text-amber-600" : "text-emerald-600",
              )}
            >
              {account.isArchived ? "Archived" : "Active"}
            </span>
          </div>
          {account.isPrivate && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Privacy</span>
              <span className="text-foreground">Private</span>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
