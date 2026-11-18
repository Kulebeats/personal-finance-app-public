/**
 * **Feature: settings-refactoring, Property 4: API Failure State Preservation**
 * **Validates: Requirements 4.4**
 * 
 * Property: For any API call that fails, the system SHALL retain the previous form values
 * and not corrupt the UI state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '@/test-utils/queryClient';
import fc from 'fast-check';
import { useProfileForm } from '../sections/ProfileSection/useProfileForm';
import React from 'react';

// Mock toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Simple alphanumeric string generator to avoid encoding issues
const safeStringArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,19}$/);

describe('Property 4: API Failure State Preservation', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // Helper to create test setup
  const createTestSetup = (initialData: Record<string, unknown>) => {
    const queryClient = createTestQueryClient({
      defaultOptions: {
        queries: { staleTime: Infinity },
      },
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );

    return { queryClient, wrapper };
  };

  // Helper to setup mock fetch
  const setupMockFetch = (initialData: Record<string, unknown>, failOnPut = true) => {
    global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      // apiCall fetches a CSRF token before every mutating request.
      if (url.includes('/csrf-token')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ csrfToken: 'test-csrf' }),
        });
      }
      if (url.includes('/api/settings/profile')) {
        if (options?.method === 'PUT') {
          if (failOnPut) {
            return Promise.resolve({
              ok: false,
              status: 500,
              json: () => Promise.resolve({ error: { message: 'Server error' } }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: { profile: initialData } }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { profile: initialData } }),
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });
  };

  it('retains form values when API update fails', async () => {
    // Generate test data upfront
    const testCases = fc.sample(safeStringArb, 10);
    
    for (const fullName of testCases) {
      const initialData = {
        fullName,
        timezone: 'Africa/Lusaka',
        incomeFrequency: 'monthly',
        birthdayHideYear: false,
      };

      const { queryClient, wrapper } = createTestSetup(initialData);
      setupMockFetch(initialData);

      const { result, unmount } = renderHook(() => useProfileForm(), { wrapper });

      await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 2000 });

      const beforeSave = result.current.form.getValues().fullName;

      await act(async () => {
        try {
          await result.current.saveProfile(result.current.form.getValues());
        } catch {
          // Expected
        }
      });

      const afterFailure = result.current.form.getValues().fullName;
      expect(afterFailure).toBe(beforeSave);

      unmount();
      queryClient.clear();
    }
  }, 60000);

  it('preserves form state across multiple failures', async () => {
    const testCases = fc.sample(safeStringArb, 10);
    
    for (const fullName of testCases) {
      const initialData = {
        fullName,
        timezone: 'Africa/Lusaka',
        incomeFrequency: 'monthly',
        birthdayHideYear: false,
      };

      const { queryClient, wrapper } = createTestSetup(initialData);
      setupMockFetch(initialData);

      const { result, unmount } = renderHook(() => useProfileForm(), { wrapper });

      await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 2000 });

      const beforeFailures = result.current.form.getValues().fullName;

      // Multiple failures
      for (let i = 0; i < 2; i++) {
        await act(async () => {
          try {
            await result.current.saveProfile(result.current.form.getValues());
          } catch {
            // Expected
          }
        });
      }

      const afterFailures = result.current.form.getValues().fullName;
      expect(afterFailures).toBe(beforeFailures);

      unmount();
      queryClient.clear();
    }
  }, 60000);

  it('maintains dirty state after API failure', async () => {
    const testCases = fc.sample(fc.tuple(safeStringArb, safeStringArb), 10);
    
    for (const [originalName, modifiedName] of testCases) {
      const finalModified = originalName === modifiedName ? modifiedName + 'X' : modifiedName;

      const initialData = {
        fullName: originalName,
        timezone: 'Africa/Lusaka',
        incomeFrequency: 'monthly',
        birthdayHideYear: false,
      };

      const { queryClient, wrapper } = createTestSetup(initialData);
      setupMockFetch(initialData);

      const { result, unmount } = renderHook(() => useProfileForm(), { wrapper });

      await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 2000 });

      // Modify
      await act(async () => {
        result.current.form.setValue('fullName', finalModified, { shouldDirty: true });
      });

      expect(result.current.isDirty).toBe(true);

      // Try to save
      await act(async () => {
        try {
          await result.current.saveProfile(result.current.form.getValues());
        } catch {
          // Expected
        }
      });

      // Still dirty and value preserved
      expect(result.current.isDirty).toBe(true);
      expect(result.current.form.getValues().fullName).toBe(finalModified);

      unmount();
      queryClient.clear();
    }
  }, 60000);

  it('preserves nested object fields on API failure', async () => {
    const testCases = fc.sample(safeStringArb, 10);
    
    for (const fullName of testCases) {
      const initialData = {
        fullName,
        timezone: 'Africa/Lusaka',
        incomeFrequency: 'monthly',
        birthdayHideYear: false,
        address: { country: 'Zambia', city: 'Lusaka' },
      };

      const { queryClient, wrapper } = createTestSetup(initialData);
      setupMockFetch(initialData);

      const { result, unmount } = renderHook(() => useProfileForm(), { wrapper });

      await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 2000 });

      const countryBefore = result.current.form.getValues().address?.country;

      await act(async () => {
        try {
          await result.current.saveProfile(result.current.form.getValues());
        } catch {
          // Expected
        }
      });

      expect(result.current.form.getValues().address?.country).toBe(countryBefore);

      unmount();
      queryClient.clear();
    }
  }, 60000);

  it('allows retry after failure without data loss', async () => {
    const testCases = fc.sample(safeStringArb, 10);
    
    for (const fullName of testCases) {
      let attemptCount = 0;
      const initialData = {
        fullName,
        timezone: 'Africa/Lusaka',
        incomeFrequency: 'monthly',
        birthdayHideYear: false,
      };

      const { queryClient, wrapper } = createTestSetup(initialData);
      
      // Custom mock for retry scenario
      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        // apiCall fetches a CSRF token before every mutating request.
        if (url.includes('/csrf-token')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ csrfToken: 'test-csrf' }),
          });
        }
        if (url.includes('/api/settings/profile')) {
          if (options?.method === 'PUT') {
            attemptCount++;
            if (attemptCount === 1) {
              return Promise.resolve({
                ok: false,
                status: 500,
                json: () => Promise.resolve({ error: { message: 'Temporary error' } }),
              });
            }
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ data: { profile: initialData } }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: { profile: initialData } }),
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const { result, unmount } = renderHook(() => useProfileForm(), { wrapper });

      await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 2000 });

      const beforeAttempts = result.current.form.getValues().fullName;

      // First attempt fails
      await act(async () => {
        try {
          await result.current.saveProfile(result.current.form.getValues());
        } catch {
          // Expected
        }
      });

      expect(result.current.form.getValues().fullName).toBe(beforeAttempts);

      // Second attempt succeeds
      await act(async () => {
        await result.current.saveProfile(result.current.form.getValues());
      });

      expect(result.current.form.getValues().fullName).toBe(beforeAttempts);

      unmount();
      queryClient.clear();
      attemptCount = 0;
    }
  }, 60000);
});
