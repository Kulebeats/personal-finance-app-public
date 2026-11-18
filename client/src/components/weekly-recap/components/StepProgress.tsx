import { cn } from "@/lib/utils";
import { useWeeklyRecap } from "../WeeklyRecapContext";

const STEP_NAMES = ["Net Worth", "Spending", "Recurring"];

export default function StepProgress() {
  const { stepIndex, totalSteps } = useWeeklyRecap();

  // Calculate progress percentage for screen readers
  const progressPercent = Math.round(((stepIndex + 1) / totalSteps) * 100);

  return (
    <div
      className="flex gap-2 mb-6 px-1"
      role="progressbar"
      aria-valuenow={stepIndex + 1}
      aria-valuemin={1}
      aria-valuemax={totalSteps}
      aria-label={`Weekly recap progress: step ${stepIndex + 1} of ${totalSteps}, ${STEP_NAMES[stepIndex] || ""}`}
    >
      {Array.from({ length: totalSteps }).map((_, idx) => (
        <div
          key={idx}
          className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden relative"
          aria-hidden="true"
        >
          {idx <= stepIndex && (
            <div
              className={cn(
                "absolute top-0 left-0 h-full w-full animate-in fade-in-0 duration-300",
                idx === stepIndex ? "bg-primary" : "bg-primary/40"
              )}
            />
          )}
        </div>
      ))}
      {/* Screen reader announcement for step changes */}
      <span className="sr-only" aria-live="polite">
        Step {stepIndex + 1} of {totalSteps}: {STEP_NAMES[stepIndex] || ""}
      </span>
    </div>
  );
}
