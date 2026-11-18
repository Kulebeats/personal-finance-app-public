import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { UnsplashImagePicker } from "./UnsplashImagePicker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn, parseMoney } from "@/lib/utils";
import { format } from "date-fns";
import { useFormatters } from "@/contexts/SettingsContext";
import { CalendarIcon, Check, Pencil } from "lucide-react";

// Goal form data for multi-goal wizard flow
export interface GoalFormData {
  id: string;
  templateId: string;
  name: string;
  targetAmount: string;
  targetDate: Date | undefined;
  imageUrl: string;
  monthlyContribution: string;
  spendingReducesProgress: boolean;
}

// Helper to determine if template is pay_down type
const PAY_DOWN_TEMPLATES = [
  "credit_card",
  "loan",
  "debt",
  "mortgage",
  "student_loan",
  "car_loan",
  "personal_loan",
  "medical_debt",
];

interface StepTargetsProps {
  // Multi-goal mode
  goals: GoalFormData[];
  activeGoalId: string;
  onSelectGoal: (goalId: string) => void;
  data: GoalFormData;
  onChange: (updates: Partial<GoalFormData>) => void;
}

export function StepTargets({
  goals,
  activeGoalId,
  onSelectGoal,
  data,
  onChange,
}: StepTargetsProps) {
  const { currency } = useFormatters();
  const isPayDown = PAY_DOWN_TEMPLATES.some((t) => data.templateId.includes(t));

  // Get currency symbol from currency code
  const currencySymbol =
    currency === "USD"
      ? "$"
      : currency === "EUR"
      ? "€"
      : currency === "GBP"
      ? "£"
      : currency === "ZMW"
      ? "K"
      : "$";

  // Check if a goal has required fields completed
  const isGoalComplete = (goal: GoalFormData) =>
    goal.name && goal.targetAmount && parseMoney(goal.targetAmount) > 0;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight">
          Set your goal targets
        </h2>
        {goals.length > 1 && (
          <p className="text-sm text-muted-foreground mt-1">
            Configure each of your {goals.length} selected goals
          </p>
        )}
      </div>

      <div className="grid lg:grid-cols-[280px_1fr] gap-8">
        {/* Left Column: Goal list for navigation */}
        <div className="space-y-2">
          {goals.map((goal) => {
            const isActive = goal.id === activeGoalId;
            const isComplete = isGoalComplete(goal);

            return (
              <div
                key={goal.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectGoal(goal.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectGoal(goal.id);
                  }
                }}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                  isActive
                    ? "border-orange-500 bg-orange-50 dark:bg-orange-950/20 shadow-sm"
                    : "hover:bg-muted/50 hover:border-muted-foreground/20"
                )}
              >
                <div className="w-10 h-10 rounded-lg bg-muted overflow-hidden shrink-0 relative">
                  {goal.imageUrl ? (
                    <img
                      src={goal.imageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-500 font-medium">
                      {(goal.name || goal.templateId || "G")
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                  )}
                  {/* Completion indicator */}
                  {isComplete && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">
                    {goal.name || `${goal.templateId.replace(/_/g, " ")} goal`}
                  </div>
                  <div
                    className={cn(
                      "text-xs",
                      isComplete
                        ? "text-green-600 dark:text-green-400"
                        : "text-orange-500"
                    )}
                  >
                    {isComplete ? "Targets set" : "No targets set"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Column: Form with image */}
        <div className="space-y-6">
          {/* Large image preview with customize button */}
          <div className="relative rounded-xl overflow-hidden bg-muted aspect-video max-h-[200px]">
            {data.imageUrl ? (
              <img
                src={data.imageUrl}
                alt="Goal cover"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-linear-to-br from-orange-100 to-orange-200 dark:from-orange-900/30 dark:to-orange-800/20" />
            )}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  className="absolute bottom-3 right-3 gap-2 bg-background/90 backdrop-blur-sm"
                >
                  <Pencil className="w-3 h-3" />
                  Customize photo
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[500px] p-0" align="end">
                <UnsplashImagePicker
                  selectedUrl={data.imageUrl}
                  onSelect={(url) => onChange({ imageUrl: url })}
                  defaultQuery={data.templateId}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Form fields */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="Enter goal name"
                value={data.name}
                onChange={(e) => onChange({ name: e.target.value })}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount">
                Target amount{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-muted-foreground">
                  {currencySymbol}
                </span>
                <Input
                  id="amount"
                  type="number"
                  placeholder="Enter target amount"
                  className="pl-8"
                  value={data.targetAmount}
                  onChange={(e) => onChange({ targetAmount: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>
                Target date{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              {!data.targetAmount ? (
                <div className="h-10 px-3 flex items-center rounded-md border bg-muted text-muted-foreground text-sm">
                  Target amount required
                </div>
              ) : (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !data.targetDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {data.targetDate ? (
                        format(data.targetDate, "PPP")
                      ) : (
                        <span>Pick a date</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={data.targetDate}
                      onSelect={(date) => onChange({ targetDate: date })}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>

            {/* Spending reduces progress toggle - only for Save Up goals */}
            {!isPayDown && (
              <div className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <Label
                    className="text-base cursor-pointer font-medium"
                    htmlFor="spending-toggle"
                  >
                    Spending reduces goal progress
                  </Label>
                  <Switch
                    id="spending-toggle"
                    checked={data.spendingReducesProgress ?? false}
                    onCheckedChange={(checked) =>
                      onChange({ spendingReducesProgress: checked })
                    }
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  When on, marking a transaction as spent from a goal decreases
                  your progress, which is useful for goals like an emergency
                  fund.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
