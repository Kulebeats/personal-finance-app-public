/**
 * BudgetWalkthrough Component
 *
 * Step-by-step onboarding walkthrough for budget setup.
 */

import { useState } from "react";
import { X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface WalkthroughStep {
  title: string;
  description: string;
  target: string;
}

const steps: WalkthroughStep[] = [
  {
    title: "Welcome to Budgeting",
    description:
      "Let's set up your budget plan. We'll guide you through Income, Expenses, Savings, and Debts to ensure every dollar is accounted for.",
    target: "body",
  },
  {
    title: "Income",
    description:
      "Start by reviewing your income sources. This sets the baseline for how much you have available to budget.",
    target: "Income",
  },
  {
    title: "Fixed Expenses",
    description:
      "These are your committed costs like Rent, Bills, and Subscriptions. They usually stay the same each month.",
    target: "Expenses",
  },
  {
    title: "Flexible Expenses",
    description:
      "These are variable costs like Dining Out, Shopping, and Entertainment. You can use Flex Mode to budget for these as a whole group!",
    target: "Expenses",
  },
  {
    title: "Savings & Goals",
    description:
      "Pay yourself first! Allocate money towards your future goals and emergency funds.",
    target: "Savings",
  },
  {
    title: "Summary",
    description:
      "Keep an eye on your 'Left to Budget' amount. The goal is to give every dollar a job until this number is zero.",
    target: "Summary",
  },
];

interface BudgetWalkthroughProps {
  onClose: () => void;
}

export function BudgetWalkthrough({ onClose }: BudgetWalkthroughProps) {
  const [step, setStep] = useState(0);
  const currentStep = steps[step];

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <Card className="w-full max-w-md bg-card shadow-xl p-0 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-primary/5 p-6 border-b border-border/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-widest text-primary">
              Step {step + 1} of {steps.length}
            </span>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <h2 className="text-xl font-bold text-foreground">
            {currentStep.title}
          </h2>
        </div>

        {/* Content */}
        <div className="p-6">
          <p className="text-muted-foreground leading-relaxed mb-8">
            {currentStep.description}
          </p>

          <div className="flex items-center justify-between">
            {/* Progress dots */}
            <div className="flex gap-1">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "w-2 h-2 rounded-full transition-colors",
                    i === step ? "bg-primary" : "bg-muted",
                  )}
                />
              ))}
            </div>
            <button
              onClick={handleNext}
              className="px-6 py-2 bg-orange-500 text-white font-bold rounded-md hover:bg-orange-600 transition-colors shadow-sm"
            >
              {step === steps.length - 1 ? "Finish Setup" : "Next Step"}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
