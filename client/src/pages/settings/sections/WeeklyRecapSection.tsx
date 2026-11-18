import { useState } from "react";
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

// Exported for tests: goes through apiCall so the PATCH carries x-csrf-token
// (raw fetch 403s in a real browser session).
export async function updateWeeklyRecapSettings(
  data: Partial<WeeklyRecapSettings>,
): Promise<WeeklyRecapSettings> {
  const result = await apiCall<{ success: boolean; data: WeeklyRecapSettings }>(
    "/weekly-recap/settings",
    { method: "PATCH", body: JSON.stringify(data) },
  );
  return result.data;
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

  const { data: settings, isLoading } = useQuery<WeeklyRecapSettings>({
    queryKey: ["weekly-recap-settings"],
    queryFn: async () => {
      const response = await fetch("/api/weekly-recap/settings", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch settings");
      const result = await response.json();
      return result.data;
    },
  });

  const [formData, setFormData] = useState<WeeklyRecapSettings>({
    enabled: settings?.enabled ?? true,
    emailEnabled: settings?.emailEnabled ?? false,
    dayOfWeek: settings?.dayOfWeek ?? 0,
    includeGoals: settings?.includeGoals ?? true,
    includeRecurring: settings?.includeRecurring ?? true,
  });

  // Update form data when settings load
  useState(() => {
    if (settings) {
      setFormData(settings);
    }
  });

  const updateMutation = useMutation({
    mutationFn: updateWeeklyRecapSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["weekly-recap-settings"] });
      toast({
        title: "Settings updated",
        description: "Your weekly recap preferences have been saved.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update settings. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    updateMutation.mutate(formData);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

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
          {/* Enable/Disable */}
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
              onCheckedChange={(checked) =>
                setFormData({ ...formData, enabled: checked })
              }
            />
          </div>

          {/* Day of Week */}
          <div className="space-y-2">
            <Label htmlFor="dayOfWeek" className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Recap Day
            </Label>
            <Select
              value={formData.dayOfWeek.toString()}
              onValueChange={(value) =>
                setFormData({ ...formData, dayOfWeek: parseInt(value) })
              }
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
              Which day should the weekly recap be shown
            </p>
          </div>

          {/* Email Notifications */}
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
              onCheckedChange={(checked) =>
                setFormData({ ...formData, emailEnabled: checked })
              }
            />
          </div>

          {/* Include Goals */}
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
              onCheckedChange={(checked) =>
                setFormData({ ...formData, includeGoals: checked })
              }
            />
          </div>

          {/* Include Recurring */}
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
              onCheckedChange={(checked) =>
                setFormData({ ...formData, includeRecurring: checked })
              }
            />
          </div>

          {/* Save Button */}
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
