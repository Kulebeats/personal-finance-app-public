import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface RouteErrorBoundaryProps {
  children: ReactNode;
  resetKey: string;
  routeName: string;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  constructor(props: RouteErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(`Route error in ${this.props.routeName}:`, error, errorInfo);
  }

  componentDidUpdate(prevProps: RouteErrorBoundaryProps): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleGoHome = () => {
    window.location.href = "/";
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const errorDetails = import.meta.env.DEV ? this.state.error : null;

    return (
      <div className="min-h-screen w-full bg-background p-4">
        <div className="mx-auto flex min-h-[70vh] max-w-lg items-center justify-center">
          <Card className="w-full border-destructive/40 shadow-lg">
            <CardHeader className="text-center pb-2">
              <div className="mx-auto mb-2 w-fit rounded-full bg-destructive/10 p-3">
                <AlertTriangle className="h-7 w-7 text-destructive" />
              </div>
              <CardTitle className="text-xl">
                {this.props.routeName} did not load
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                Refresh this page section or return to the dashboard.
              </p>
              {errorDetails && (
                <div className="max-h-32 overflow-auto rounded bg-muted p-2 text-left font-mono text-xs">
                  {errorDetails.toString()}
                </div>
              )}
              <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-center">
                <Button
                  type="button"
                  variant="outline"
                  onClick={this.handleGoHome}
                  className="gap-2"
                >
                  <Home className="h-4 w-4" />
                  Dashboard
                </Button>
                <Button
                  type="button"
                  onClick={this.handleRetry}
                  className="gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Retry
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }
}
