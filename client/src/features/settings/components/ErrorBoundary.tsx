import React, { Component } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ErrorBoundaryProps, ErrorBoundaryState } from '../types/settings';

/**
 * ErrorBoundary - Catches errors in child components
 * 
 * Provides graceful error handling with:
 * - User-friendly error message (no technical details exposed)
 * - Retry option to attempt recovery
 * - Error logging for debugging
 * - Section isolation (other sections continue working)
 * 
 * @example
 * <ErrorBoundary sectionName="Profile" onError={logError}>
 *   <ProfileSection />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log error for debugging (sanitized - no user data)
    console.error(`[ErrorBoundary${this.props.sectionName ? `: ${this.props.sectionName}` : ''}]`, {
      message: error.message,
      componentStack: errorInfo.componentStack,
    });

    // Call optional error handler
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <ErrorFallback
          sectionName={this.props.sectionName}
          onRetry={this.handleRetry}
        />
      );
    }

    return this.props.children;
  }
}

interface ErrorFallbackProps {
  sectionName?: string;
  onRetry: () => void;
}

/**
 * ErrorFallback - Default error UI component
 * 
 * Displays a user-friendly error message without exposing
 * technical details like stack traces or file paths.
 */
export function ErrorFallback({ sectionName, onRetry }: ErrorFallbackProps) {
  const title = sectionName 
    ? `${sectionName} failed to load`
    : 'Something went wrong';

  return (
    <Card className="w-full border-destructive/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" aria-hidden="true" />
          <span>{title}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          We encountered an error while loading this section. 
          Please try again or contact support if the problem persists.
        </p>
        <Button 
          onClick={onRetry}
          variant="outline"
          className="gap-2"
          aria-label={`Retry loading ${sectionName || 'section'}`}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try Again
        </Button>
      </CardContent>
    </Card>
  );
}

// Export for testing
export type { ErrorBoundaryProps, ErrorBoundaryState, ErrorFallbackProps };
