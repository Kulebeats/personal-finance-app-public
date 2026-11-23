import { toastActionError } from "@/lib/actionErrorToast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiCall } from "@/lib/api";
import {
  useHouseholdMembers,
  useProfile,
  type HouseholdPreferences,
} from "@/hooks/use-settings";

// V7 response envelope (server/core/http success()).
interface Envelope<T> {
  success: boolean;
  data: T;
}

export const householdPreferencesKey = ["householdPreferences"] as const;

// GET/PUT /api/settings/preferences: household policy (owner and admin write).
export async function fetchHouseholdPreferences(): Promise<HouseholdPreferences | null> {
  const result = await apiCall<Envelope<{ preferences: HouseholdPreferences | null }>>(
    "/settings/preferences",
  );
  return result.data.preferences;
}

export async function updateAutoRolloverBudget(
  autoRolloverBudget: boolean,
): Promise<HouseholdPreferences> {
  const result = await apiCall<Envelope<{ preferences: HouseholdPreferences }>>(
    "/settings/preferences",
    { method: "PUT", body: JSON.stringify({ autoRolloverBudget }) },
  );
  return result.data.preferences;
}

/** NEW-16: the household switch the budget rollover projection reads. */
export function BudgetRolloverSetting() {
  const queryClient = useQueryClient();
  const { data: preferences, isLoading } = useQuery({
    queryKey: householdPreferencesKey,
    queryFn: fetchHouseholdPreferences,
  });
  const { data: members = [] } = useHouseholdMembers();
  const { data: profile } = useProfile();
  const role = members.find((m) => m.userId === profile?.id)?.role;
  const canEdit = role === "owner" || role === "admin";

  const mutation = useMutation({
    mutationFn: updateAutoRolloverBudget,
    onSuccess: (updated) => {
      queryClient.setQueryData(householdPreferencesKey, updated);
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      toast.success(
        updated.autoRolloverBudget
          ? "Budget rollover turned on"
          : "Budget rollover turned off",
      );
    },
    onError: (error: Error) => {
      toastActionError("Failed to update budget rollover", error);
    },
  });

  return (
    <div className="mt-6 flex max-w-md items-start justify-between gap-4 border-t border-border pt-6">
      <div className="space-y-1">
        <Label htmlFor="auto-rollover-budget">Roll over unspent budget</Label>
        <p id="auto-rollover-budget-help" className="text-xs text-muted-foreground">
          Budgets with rollover turned on carry their unspent amount into the
          next month.
          {!canEdit && " Only owners and admins can change this."}
        </p>
      </div>
      <Switch
        id="auto-rollover-budget"
        checked={preferences?.autoRolloverBudget ?? false}
        disabled={!canEdit || isLoading || mutation.isPending}
        onCheckedChange={(next) => mutation.mutate(next)}
        aria-describedby="auto-rollover-budget-help"
      />
    </div>
  );
}
