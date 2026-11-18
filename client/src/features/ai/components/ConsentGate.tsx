/**
 * ConsentGate — consent-first flow for Thandi (spec UI-AI-002).
 *
 * Rendered instead of the composer while household AI consent is absent or
 * needs re-consent. POST /api/ai/consent is admin+ only (SEC-RBAC-001), so
 * non-admin members get a non-actionable notice instead of a button that
 * would 403. Disclosure copy comes from
 * docs/ai-integration/specifications/ai-assistant-consent-disclosure-copy.md.
 */
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useHouseholdMembers,
  useProfile,
  useUpdateAIConsent,
  type AIConsentStatus,
} from "@/hooks/use-settings";

const ADMIN_ROLES = ["admin", "owner"];

interface ConsentGateProps {
  consent: AIConsentStatus;
}

export function ConsentGate({ consent }: ConsentGateProps) {
  const { data: profile } = useProfile();
  const { data: members } = useHouseholdMembers();
  const updateConsent = useUpdateAIConsent();

  const role =
    members?.find((member) => member.userId === profile?.id)?.role ?? null;
  const canManageConsent = role !== null && ADMIN_ROLES.includes(role);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
        <CardTitle>
          {consent.needsReconsent
            ? "Review our updated AI disclosure"
            : "Enable Thandi for your household"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        {consent.needsReconsent && (
          <p className="font-medium text-foreground">
            Our AI disclosure has been updated — please review and re-consent
            before continuing.
          </p>
        )}
        <p>
          Thandi uses AI to summarize your household financial data. Personal
          identifiers are removed and data is minimized before external
          processing.
        </p>
        <p>
          By continuing, you grant household-level consent. You can revoke
          consent any time in Settings.
        </p>
        <p className="font-medium text-foreground">
          Not financial advice. For personalized advice, consult a qualified
          professional.
        </p>
        {canManageConsent ? (
          <div>
            <Button
              onClick={() => updateConsent.mutate(true)}
              disabled={updateConsent.isPending}
            >
              {updateConsent.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              Enable Thandi
            </Button>
          </div>
        ) : (
          <p role="note">
            Ask a household admin to enable Thandi in Settings.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
