import React from 'react';
import { toast } from 'sonner';
import { useLiveRegion, LiveRegionProvider } from './LiveRegion';

interface AccessibleToastOptions {
  title: string;
  description?: string;
  type?: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
  announceToScreenReader?: boolean;
}

/**
 * Accessible toast notifications that work with screen readers
 * 
 * This provides visual toast notifications while also announcing
 * the content to screen readers via aria-live regions.
 */
export function useAccessibleToast() {
  const { announce } = useLiveRegion();

  const showToast = React.useCallback(({
    title,
    description,
    type = 'info',
    duration = 4000,
    announceToScreenReader = true
  }: AccessibleToastOptions) => {
    // Show visual toast
    const toastFn = {
      success: toast.success,
      error: toast.error,
      warning: toast.warning,
      info: toast.info,
    }[type];

    toastFn(title, {
      description,
      duration,
    });

    // Announce to screen readers
    if (announceToScreenReader) {
      const message = description ? `${title}. ${description}` : title;
      const priority = type === 'error' ? 'assertive' : 'polite';
      announce(message, priority);
    }
  }, [announce]);

  return {
    success: (title: string, description?: string) => 
      showToast({ title, description, type: 'success' }),
    error: (title: string, description?: string) => 
      showToast({ title, description, type: 'error' }),
    warning: (title: string, description?: string) => 
      showToast({ title, description, type: 'warning' }),
    info: (title: string, description?: string) => 
      showToast({ title, description, type: 'info' }),
    custom: showToast,
  };
}

/**
 * Provider component that includes the live region for announcements
 */
export function AccessibleToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <LiveRegionProvider>
      {children}
    </LiveRegionProvider>
  );
}