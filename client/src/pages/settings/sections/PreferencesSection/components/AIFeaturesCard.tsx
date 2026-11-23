import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AIConsentDecision, AIConsentStatus } from "@/hooks/use-settings";
import { AI_DISCLOSURE_VERSION, AIDisclosure } from "@/features/ai/components/AIDisclosure";

interface AIFeaturesCardProps {
  preferences?: AIConsentStatus;
  onUpdate: (decision: AIConsentDecision) => void;
}

export function AIFeaturesCard({ preferences, onUpdate }: AIFeaturesCardProps) {
  return (
    <Card className="border-indigo-100 dark:border-indigo-900/20">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>AI Features</CardTitle>
          <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400">
            Beta
          </span>
        </div>
        <CardDescription>
          Manage household consent for the AI assistant and related features.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-muted p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-indigo-500"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-foreground">
                Household-wide setting
              </h3>
              <div className="mt-2 text-sm text-muted-foreground">
                <div className="space-y-2">
                  <AIDisclosure />
                  <p>
                    Only household owners and admins can change this setting.
                    {preferences?.needsReconsent
                      ? " Consent terms have changed since you last agreed — please review and re-confirm."
                      : ""}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="ai-consent-given">Enable AI features</Label>
            <p className="text-sm text-muted-foreground">
              Allow the AI assistant to analyze this household&apos;s
              transactions, budgets, and goals.
            </p>
          </div>
          <Switch
            id="ai-consent-given"
            checked={preferences?.consentGiven ?? false}
            onCheckedChange={(checked) =>
              onUpdate(
                checked
                  ? { consentGiven: true, consentVersion: AI_DISCLOSURE_VERSION }
                  : { consentGiven: false },
              )
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
