/**
 * Utility functions for managing and verifying tab order
 */

/**
 * Gets all focusable elements within a container in tab order
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const focusableSelectors = [
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'a[href]',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]'
  ].join(', ');

  const elements = Array.from(
    container.querySelectorAll<HTMLElement>(focusableSelectors)
  );

  // Sort by tabindex, then by DOM order
  return elements.sort((a, b) => {
    const aTabIndex = parseInt(a.getAttribute('tabindex') || '0');
    const bTabIndex = parseInt(b.getAttribute('tabindex') || '0');
    
    // Elements with tabindex > 0 come first
    if (aTabIndex > 0 && bTabIndex > 0) {
      return aTabIndex - bTabIndex;
    }
    if (aTabIndex > 0) return -1;
    if (bTabIndex > 0) return 1;
    
    // For elements with tabindex 0 or no tabindex, use DOM order
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}

/**
 * Verifies that tab order follows visual layout (left-to-right, top-to-bottom)
 */
export function verifyTabOrder(container: HTMLElement): {
  isValid: boolean;
  issues: string[];
} {
  const focusableElements = getFocusableElements(container);
  const issues: string[] = [];

  for (let i = 0; i < focusableElements.length - 1; i++) {
    const current = focusableElements[i];
    const next = focusableElements[i + 1];
    
    const currentRect = current.getBoundingClientRect();
    const nextRect = next.getBoundingClientRect();
    
    // Check if next element is significantly above current element
    // (allowing for small differences due to line height)
    if (nextRect.bottom < currentRect.top - 10) {
      issues.push(
        `Tab order issue: ${getElementDescription(next)} appears above ${getElementDescription(current)} but comes after in tab order`
      );
    }
    
    // Check if elements are on same row but next is significantly to the left
    if (
      Math.abs(currentRect.top - nextRect.top) < 10 && // Same row
      nextRect.right < currentRect.left - 10 // Next is to the left
    ) {
      issues.push(
        `Tab order issue: ${getElementDescription(next)} appears to the left of ${getElementDescription(current)} but comes after in tab order`
      );
    }
  }

  return {
    isValid: issues.length === 0,
    issues
  };
}

/**
 * Gets a description of an element for debugging
 */
function getElementDescription(element: HTMLElement): string {
  const tagName = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const className = element.className ? `.${element.className.split(' ')[0]}` : '';
  const text = element.textContent?.trim().substring(0, 20) || '';
  
  return `${tagName}${id}${className}${text ? ` ("${text}")` : ''}`;
}

/**
 * Hook for development mode tab order verification
 */
export function useTabOrderVerification(containerRef: React.RefObject<HTMLElement>) {
  React.useEffect(() => {
    if (process.env.NODE_ENV === 'development' && containerRef.current) {
      const verification = verifyTabOrder(containerRef.current);
      if (!verification.isValid) {
        console.warn('Tab order issues detected:', verification.issues);
      }
    }
  }, [containerRef]);
}

// Only import React in development builds
const React = process.env.NODE_ENV === 'development' ? require('react') : null;