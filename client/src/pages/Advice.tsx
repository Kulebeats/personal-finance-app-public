/**
 * Thandi (AI Assistant) page — hosts the chat surface (spec UI-AI-001).
 *
 * The former static info cards are collapsed into a single dismissible intro
 * block so the conversation owns the page.
 */
import { useState } from "react";
import { X } from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { AdviceChat } from "@/features/ai/AdviceChat";

const INTRO_DISMISSED_KEY = "thandi.intro.dismissed";

function readIntroDismissed(): boolean {
  try {
    return window.localStorage.getItem(INTRO_DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

export default function Advice() {
  const [isIntroDismissed, setIsIntroDismissed] = useState(readIntroDismissed);

  const dismissIntro = (): void => {
    setIsIntroDismissed(true);
    try {
      window.localStorage.setItem(INTRO_DISMISSED_KEY, "true");
    } catch {
      // Storage unavailable (private mode): dismiss for this session only.
    }
  };

  return (
    <Layout>
      <div className="flex h-full flex-col space-y-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">
            Thandi (AI Assistant)
          </h1>
          <p className="text-muted-foreground">
            Ask questions about spending, budgets, goals, and recurring
            payments in one place.
          </p>
        </div>

        {!isIntroDismissed && (
          <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            <p>
              Thandi provides read-only summaries — no transactions or budgets
              are modified. Household consent is required before any AI
              processing, and usage is rate-limited per household each day.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={dismissIntro}
              aria-label="Dismiss intro"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        )}

        <div className="flex-1">
          <AdviceChat />
        </div>
      </div>
    </Layout>
  );
}
