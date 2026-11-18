import { CheckCircle2, Circle } from "lucide-react";

type DataSource = "recurring" | "budgets" | "averages";

interface ForecastDataSourcesProps {
  sources: DataSource[];
}

const sourceLabels: Record<DataSource, { label: string; description: string }> = {
  recurring: {
    label: "Recurring Rules",
    description: "Based on your scheduled income and expenses",
  },
  budgets: {
    label: "Budget Allocations",
    description: "Using your budget targets by category",
  },
  averages: {
    label: "Historical Averages",
    description: "Calculated from past 6 months of activity",
  },
};

const allSources: DataSource[] = ["recurring", "budgets", "averages"];

export function ForecastDataSources({ sources }: ForecastDataSourcesProps) {
  const sourceSet = new Set(sources);

  return (
    <div className="flex flex-wrap gap-3 text-sm">
      {allSources.map((source) => {
        const isActive = sourceSet.has(source);
        const config = sourceLabels[source];

        return (
          <div
            key={source}
            className={`flex items-center gap-1.5 ${
              isActive ? "text-foreground" : "text-muted-foreground/50"
            }`}
            title={config.description}
          >
            {isActive ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            ) : (
              <Circle className="w-4 h-4" />
            )}
            <span>{config.label}</span>
          </div>
        );
      })}
    </div>
  );
}
