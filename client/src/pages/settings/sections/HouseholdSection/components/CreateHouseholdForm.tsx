import { toastActionError } from "@/lib/actionErrorToast";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Home } from "lucide-react";
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
import { invalidateSession } from "@/lib/session";

// Exported for tests: goes through apiCall so the POST carries x-csrf-token
// (raw fetch 403s in a real browser session).
export async function createHousehold(data: {
  name: string;
  currency: string;
}): Promise<HouseholdData> {
  const result = await apiCall<{ success: boolean; data: HouseholdData }>(
    "/household",
    { method: "POST", body: JSON.stringify(data) },
  );
  return result.data;
}

interface CreateHouseholdFormProps {
  currencies: { code: string; name: string; symbol: string }[];
  onSuccess?: () => void;
}

export function CreateHouseholdForm({
  currencies,
  onSuccess,
}: CreateHouseholdFormProps) {
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("ZMW");

  const createMutation = useMutation({
    mutationFn: createHousehold,
    onSuccess: () => {
      toast.success("Household created successfully!");
      onSuccess?.();
      invalidateSession();
    },
    onError: (error: Error) => {
      toastActionError("Failed to create household", error);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Please enter a household name");
      return;
    }
    createMutation.mutate({ name: name.trim(), currency });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="text-center pb-4">
        <Home className="w-12 h-12 mx-auto text-rose-500 mb-4" aria-hidden="true" />
        <h3 className="font-semibold text-lg mb-2">Create Your Household</h3>
        <p className="text-sm text-muted-foreground">
          Set up your household to start tracking your finances
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="new-household-name">Household Name</Label>
        <Input
          id="new-household-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., The Smith Family"
          className="max-w-md"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="new-currency">Primary Currency</Label>
        <Select value={currency} onValueChange={setCurrency}>
          <SelectTrigger id="new-currency" className="max-w-md" aria-label="Select primary currency">
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
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button
        type="submit"
        disabled={createMutation.isPending || !name.trim()}
        className="bg-rose-500 hover:bg-rose-600"
        aria-busy={createMutation.isPending}
      >
        {createMutation.isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
            Creating...
          </>
        ) : (
          "Create Household"
        )}
      </Button>
    </form>
  );
}
