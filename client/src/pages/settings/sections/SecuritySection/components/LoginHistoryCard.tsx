import React from "react";
import { SettingsCard } from "@/features/settings/components/SettingsCard";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle, AlertCircle } from "lucide-react";
import { useLoginHistory } from "@/hooks/useSecurity";

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function LoginHistoryCard() {
  const { data: history, isLoading } = useLoginHistory();

  if (isLoading) {
    return (
      <SettingsCard title="Login History" description="Recent login attempts">
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard
      title="Login History"
      description="Recent login attempts to your account"
    >
      {!history || history.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          No login history found.
        </p>
      ) : (
        <div className="space-y-2">
          {history.slice(0, 10).map((entry) => (
            <div
              key={entry.id}
              className={`flex items-center gap-3 p-3 rounded-lg ${
                entry.success ? "bg-muted/50" : "bg-destructive/10"
              }`}
            >
              {entry.success ? (
                <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  {entry.success ? "Successful login" : "Failed login attempt"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {entry.location || entry.ipAddress || "Unknown location"} -{" "}
                  {formatDate(entry.loginTime)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </SettingsCard>
  );
}
