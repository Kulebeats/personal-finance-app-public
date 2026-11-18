import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info } from "lucide-react";

type ConfidenceLevel = "high" | "medium" | "low";

interface ForecastConfidenceIndicatorProps {
  level: ConfidenceLevel;
  reason?: string;
}

const levelConfig: Record<
  ConfidenceLevel,
  { label: string; className: string; description: string }
> = {
  high: {
    label: "High",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    description: "Based on recurring rules, budgets, and 6+ months of history",
  },
  medium: {
    label: "Medium",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    description: "Based on partial data sources or limited history",
  },
  low: {
    label: "Low",
    className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    description: "Limited data available - projections may vary",
  },
};

export function ForecastConfidenceIndicator({
  level,
  reason,
}: ForecastConfidenceIndicatorProps) {
  const config = levelConfig[level] ?? levelConfig.low;
  const tooltipText = reason || config.description;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium cursor-help",
              config.className
            )}
          >
            {config.label} Confidence
            <Info className="w-3 h-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <p className="text-sm">{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
