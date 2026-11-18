/**
 * GoalWizardStepper Component
 *
 * Displays the step navigation for the goal creation wizard.
 */

import { Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type WizardStep } from "../../types";

const STEPS = [
  { id: "select", label: "Select" },
  { id: "targets", label: "Targets" },
  { id: "contribution", label: "Contribution" },
  { id: "budget", label: "Budget" },
] as const;

interface GoalWizardStepperProps {
  currentStep: WizardStep;
  goalsCount: number;
  onCancel: () => void;
}

export function GoalWizardStepper({
  currentStep,
  goalsCount,
  onCancel,
}: GoalWizardStepperProps) {
  return (
    <header className="border-b bg-card sticky top-0 z-10 shrink-0">
      <div className="container mx-auto max-w-5xl px-4 h-16 flex items-center justify-between">
        <div className="font-semibold text-lg hidden sm:block">
          Create Goal{goalsCount > 1 ? "s" : ""}
          {goalsCount > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({goalsCount} selected)
            </span>
          )}
        </div>
        {/* Mobile Back / Title */}
        <div className="sm:hidden flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Go back">
            <ChevronRight className="w-5 h-5 rotate-180" />
          </Button>
          <span className="font-semibold">
            Create Goal{goalsCount > 1 ? "s" : ""}
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-2">
          {STEPS.map((step, index) => {
            const stepIndex = STEPS.findIndex((s) => s.id === step.id);
            const currentIndex = STEPS.findIndex((s) => s.id === currentStep);

            const isActive = step.id === currentStep;
            const isCompleted = currentIndex > stepIndex;

            return (
              <div key={step.id} className="flex items-center">
                <div
                  className={cn(
                    "flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium transition-colors cursor-default",
                    isActive && "bg-primary/10 text-primary",
                    isCompleted && "text-muted-foreground",
                    !isActive && !isCompleted && "text-muted-foreground/50"
                  )}
                >
                  <div
                    className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-xs border transition-colors",
                      isActive &&
                        "border-primary bg-primary text-primary-foreground",
                      isCompleted &&
                        "border-primary text-primary bg-background",
                      !isActive &&
                        !isCompleted &&
                        "border-muted-foreground/30 bg-background"
                    )}
                  >
                    {isCompleted ? <Check className="w-3 h-3" /> : index + 1}
                  </div>
                  {step.label}
                </div>
                {index < STEPS.length - 1 && (
                  <div
                    className={cn(
                      "w-8 h-px mx-2 transition-colors",
                      isCompleted ? "bg-primary" : "bg-border"
                    )}
                  />
                )}
              </div>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="hidden sm:inline-flex"
          >
            Cancel
          </Button>
        </div>
      </div>
    </header>
  );
}
