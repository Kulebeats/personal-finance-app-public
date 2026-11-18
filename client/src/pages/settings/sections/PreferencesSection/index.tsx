import {
  useUserPreferences,
  useUpdateUserPreferences,
  useAIConsent,
  useUpdateAIConsent,
  UserPreferences,
  UpdateUserPreferencesData,
} from "@/hooks/use-settings";
import { LoadingSection } from "@/features/settings/components/LoadingSection";
import { TransactionEntryCard } from "./components/TransactionEntryCard";
import { ImportBehaviorCard } from "./components/ImportBehaviorCard";
import { ReceiptScanningCard } from "./components/ReceiptScanningCard";
import { AIFeaturesCard } from "./components/AIFeaturesCard";

export default function PreferencesSection() {
  const { data: preferences, isLoading: isLoadingPrefs } = useUserPreferences();
  const { data: aiConsent, isLoading: isLoadingAI } = useAIConsent();
  const updatePrefs = useUpdateUserPreferences();
  const updateAIConsent = useUpdateAIConsent();

  if (isLoadingPrefs || isLoadingAI) {
    return <LoadingSection variant="card" />;
  }

  const handlePrefChange = (
    key: keyof UserPreferences,
    value: UserPreferences[keyof UserPreferences]
  ) => {
    updatePrefs.mutate({ [key]: value } as UpdateUserPreferencesData);
  };

  const handleAIConsentChange = (consentGiven: boolean) => {
    updateAIConsent.mutate(consentGiven);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Preferences</h2>
        <p className="text-muted-foreground">
          Manage your workflow preferences for manual entry, imports, and
          automation.
        </p>
      </div>

      <div className="grid gap-6">
        <TransactionEntryCard
          preferences={preferences}
          onUpdate={handlePrefChange}
        />
        <ImportBehaviorCard
          preferences={preferences}
          onUpdate={handlePrefChange}
        />
        <ReceiptScanningCard
          preferences={preferences}
          onUpdate={handlePrefChange}
        />
        <AIFeaturesCard preferences={aiConsent} onUpdate={handleAIConsentChange} />
      </div>
    </div>
  );
}
