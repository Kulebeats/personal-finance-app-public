import { Calendar, ThumbsUp, ThumbsDown, CheckCircle2 } from "lucide-react";
import { useWeeklyRecap } from "../WeeklyRecapContext";
import { useFormatters } from "@/contexts/SettingsContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState } from "react";

export default function RecurringStep() {
  const { data, nextStep, prevStep, submitStepFeedback } = useWeeklyRecap();
  const { formatCurrency } = useFormatters();
  const [feedbackGiven, setFeedbackGiven] = useState<
    "positive" | "negative" | null
  >(null);

  if (!data) return null;

  const { recurring } = data;

  const handleFeedback = (type: "positive" | "negative") => {
    setFeedbackGiven(type);
    submitStepFeedback(type);
  };

  // Helper to get relative day label
  const getDayLabel = (dueDay: number) => {
    const today = new Date();
    const currentDay = today.getDate();

    if (dueDay === currentDay) return "Today";
    if (dueDay === currentDay + 1) return "Tomorrow";

    // Simple logic, assuming within next 7 days as per API logic
    return `on start ${dueDay}`;
  };

  return (
    <div className="flex flex-col space-y-6">
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold">Upcoming Bills</h3>
        <p className="text-foreground/70 text-sm">
          Recurring expenses for next week
        </p>
      </div>

      <div className="bg-primary/5 rounded-xl p-6 flex items-center justify-between border border-primary/15">
        <div className="space-y-1">
          <p className="text-sm text-primary font-medium">
            Total Upcoming
          </p>
          <p className="text-3xl font-bold">
            {formatCurrency(recurring.totalAmount)}
          </p>
        </div>
        <div className="h-10 w-10 bg-primary/10 rounded-full flex items-center justify-center text-primary">
          <Calendar className="w-5 h-5" />
        </div>
      </div>

      <div className="space-y-3 flex-1 min-h-[120px]">
        {recurring.upcoming.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-8">
            <CheckCircle2 className="w-8 h-8 mb-2 opacity-50" />
            <p>No upcoming bills next week!</p>
          </div>
        ) : (
          recurring.upcoming.map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between p-3 border rounded-xl hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                  {item.name[0]}
                </div>
                <div>
                  <p className="font-medium text-sm">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Due {getDayLabel(new Date(item.dueDate).getDate())}
                  </p>
                </div>
              </div>
              <span className="font-semibold">
                {formatCurrency(item.amount)}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col items-center gap-4">
        <div className="flex gap-4">
          <Button
            variant="outline"
            size="icon"
            className={cn(
              "rounded-full w-10 h-10 transition-colors",
              feedbackGiven === "positive" &&
                "bg-emerald-100 border-emerald-500 text-emerald-600 dark:bg-emerald-900/30"
            )}
            onClick={() => handleFeedback("positive")}
            aria-label="Positive feedback"
          >
            <ThumbsUp className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className={cn(
              "rounded-full w-10 h-10 transition-colors",
              feedbackGiven === "negative" &&
                "bg-rose-100 border-rose-500 text-rose-600 dark:bg-rose-900/30"
            )}
            onClick={() => handleFeedback("negative")}
            aria-label="Negative feedback"
          >
            <ThumbsDown className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1 rounded-full"
          onClick={prevStep}
        >
          Back
        </Button>
        <Button className="flex-1 rounded-full" onClick={nextStep}>
          Continue
        </Button>
      </div>
    </div>
  );
}
