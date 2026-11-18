import React from "react";
import { cn } from "@/lib/utils";
import { FileQuestion } from "lucide-react";

interface ReportEmptyStateProps {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}

export function ReportEmptyState({
  title = "No data available",
  description = "There is no data to display for the selected criteria.",
  icon,
  className,
  action,
}: ReportEmptyStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center p-8 text-center rounded-lg border border-dashed border-muted-foreground/25 bg-muted/50 min-h-[300px]",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted shadow-sm mb-4">
        {icon || <FileQuestion className="h-6 w-6 text-muted-foreground" />}
      </div>
      <h3 className="text-lg font-medium text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground mt-2 max-w-sm">
        {description}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
