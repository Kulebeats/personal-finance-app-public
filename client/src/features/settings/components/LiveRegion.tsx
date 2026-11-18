import React, { useEffect, useRef } from 'react';

interface LiveRegionProps {
  message: string;
  priority?: 'polite' | 'assertive';
  clearAfter?: number;
}

/**
 * LiveRegion - Announces dynamic content changes to screen readers
 * 
 * This component provides aria-live announcements for dynamic content
 * that needs to be communicated to screen readers, such as:
 * - Form submission status
 * - Loading states
 * - Success/error messages
 * - Dynamic content updates
 * 
 * @example
 * <LiveRegion 
 *   message="Settings saved successfully" 
 *   priority="polite"
 *   clearAfter={3000}
 * />
 */
export function LiveRegion({ 
  message, 
  priority = 'polite', 
  clearAfter = 5000 
}: LiveRegionProps) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (message && clearAfter > 0) {
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      
      // Set new timeout to clear message
      timeoutRef.current = setTimeout(() => {
        // Message will be cleared by parent component
      }, clearAfter);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [message, clearAfter]);

  if (!message) return null;

  return (
    <div
      aria-live={priority}
      aria-atomic="true"
      className="sr-only"
      role={priority === 'assertive' ? 'alert' : 'status'}
    >
      {message}
    </div>
  );
}

/**
 * Context for managing live region announcements
 */
const LiveRegionContext = React.createContext<{
  announce: (text: string, urgency?: 'polite' | 'assertive') => void;
  clear: () => void;
} | null>(null);

/**
 * Provider component for live region announcements
 */
export function LiveRegionProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = React.useState('');
  const [priority, setPriority] = React.useState<'polite' | 'assertive'>('polite');

  const announce = React.useCallback((
    text: string, 
    urgency: 'polite' | 'assertive' = 'polite'
  ) => {
    setPriority(urgency);
    setMessage(text);
    
    // Clear message after announcement
    setTimeout(() => setMessage(''), 100);
  }, []);

  const clear = React.useCallback(() => {
    setMessage('');
  }, []);

  return (
    <LiveRegionContext.Provider value={{ announce, clear }}>
      {children}
      <LiveRegion 
        message={message} 
        priority={priority}
        clearAfter={0}
      />
    </LiveRegionContext.Provider>
  );
}

/**
 * Hook for managing live region announcements
 */
export function useLiveRegion() {
  const context = React.useContext(LiveRegionContext);
  
  if (!context) {
    throw new Error('useLiveRegion must be used within LiveRegionProvider');
  }

  return context;
}