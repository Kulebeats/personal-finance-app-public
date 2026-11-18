import React from "react";
import { SettingsCard } from "@/features/settings/components/SettingsCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Monitor,
  Smartphone,
  Tablet,
  Globe,
  LogOut,
  Clock,
} from "lucide-react";
import {
  useSessions,
  useRevokeSession,
  useRevokeAllOtherSessions,
} from "@/hooks/useSecurity";

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const getDeviceIcon = (deviceType: string | null) => {
  switch (deviceType?.toLowerCase()) {
    case "mobile":
      return <Smartphone className="h-5 w-5" />;
    case "tablet":
      return <Tablet className="h-5 w-5" />;
    default:
      return <Monitor className="h-5 w-5" />;
  }
};

export function SessionsCard() {
  const { data: sessions, isLoading } = useSessions();
  const revokeSession = useRevokeSession();
  const revokeAllOther = useRevokeAllOtherSessions();

  if (isLoading) {
    return (
      <SettingsCard
        title="Active Sessions"
        description="Manage your logged-in devices"
      >
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard
      title="Active Sessions"
      description="Manage your logged-in devices"
      action={
        sessions && sessions.length > 1 ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                <LogOut className="w-4 h-4 mr-2" />
                Revoke All Others
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Revoke all other sessions?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will log out all devices except the one you're currently
                  using.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => revokeAllOther.mutate()}
                  className="bg-destructive hover:bg-destructive/90"
                >
                  Revoke All
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null
      }
    >
      {!sessions || sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          No active sessions found.
        </p>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg"
            >
              <div className="text-muted-foreground">
                {getDeviceIcon(session.deviceType)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">
                  {session.browser || "Unknown Browser"} on{" "}
                  {session.os || "Unknown OS"}
                </p>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Globe className="w-3 h-3" />
                  <span>
                    {session.location || session.ipAddress || "Unknown location"}
                  </span>
                  <span>-</span>
                  <Clock className="w-3 h-3" />
                  <span>{formatDate(session.lastActiveAt)}</span>
                </div>
              </div>
              {session.isTrusted && (
                <Badge
                  variant="secondary"
                  className="bg-green-100 text-green-800"
                >
                  Current
                </Badge>
              )}
              {!session.isTrusted && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => revokeSession.mutate(session.id)}
                  disabled={revokeSession.isPending}
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </SettingsCard>
  );
}
