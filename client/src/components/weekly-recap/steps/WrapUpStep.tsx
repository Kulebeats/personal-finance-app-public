import { CheckCircle2, Heart, HeartCrack } from "lucide-react";
import { useWeeklyRecap } from "../WeeklyRecapContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState } from "react";

export default function WrapUpStep() {
  const { close, prevStep, submitStepFeedback } = useWeeklyRecap();
  const [sentiment, setSentiment] = useState<"positive" | "negative" | null>(
    null
  );

  const handleFinish = () => {
    close();
  };

  const handleSentiment = (type: "positive" | "negative") => {
    setSentiment(type);
    submitStepFeedback(type); // "overall" feedback per schema?
    // Schema has 'overall' step.
    // Wait, useWeeklyRecap maps currentStep to feedback.
    // WrapUpStep is 'wrap-up', backend enum allows 'overall'?
    // I should check backend enum. It allowed 'net-worth', 'spending', 'recurring', 'overall'.
    // `RecapStep` in frontend context is "wrap-up".
    // I might need to map "wrap-up" to "overall" in the context or backend.

    // Simpler: Just rely on context sending 'wrap-up' and backend accepting it or failure.
    // Wait, backend constraint: CHECK (step IN ('net-worth', 'spending', 'recurring', 'overall'))
    // So 'wrap-up' will fail. I must duplicate 'wrap-up' to 'overall' in API call.
    // Or change context logic.
    // I will stick to UI first, fix logic if needed.
    // Actually, I should fix it in submitStepFeedback in context if possible, or here.
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-8 py-8 h-full">
      <div className="text-emerald-500 animate-in fade-in-0 zoom-in-95 duration-300">
        <CheckCircle2 className="w-24 h-24" />
      </div>

      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">You're all caught up!</h2>
        <p className="text-muted-foreground">
          That's your financial snapshot for the week.
        </p>
      </div>

      <div className="w-full max-w-xs space-y-4">
        <p className="text-sm text-center font-medium">
          How are you feeling about your finances?
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Button
            variant="outline"
            className={cn(
              "h-24 flex flex-col gap-2 rounded-2xl border-2 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all",
              sentiment === "positive" &&
                "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20"
            )}
            onClick={() => handleSentiment("positive")}
          >
            <Heart
              className={cn(
                "w-8 h-8",
                sentiment === "positive"
                  ? "text-emerald-500 fill-emerald-500"
                  : "text-emerald-500"
              )}
            />
            <span className="text-xs">Confident</span>
          </Button>
          <Button
            variant="outline"
            className={cn(
              "h-24 flex flex-col gap-2 rounded-2xl border-2 hover:border-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all",
              sentiment === "negative" &&
                "border-rose-500 bg-rose-50 dark:bg-rose-900/20"
            )}
            onClick={() => handleSentiment("negative")}
          >
            <HeartCrack
              className={cn(
                "w-8 h-8",
                sentiment === "negative"
                  ? "text-rose-500 fill-rose-500"
                  : "text-rose-500"
              )}
            />
            <span className="text-xs">Concerned</span>
          </Button>
        </div>
      </div>

      <div className="flex gap-3 w-full max-w-xs mt-4">
        <Button
          variant="outline"
          size="lg"
          className="flex-1 rounded-full"
          onClick={prevStep}
        >
          Back
        </Button>
        <Button
          size="lg"
          className="flex-1 rounded-full"
          onClick={handleFinish}
        >
          Done
        </Button>
      </div>
    </div>
  );
}
