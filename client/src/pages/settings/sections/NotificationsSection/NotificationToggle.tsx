import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { NotificationTypeLocal } from "@/features/settings/constants/notificationTypes";

/**
 * Preference data passed to toggle component
 * Can be full NotificationPreference from API or partial local state
 */
interface NotificationPreferenceData {
  notificationType: string;
  inAppEnabled?: boolean;
  emailEnabled?: boolean;
  pushEnabled?: boolean;
  thresholdAmount?: string | null;
}

interface NotificationToggleProps {
  notification: NotificationTypeLocal;
  preference?: NotificationPreferenceData;
  onToggle: (
    type: string,
    channel: "inAppEnabled" | "emailEnabled" | "pushEnabled",
    value: boolean
  ) => void;
  onThresholdChange: (type: string, value: string) => void;
}

export function NotificationToggle({
  notification,
  preference,
  onToggle,
  onThresholdChange,
}: NotificationToggleProps) {
  const inAppEnabled = preference?.inAppEnabled ?? true;
  const emailEnabled = preference?.emailEnabled ?? false;
  const pushEnabled = preference?.pushEnabled ?? false;
  const thresholdAmount = preference?.thresholdAmount ?? "";

  return (
    <div className="p-4 border border-border rounded-lg bg-card space-y-3">
      <div>
        <h4 className="text-sm font-medium">{notification.label}</h4>
        <p className="text-xs text-muted-foreground">
          {notification.description}
        </p>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Switch
            checked={inAppEnabled}
            onCheckedChange={(checked) =>
              onToggle(notification.type, "inAppEnabled", checked)
            }
            aria-label={`Enable ${notification.label} in-app notifications`}
          />
          <Label className="text-xs">In-App</Label>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            checked={emailEnabled}
            onCheckedChange={(checked) =>
              onToggle(notification.type, "emailEnabled", checked)
            }
            aria-label={`Enable ${notification.label} email notifications`}
          />
          <Label className="text-xs">Email</Label>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            checked={pushEnabled}
            onCheckedChange={(checked) =>
              onToggle(notification.type, "pushEnabled", checked)
            }
            aria-label={`Enable ${notification.label} push notifications`}
          />
          <Label className="text-xs">Push</Label>
        </div>
      </div>

      {notification.hasThreshold && (
        <div className="space-y-1.5">
          <Label className="text-xs">{notification.thresholdLabel}</Label>
          <Input
            type="number"
            value={thresholdAmount}
            onChange={(e) =>
              onThresholdChange(notification.type, e.target.value)
            }
            placeholder="Enter amount"
            className="max-w-xs"
            aria-label={`${notification.thresholdLabel} for ${notification.label}`}
          />
        </div>
      )}
    </div>
  );
}
