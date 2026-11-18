import React from 'react';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ErrorBoundary, ErrorFallback } from '../ErrorBoundary';

describe('ErrorBoundary', () => {
  // Suppress console.error for cleaner test output
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Child content</div>
      </ErrorBoundary>
    );
    
    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('renders error fallback when child throws', () => {
    const boundaryRef = React.createRef<ErrorBoundary>();

    render(
      <ErrorBoundary ref={boundaryRef} sectionName="Profile">
        <div>Child content</div>
      </ErrorBoundary>
    );

    act(() => {
      boundaryRef.current?.setState({
        hasError: true,
        error: new Error('Test error'),
      });
    });
    
    expect(screen.getByText('Profile failed to load')).toBeInTheDocument();
  });

  it('renders generic error message when no section name', () => {
    const boundaryRef = React.createRef<ErrorBoundary>();

    render(
      <ErrorBoundary ref={boundaryRef}>
        <div>Child content</div>
      </ErrorBoundary>
    );

    act(() => {
      boundaryRef.current?.setState({
        hasError: true,
        error: new Error('Test error'),
      });
    });
    
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders custom fallback when provided', () => {
    const boundaryRef = React.createRef<ErrorBoundary>();

    render(
      <ErrorBoundary ref={boundaryRef} fallback={<div>Custom error UI</div>}>
        <div>Child content</div>
      </ErrorBoundary>
    );

    act(() => {
      boundaryRef.current?.setState({
        hasError: true,
        error: new Error('Test error'),
      });
    });
    
    expect(screen.getByText('Custom error UI')).toBeInTheDocument();
  });

  it('calls onError callback when error occurs', () => {
    const onError = vi.fn();
    const boundaryRef = React.createRef<ErrorBoundary>();
    
    render(
      <ErrorBoundary ref={boundaryRef} onError={onError}>
        <div>Child content</div>
      </ErrorBoundary>
    );

    act(() => {
      boundaryRef.current?.componentDidCatch(
        new Error('Test error'),
        { componentStack: 'stack' } as React.ErrorInfo
      );
    });
    
    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('recovers when retry is clicked', () => {
    const boundaryRef = React.createRef<ErrorBoundary>();
    
    render(
      <ErrorBoundary ref={boundaryRef} sectionName="Test">
        <div>Recovered</div>
      </ErrorBoundary>
    );
    
    act(() => {
      boundaryRef.current?.setState({
        hasError: true,
        error: new Error('Test error'),
      });
    });

    expect(screen.getByText('Test failed to load')).toBeInTheDocument();
    
    fireEvent.click(screen.getByRole('button', { name: /retry loading/i }));
    
    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });
});

describe('ErrorFallback', () => {
  it('renders section name in title', () => {
    render(<ErrorFallback sectionName="Profile" onRetry={() => {}} />);
    
    expect(screen.getByText('Profile failed to load')).toBeInTheDocument();
  });

  it('renders generic title when no section name', () => {
    render(<ErrorFallback onRetry={() => {}} />);
    
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('calls onRetry when button is clicked', () => {
    const onRetry = vi.fn();
    render(<ErrorFallback sectionName="Test" onRetry={onRetry} />);
    
    fireEvent.click(screen.getByRole('button', { name: /retry loading/i }));
    
    expect(onRetry).toHaveBeenCalled();
  });

  it('has accessible retry button', () => {
    render(<ErrorFallback sectionName="Profile" onRetry={() => {}} />);
    
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label', 'Retry loading Profile');
  });

  it('displays user-friendly error message', () => {
    render(<ErrorFallback onRetry={() => {}} />);
    
    expect(screen.getByText(/we encountered an error/i)).toBeInTheDocument();
    expect(screen.getByText(/please try again/i)).toBeInTheDocument();
  });
});
