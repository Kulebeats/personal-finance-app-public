import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useGoals } from "@/hooks/useGoals";
import { Check } from "lucide-react";
import {
  Target,
  Plane,
  Wallet,
  Home,
  Car,
  GraduationCap,
  Heart,
  Gift,
  CreditCard,
} from "lucide-react";

interface StepSelectTemplateProps {
  // Single select mode (backward compatible)
  onSelect?: (type: string) => void;
  selectedType?: string;
  // Multi-select mode
  multiSelect?: boolean;
  selectedTypes?: string[];
  onToggle?: (type: string) => void;
}

const TEMPLATES = [
  {
    id: "vacation",
    label: "Take a vacation",
    icon: Plane,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
  },
  {
    id: "emergency_fund",
    label: "Emergency fund",
    icon: Wallet,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
  },
  {
    id: "down_payment",
    label: "Buy a home",
    icon: Home,
    color: "text-indigo-500",
    bg: "bg-indigo-500/10",
  },
  {
    id: "vehicle",
    label: "Buy a car",
    icon: Car,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
  },
  {
    id: "wedding",
    label: "Plan a wedding",
    icon: Heart,
    color: "text-rose-500",
    bg: "bg-rose-500/10",
  },
  {
    id: "education",
    label: "Save for School",
    icon: GraduationCap,
    color: "text-purple-500",
    bg: "bg-purple-500/10",
  },
  {
    id: "special_event",
    label: "Special Event",
    icon: Gift,
    color: "text-pink-500",
    bg: "bg-pink-500/10",
  },
  {
    id: "credit_card",
    label: "Pay off credit card",
    icon: CreditCard,
    color: "text-orange-500",
    bg: "bg-orange-500/10",
  },
  {
    id: "other",
    label: "Custom Goal",
    icon: Target,
    color: "text-slate-500",
    bg: "bg-slate-500/10",
  },
];

export function StepSelectTemplate({
  onSelect,
  selectedType,
  multiSelect = false,
  selectedTypes = [],
  onToggle,
}: StepSelectTemplateProps) {
  const { data: goals } = useGoals();

  const getCount = (type: string) => {
    if (!goals) return 0;
    return goals.filter((g) => g.goalType === type).length;
  };

  const handleClick = (templateId: string) => {
    if (multiSelect && onToggle) {
      onToggle(templateId);
    } else if (onSelect) {
      onSelect(templateId);
    }
  };

  const isSelected = (templateId: string) => {
    if (multiSelect) {
      return selectedTypes.includes(templateId);
    }
    return selectedType === templateId;
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">
          What are you saving for?
        </h2>
        <p className="text-muted-foreground">
          {multiSelect
            ? "Select one or more goals to create. You can configure each one after."
            : "Choose a template to get started with your new goal."}
        </p>
        {multiSelect && selectedTypes.length > 0 && (
          <p className="text-sm font-medium text-primary">
            {selectedTypes.length} goal{selectedTypes.length !== 1 ? "s" : ""}{" "}
            selected
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {TEMPLATES.map((template) => {
          const count = getCount(template.id);
          const Icon = template.icon;
          const selected = isSelected(template.id);

          return (
            <Card
              key={template.id}
              className={cn(
                "relative p-4 cursor-pointer hover:border-primary/50 hover:shadow-md transition-all group",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected &&
                  "border-primary ring-1 ring-primary shadow-md bg-primary/5"
              )}
              onClick={() => handleClick(template.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleClick(template.id);
                }
              }}
              role="button"
              tabIndex={0}
            >
              {/* Multi-select checkmark */}
              {multiSelect && selected && (
                <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-orange-500 flex items-center justify-center">
                  <Check className="w-4 h-4 text-white" />
                </div>
              )}

              <div className="flex flex-col items-center gap-3 text-center py-4">
                <div
                  className={cn(
                    "w-12 h-12 rounded-full flex items-center justify-center transition-transform group-hover:scale-110",
                    template.bg,
                    template.color
                  )}
                >
                  <Icon className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <div className="font-medium">{template.label}</div>
                  {count > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {count} already added
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
