import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("Uncaught error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
          <Card className="w-full max-w-md border-destructive/50 shadow-lg">
            <CardHeader className="text-center pb-2">
              <div className="mx-auto bg-destructive/10 p-3 rounded-full w-fit mb-2">
                <AlertTriangle className="h-8 w-8 text-destructive" />
              </div>
              <CardTitle className="text-xl">Something went wrong</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                An unexpected error occurred. We've logged this issue and
                notified our team.
              </p>
              {this.state.error && (
                <div className="bg-muted p-2 rounded text-xs font-mono text-left overflow-auto max-h-32">
                  {this.state.error.toString()}
                </div>
              )}
              <div className="flex gap-2 justify-center pt-2">
                <Button
                  variant="outline"
                  onClick={this.handleGoHome}
                  className="gap-2"
                >
                  <Home className="h-4 w-4" />
                  Go Home
                </Button>
                <Button onClick={this.handleReload} className="gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Reload Page
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
