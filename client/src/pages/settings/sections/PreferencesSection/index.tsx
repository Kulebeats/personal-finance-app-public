import {
  useAIConsent,
  useUpdateAIConsent,
  type AIConsentDecision,
} from "@/hooks/use-settings";
import { useUserPreferenceDraft } from "@/hooks/use-user-preference-draft";
import { Button } from "@/components/ui/button";
import { LoadingSection } from "@/features/settings/components/LoadingSection";
import { TransactionEntryCard } from "./components/TransactionEntryCard";
import { ImportBehaviorCard } from "./components/ImportBehaviorCard";
import { ReceiptScanningCard } from "./components/ReceiptScanningCard";
import { AIFeaturesCard } from "./components/AIFeaturesCard";

export default function PreferencesSection() {
  const { data: preferences, isLoading: isLoadingPrefs, error, refetch, update, save, pending, saveError, hasChanges } = useUserPreferenceDraft();
  const { data: aiConsent, isLoading: isLoadingAI } = useAIConsent();
  const updateAIConsent = useUpdateAIConsent();

  if (isLoadingPrefs || isLoadingAI) {
    return <LoadingSection variant="card" />;
  }

  if (error || !preferences) return <div><p role="alert">Personal preferences could not be loaded. {error?.message}</p><Button onClick={() => { void refetch(); }}>Retry Loading Preferences</Button></div>;

  const handleAIConsentChange = (decision: AIConsentDecision) => {
    updateAIConsent.mutate(decision);
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
          onUpdate={update}
        />
        <ImportBehaviorCard
          preferences={preferences}
          onUpdate={update}
        />
        <ReceiptScanningCard
          preferences={preferences}
          onUpdate={update}
        />
        <div>
          <Button disabled={pending || !hasChanges} onClick={() => { void save(); }}>{pending ? "Saving…" : saveError ? "Retry Save" : "Save Preferences"}</Button>
          {saveError && <p role="alert">{saveError}</p>}
        </div>
        <AIFeaturesCard preferences={aiConsent} onUpdate={handleAIConsentChange} />
      </div>
    </div>
  );
}
