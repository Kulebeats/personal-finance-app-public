import { Suspense } from "react";
import { ErrorBoundary } from "@/features/settings/components/ErrorBoundary";
import { LoadingSection } from "@/features/settings/components/LoadingSection";
import { SettingsCard } from "@/features/settings/components/SettingsCard";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiCall, type ApiError } from "@/lib/api";
import { CreateHouseholdForm } from "./components/CreateHouseholdForm";
import { EditHouseholdForm } from "./components/EditHouseholdForm";
import { HouseholdData } from "./types";

// V7 response envelope (server/core/http success()).
interface Envelope<T> {
  success: boolean;
  data: T;
}

// FIX P7b-3: same fix as Dashboard.tsx's onboarding gate and use-settings.ts's
// fetchHousehold - route through apiCall so the thrown error carries the
// real `code`/`status`, not just message prose that could be reworded.
async function fetchHouseholdGeneral(): Promise<HouseholdData> {
  const result = await apiCall<Envelope<HouseholdData>>("/household/general");
  return result.data;
}

// Structural check: true when the household query failed because this user
// has no household yet (not any other error). Keys off the distinguishable
// HOUSEHOLD_NOT_FOUND code first, falling back to the HTTP 404 status - this
// specific endpoint 404s ONLY for the no-household case - so it still works
// against a server that hasn't deployed the new code yet.
function isHouseholdNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const apiError = error as ApiError;
  return apiError.code === "HOUSEHOLD_NOT_FOUND" || apiError.status === 404;
}

const months = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

const currencies = [
  { code: "ZMW", name: "Zambian Kwacha", symbol: "K" },
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "British Pound", symbol: "£" },
  { code: "ZAR", name: "South African Rand", symbol: "R" },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh" },
  { code: "NGN", name: "Nigerian Naira", symbol: "₦" },
  { code: "TZS", name: "Tanzanian Shilling", symbol: "TSh" },
  { code: "UGX", name: "Ugandan Shilling", symbol: "USh" },
  { code: "BWP", name: "Botswana Pula", symbol: "P" },
];

export default function HouseholdSection() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["householdGeneral"],
    queryFn: fetchHouseholdGeneral,
  });

  if (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Failed to load household settings";
    const isNotFound = isHouseholdNotFoundError(error);

    return (
      <ErrorBoundary sectionName="Household">
        <SettingsCard
          title="Household Settings"
          description="Manage your household configuration"
        >
          {isNotFound ? (
            <CreateHouseholdForm
              currencies={currencies}
              onSuccess={() =>
                queryClient.invalidateQueries({
                  queryKey: ["householdGeneral"],
                })
              }
            />
          ) : (
            <p className="text-sm text-destructive">{errorMessage}</p>
          )}
        </SettingsCard>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary sectionName="Household">
      <Suspense fallback={<LoadingSection variant="form" />}>
        <SettingsCard
          title="Household Settings"
          description="Manage your household name, currency, and fiscal year"
          isLoading={isLoading}
        >
          {data && (
            <EditHouseholdForm
              data={data}
              currencies={currencies}
              months={months}
            />
          )}
        </SettingsCard>
      </Suspense>
    </ErrorBoundary>
  );
}
