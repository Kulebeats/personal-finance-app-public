import { FileBarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface WidgetEmptyStateProps {
  message?: string;
  icon?: React.ElementType;
  className?: string;
  action?: React.ReactNode;
}

export function WidgetEmptyState({
  message = "No data available",
  icon: Icon = FileBarChart2,
  className,
  action,
}: WidgetEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center h-[300px] w-full text-center p-6 space-y-4",
        className
      )}
    >
      <div className="p-4 rounded-full bg-muted/50">
        <Icon className="h-8 w-8 text-muted-foreground/50" />
      </div>
      <div className="space-y-1 max-w-xs mx-auto">
        <p className="text-sm font-medium text-muted-foreground">{message}</p>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
