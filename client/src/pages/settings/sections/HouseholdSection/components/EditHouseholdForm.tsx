import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Home, DollarSign, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HouseholdData } from "../types";
import { apiCall } from "@/lib/api";

// Exported for tests: apiCall attaches the cached x-csrf-token (and self-heals
// on a stale one), replacing the old manual token round-trip per call.
export async function updateHouseholdGeneral(data: {
  name?: string;
  currency?: string;
  fiscalYearStartMonth?: number;
}): Promise<HouseholdData> {
  const result = await apiCall<{ success: boolean; data: HouseholdData }>(
    "/household/general",
    { method: "PUT", body: JSON.stringify(data) },
  );
  return result.data;
}

interface EditHouseholdFormProps {
  data: HouseholdData;
  currencies: { code: string; name: string; symbol: string }[];
  months: { value: number; label: string }[];
}

export function EditHouseholdForm({
  data,
  currencies,
  months,
}: EditHouseholdFormProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("ZMW");
  const [fiscalMonth, setFiscalMonth] = useState(1);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (data?.household) {
      setName(data.household.name);
      setCurrency(data.household.currency);
      setFiscalMonth(data.household.fiscalYearStartMonth || 1);
    }
  }, [data]);

  useEffect(() => {
    if (data?.household) {
      const changed =
        name !== data.household.name ||
        currency !== data.household.currency ||
        fiscalMonth !== (data.household.fiscalYearStartMonth || 1);
      setHasChanges(changed);
    }
  }, [name, currency, fiscalMonth, data]);

  const updateMutation = useMutation({
    mutationFn: updateHouseholdGeneral,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["householdGeneral"] });
      toast.success("Household settings updated");
      setHasChanges(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update settings");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      name,
      currency,
      fiscalYearStartMonth: fiscalMonth,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Household Name */}
      <div className="space-y-2">
        <Label htmlFor="household-name" className="flex items-center gap-2">
          <Home className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          Household Name
        </Label>
        <Input
          id="household-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter household name"
          className="max-w-md"
        />
        <p className="text-xs text-muted-foreground">
          A friendly name to identify your household
        </p>
      </div>

      {/* Currency */}
      <div className="space-y-2">
        <Label htmlFor="currency" className="flex items-center gap-2">
          <DollarSign
            className="w-4 h-4 text-muted-foreground"
            aria-hidden="true"
          />
          Primary Currency
        </Label>
        <Select value={currency} onValueChange={setCurrency}>
          <SelectTrigger
            id="currency"
            className="max-w-md"
            aria-label="Select primary currency"
          >
            <SelectValue placeholder="Select currency" />
          </SelectTrigger>
          <SelectContent>
            {currencies.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-muted-foreground">
                    {c.symbol}
                  </span>
                  <span>{c.name}</span>
                  <span className="text-muted-foreground">({c.code})</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Used for all transactions and reports
        </p>
      </div>

      {/* Fiscal Year Start */}
      <div className="space-y-2">
        <Label htmlFor="fiscal-month" className="flex items-center gap-2">
          <Calendar
            className="w-4 h-4 text-muted-foreground"
            aria-hidden="true"
          />
          Fiscal Year Start
        </Label>
        <Select
          value={String(fiscalMonth)}
          onValueChange={(v) => setFiscalMonth(Number(v))}
        >
          <SelectTrigger
            id="fiscal-month"
            className="max-w-md"
            aria-label="Select fiscal year start month"
          >
            <SelectValue placeholder="Select month" />
          </SelectTrigger>
          <SelectContent>
            {months.map((m) => (
              <SelectItem key={m.value} value={String(m.value)}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          When your financial year begins (affects yearly reports and budgets)
        </p>
      </div>

      {/* Submit Button */}
      <Button
        type="submit"
        disabled={!hasChanges || updateMutation.isPending}
        className="bg-rose-500 hover:bg-rose-600"
        aria-busy={updateMutation.isPending}
      >
        {updateMutation.isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
            Updating...
          </>
        ) : (
          "Update Household"
        )}
      </Button>
    </form>
  );
}
