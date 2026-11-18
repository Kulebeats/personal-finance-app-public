import { useState, useEffect } from "react";
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

/**
 * Local state type for notification preferences
 * Uses partial fields since user may not have set all preferences yet
 */
interface LocalNotificationPreference {
  notificationType: string;
  inAppEnabled?: boolean;
  emailEnabled?: boolean;
  pushEnabled?: boolean;
  thresholdAmount?: string | null;
}

type PreferencesMap = Record<string, NotificationPreference | LocalNotificationPreference>;

export function NotificationsForm() {
  const { data: preferences, isLoading, isError, error, refetch } = useNotificationPreferences();
  const updatePreferences = useUpdateNotificationPreferences();
  const [localPreferences, setLocalPreferences] = useState<PreferencesMap>({});

  useEffect(() => {
    if (preferences) {
      const prefsMap: PreferencesMap = {};
      preferences.forEach((pref) => {
        prefsMap[pref.notificationType] = pref;
      });
      setLocalPreferences(prefsMap);
    }
  }, [preferences]);

  const handleToggle = (
    notificationType: string,
    channel: "inAppEnabled" | "emailEnabled" | "pushEnabled",
    value: boolean
  ) => {
    setLocalPreferences((prev) => ({
      ...prev,
      [notificationType]: {
        ...prev[notificationType],
        notificationType,
        [channel]: value,
      },
    }));
  };

  const handleThresholdChange = (notificationType: string, value: string) => {
    setLocalPreferences((prev) => ({
      ...prev,
      [notificationType]: {
        ...prev[notificationType],
        notificationType,
        thresholdAmount: value,
      },
    }));
  };

  const handleSave = () => {
    const prefsArray = Object.values(localPreferences).map((pref) => ({
      notificationType: pref.notificationType,
      inAppEnabled: pref.inAppEnabled ?? true,
      emailEnabled: pref.emailEnabled ?? false,
      pushEnabled: pref.pushEnabled ?? false,
      thresholdAmount: pref.thresholdAmount || null,
    }));

    updatePreferences.mutate({ preferences: prefsArray });
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
                  preference={localPreferences[notification.type]}
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
