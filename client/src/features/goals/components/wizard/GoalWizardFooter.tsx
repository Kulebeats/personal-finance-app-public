/**
 * GoalWizardFooter Component
 *
 * Footer navigation for the goal creation wizard.
 */

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type WizardStep } from "../../types";

interface GoalWizardFooterProps {
  currentStep: WizardStep;
  goalsCount: number;
  isNextDisabled: boolean;
  isSubmitting: boolean;
  onBack: () => void;
  onNext: () => void;
}

export function GoalWizardFooter({
  currentStep,
  goalsCount,
  isNextDisabled,
  isSubmitting,
  onBack,
  onNext,
}: GoalWizardFooterProps) {
  return (
    <footer className="border-t bg-card py-4 mt-auto sticky bottom-0 z-10">
      <div className="container mx-auto max-w-5xl px-4 flex justify-between items-center">
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={currentStep === "select" || isSubmitting}
        >
          {currentStep === "select" ? "" : "← Back"}
        </Button>

        <div className="flex gap-3">
          {/* Skip button for Contribution and Budget steps */}
          {(currentStep === "contribution" || currentStep === "budget") && (
            <Button variant="ghost" onClick={onNext} disabled={isSubmitting}>
              Skip
            </Button>
          )}

          <Button
            onClick={onNext}
            disabled={isNextDisabled || isSubmitting}
            className="min-w-[120px] bg-orange-500 hover:bg-orange-600 text-white"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : currentStep === "budget" ? (
              goalsCount > 1 ? (
                `Create ${goalsCount} Goals`
              ) : (
                "Create Goal"
              )
            ) : (
              "Continue"
            )}
          </Button>
        </div>
      </div>
    </footer>
  );
}
