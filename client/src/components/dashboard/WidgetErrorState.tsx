import { AlertCircle, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface WidgetErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * Reusable error state component for dashboard widgets.
 * Displays a user-friendly error message with optional retry functionality.
 */
export function WidgetErrorState({
  title = "Unable to load data",
  message = "Something went wrong. Please try again.",
  onRetry,
  className,
}: WidgetErrorStateProps) {
  return (
    <Card className={className}>
      {/* role="alert" (WCAG 2.1 AA): announce the failure to assistive tech
          as soon as it renders instead of leaving screen-reader users to
          discover a silently blank/failed widget or page section. */}
      <CardContent
        role="alert"
        className="flex flex-col items-center justify-center h-full min-h-[200px] p-6 text-center"
      >
        <AlertCircle className="h-10 w-10 text-destructive mb-3" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-foreground mb-1">{title}</h3>
        <p className="text-xs text-muted-foreground mb-4 max-w-[200px]">
          {message}
        </p>
        {onRetry && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="gap-2"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Try again
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default WidgetErrorState;
