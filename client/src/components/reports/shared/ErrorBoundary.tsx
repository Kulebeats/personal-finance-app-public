/**
 * ErrorBoundary - React error boundary with logging
 *
 * Catches rendering errors and logs them for monitoring
 */

import React, { Component, ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error to console
    console.error("[ErrorBoundary] Caught error:", {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
    });

    // Call optional error handler
    this.props.onError?.(error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="p-4 border border-destructive/50 bg-destructive/10 rounded-lg">
          <h3 className="text-sm font-medium text-destructive">
            Something went wrong
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            {this.state.error?.message || "An unexpected error occurred"}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-2 text-xs text-primary hover:underline"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Widget-specific error boundary with consistent styling
 */
interface WidgetErrorBoundaryProps {
  widgetId: string;
  children: ReactNode;
}

export function WidgetErrorBoundary({
  widgetId,
  children,
}: WidgetErrorBoundaryProps): JSX.Element {
  const handleError = (error: Error, errorInfo: ErrorInfo) => {
    console.error(`[Widget:${widgetId}] Error:`, {
      widgetId,
      error: error.message,
      componentStack: errorInfo.componentStack,
    });
  };

  return (
    <ErrorBoundary
      onError={handleError}
      fallback={
        <div className="h-[200px] flex items-center justify-center border border-dashed border-muted rounded-lg">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              Failed to load widget
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">{widgetId}</p>
          </div>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

export default ErrorBoundary;
