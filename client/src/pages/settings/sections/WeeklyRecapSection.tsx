import { userErrorMessage } from "@/lib/errorCopy";
import { throwIfResNotOk } from "@/lib/queryClient";
import { protectedFetch } from "@/lib/protected-fetch";
import { useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Calendar, Mail, Target, Receipt } from "lucide-react";
import { apiCall } from "@/lib/api";

interface WeeklyRecapSettings {
  enabled: boolean;
  emailEnabled: boolean;
  dayOfWeek: number;
  includeGoals: boolean;
  includeRecurring: boolean;
}

type RecapDrafts = {
  [K in keyof WeeklyRecapSettings]?: { value: WeeklyRecapSettings[K]; revision: number };
};
const SETTINGS_KEY = ["weekly-recap-settings"];
const SETTING_FIELDS = ["enabled", "emailEnabled", "dayOfWeek", "includeGoals", "includeRecurring"] as const;

function settingsFromResponse(result: unknown): WeeklyRecapSettings {
  const invalid = "Invalid weekly recap settings response. Please try again.";
  if (typeof result !== "object" || result === null ||
    !("success" in result) || result.success !== true || !("data" in result)) throw new Error(invalid);
  const data = result.data;
  if (typeof data !== "object" || data === null ||
    !("enabled" in data) || typeof data.enabled !== "boolean" ||
    !("emailEnabled" in data) || typeof data.emailEnabled !== "boolean" ||
    !("includeGoals" in data) || typeof data.includeGoals !== "boolean" ||
    !("includeRecurring" in data) || typeof data.includeRecurring !== "boolean" ||
    !("dayOfWeek" in data) || typeof data.dayOfWeek !== "number" ||
    !Number.isInteger(data.dayOfWeek) || data.dayOfWeek < 0 || data.dayOfWeek > 6) throw new Error(invalid);
  return {
    enabled: data.enabled, emailEnabled: data.emailEnabled, dayOfWeek: data.dayOfWeek,
    includeGoals: data.includeGoals, includeRecurring: data.includeRecurring,
  };
}

// Exported for tests: goes through apiCall so the PATCH carries x-csrf-token
// (raw fetch 403s in a real browser session).
export async function updateWeeklyRecapSettings(
  data: Partial<WeeklyRecapSettings>,
): Promise<WeeklyRecapSettings> {
  const result = await apiCall<{ success: boolean; data: WeeklyRecapSettings }>(
    "/weekly-recap/settings",
    { method: "PATCH", body: JSON.stringify(data) },
  );
  const saved = settingsFromResponse(result);
  if (SETTING_FIELDS.some(field => data[field] !== undefined && data[field] !== saved[field])) {
    throw new Error("Invalid weekly recap settings response. Please try again.");
  }
  return saved;
}

const DAY_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

export default function WeeklyRecapSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, error: loadError, refetch } = useQuery<WeeklyRecapSettings>({
    queryKey: SETTINGS_KEY,
    queryFn: async ({ signal }) => {
      const response = await protectedFetch("/api/weekly-recap/settings", {
        credentials: "include", signal,
      });
      await throwIfResNotOk(response);

      const result = await response.json();
      return settingsFromResponse(result);
    },
  });

  const [drafts, setDrafts] = useState<RecapDrafts>({});
  const revision = useRef(0);
  const edit = <K extends keyof WeeklyRecapSettings>(field: K, value: WeeklyRecapSettings[K]) => {
    const changed = { value, revision: ++revision.current };
    // Keep reverts too: an in-flight save may still persist the previous edit.
    setDrafts(current => ({ ...current, [field]: changed }));
  };

  const updateMutation = useMutation({
    mutationFn: ({ patch }: { patch: Partial<WeeklyRecapSettings>; submitted: RecapDrafts }) => updateWeeklyRecapSettings(patch),
    onSuccess: (saved, { patch, submitted }) => {
      queryClient.setQueryData(SETTINGS_KEY, saved);
      setDrafts(current => {
        const remaining = { ...current };
        for (const field of SETTING_FIELDS) {
          if (field in patch && current[field]?.revision === submitted[field]?.revision) delete remaining[field];
        }
        return remaining;
      });
      toast({
        title: "Settings updated",
        description: "Your submitted weekly recap preferences have been saved.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: userErrorMessage(error, "Failed to update settings. Please try again."),
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!settings || updateMutation.isPending) return;
    const patch: Partial<WeeklyRecapSettings> = {};
    const addChanged = <K extends keyof WeeklyRecapSettings>(field: K) => {
      const draft = drafts[field];
      if (draft && draft.value !== settings[field]) patch[field] = draft.value;
    };
    SETTING_FIELDS.forEach(addChanged);
    if (Object.keys(patch).length) updateMutation.mutate({ patch, submitted: drafts });
  };

  if (!settings) {
    if (loadError) return (
      <div className="space-y-4">
        <p role="alert">Unable to load weekly recap preferences: {loadError.message}</p>
        <Button onClick={() => { void refetch(); }}>Retry</Button>
      </div>
    );
    return (
      <div role="status" className="flex items-center justify-center gap-2 py-12">
        <Loader2 aria-hidden="true" className="w-6 h-6 animate-spin text-muted-foreground" />
        Loading weekly recap preferences…
      </div>
    );
  }

  const formData: WeeklyRecapSettings = {
    enabled: drafts.enabled?.value ?? settings.enabled,
    emailEnabled: drafts.emailEnabled?.value ?? settings.emailEnabled,
    dayOfWeek: drafts.dayOfWeek?.value ?? settings.dayOfWeek,
    includeGoals: drafts.includeGoals?.value ?? settings.includeGoals,
    includeRecurring: drafts.includeRecurring?.value ?? settings.includeRecurring,
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Weekly Recap</CardTitle>
          <CardDescription>
            Configure your weekly financial summary preferences
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="enabled">Enable Weekly Recap</Label>
              <p className="text-sm text-muted-foreground">
                Show weekly financial summaries
              </p>
            </div>
            <Switch
              id="enabled"
              checked={formData.enabled}
              onCheckedChange={(checked) => edit("enabled", checked)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="dayOfWeek" className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Recap Day
            </Label>
            <Select
              value={formData.dayOfWeek.toString()}
              onValueChange={(value) => edit("dayOfWeek", parseInt(value, 10))}
            >
              <SelectTrigger id="dayOfWeek">
                <SelectValue placeholder="Select day" />
              </SelectTrigger>
              <SelectContent>
                {DAY_OPTIONS.map((day) => (
                  <SelectItem key={day.value} value={day.value.toString()}>
                    {day.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Your recap email goes out on this day, by your household&apos;s time zone,
              from 09:00 UTC, and covers the seven days before it.
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="emailEnabled" className="flex items-center gap-2">
                <Mail className="w-4 h-4" />
                Email Digest
              </Label>
              <p className="text-sm text-muted-foreground">
                Receive weekly recap via email
              </p>
            </div>
            <Switch
              id="emailEnabled"
              checked={formData.emailEnabled}
              onCheckedChange={(checked) => edit("emailEnabled", checked)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="includeGoals" className="flex items-center gap-2">
                <Target className="w-4 h-4" />
                Include Goals Progress
              </Label>
              <p className="text-sm text-muted-foreground">
                Show goal progress in recap
              </p>
            </div>
            <Switch
              id="includeGoals"
              checked={formData.includeGoals}
              onCheckedChange={(checked) => edit("includeGoals", checked)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="includeRecurring" className="flex items-center gap-2">
                <Receipt className="w-4 h-4" />
                Include Upcoming Bills
              </Label>
              <p className="text-sm text-muted-foreground">
                Show recurring transactions in recap
              </p>
            </div>
            <Switch
              id="includeRecurring"
              checked={formData.includeRecurring}
              onCheckedChange={(checked) => edit("includeRecurring", checked)}
            />
          </div>

          {updateMutation.error && <p role="alert">{updateMutation.error.message}</p>}
          <div className="flex justify-end pt-4">
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
