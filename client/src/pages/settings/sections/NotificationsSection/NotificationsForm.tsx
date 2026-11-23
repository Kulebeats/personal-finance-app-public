import { useState } from "react";
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  type NotificationPreference,
} from "@/hooks/use-settings";
import { SettingsCard } from "@/features/settings/components/SettingsCard";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { NOTIFICATION_CATEGORIES_LEGACY as NOTIFICATION_CATEGORIES } from "@/features/settings/constants/notificationTypes";
import { NotificationToggle } from "./NotificationToggle";
import { captureOperationLifetime } from "@/lib/operation-lifetime";

type Draft = Partial<Pick<NotificationPreference, "inAppEnabled" | "emailEnabled" | "pushEnabled" | "thresholdAmount">>;
type Drafts = Record<string, Draft>;

const defaultPreference: Required<Draft> = {
  inAppEnabled: true,
  emailEnabled: false,
  pushEnabled: false,
  thresholdAmount: null,
};

export function NotificationsForm() {
  const { data: preferences, isLoading, isError, error, refetch } = useNotificationPreferences();
  const updatePreferences = useUpdateNotificationPreferences();
  const [drafts, setDrafts] = useState<Drafts>({});
  const byType = new Map(preferences?.map(pref => [pref.notificationType, pref]));

  const handleToggle = (
    notificationType: string,
    channel: "inAppEnabled" | "emailEnabled" | "pushEnabled",
    value: boolean
  ) => {
    setDrafts(prev => ({
      ...prev,
      [notificationType]: { ...prev[notificationType], [channel]: value },
    }));
  };

  const handleThresholdChange = (notificationType: string, value: string) => {
    setDrafts(prev => ({
      ...prev,
      [notificationType]: { ...prev[notificationType], thresholdAmount: value === "" ? null : value },
    }));
  };

  const handleSave = async () => {
    if (updatePreferences.isPending) return;
    const changed = Object.entries(drafts).flatMap(([notificationType, draft]) => {
      const baseline = byType.get(notificationType) ?? defaultPreference;
      const fields = Object.fromEntries(
        (Object.keys(draft) as Array<keyof Draft>)
          .filter(field => draft[field] !== baseline[field])
          .map(field => [field, draft[field]]),
      ) as Draft;
      return Object.keys(fields).length ? [{ notificationType, ...fields }] : [];
    });
    if (!changed.length) return;

    const operation = captureOperationLifetime();
    try {
      await updatePreferences.mutateAsync({ preferences: changed });
      if (captureOperationLifetime() !== operation) return;
      setDrafts(current => {
        const remaining: Drafts = {};
        for (const [notificationType, draft] of Object.entries(current)) {
          const saved = changed.find(pref => pref.notificationType === notificationType);
          const fields = { ...draft };
          if (saved) {
            for (const field of Object.keys(saved) as Array<keyof Draft | "notificationType">) {
              if (field === "notificationType") continue;
              if (fields[field] === saved[field]) delete fields[field];
            }
          }
          if (Object.keys(fields).length) remaining[notificationType] = fields;
        }
        return remaining;
      });
    } catch {
      // The query client reports the failure. Keep the draft for retry.
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading notification preferences</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-4">
        <p className="text-sm text-destructive">
          Failed to load notification preferences
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <SettingsCard
      title="Notification Preferences"
      description="Choose how you want to be notified"
    >
      <div className="space-y-6">
        {NOTIFICATION_CATEGORIES.map((category) => (
          <div key={category.category} className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase">
              {category.category}
            </h3>
            <div className="space-y-3">
              {category.notifications.map((notification) => (
                <NotificationToggle
                  key={notification.type}
                  notification={notification}
                  preference={{ ...byType.get(notification.type), ...drafts[notification.type], notificationType: notification.type }}
                  onToggle={handleToggle}
                  onThresholdChange={handleThresholdChange}
                />
              ))}
            </div>
          </div>
        ))}

        <div className="pt-4">
          <Button
            onClick={handleSave}
            className="w-full bg-rose-400 hover:bg-rose-500 text-white font-medium h-10"
            disabled={updatePreferences.isPending}
            aria-label="Save notification preferences"
          >
            {updatePreferences.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Preferences"
            )}
          </Button>
        </div>
      </div>
    </SettingsCard>
  );
}
