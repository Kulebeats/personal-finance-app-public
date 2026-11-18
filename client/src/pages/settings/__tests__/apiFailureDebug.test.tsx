/**
 * Debug test to understand why form values are changing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '@/test-utils/queryClient';
import { useProfileForm } from '../sections/ProfileSection/useProfileForm';
import React from 'react';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('API Failure Debug', () => {
  let queryClient: ReturnType<typeof createTestQueryClient>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );

  it('debugs form value changes', async () => {
    const testData = {
      fullName: '!',
      timezone: 'Africa/Lusaka',
      incomeFrequency: 'monthly' as const,
      birthdayHideYear: false,
    };

    const fetchCalls: string[] = [];

    // Mock successful initial fetch
    global.fetch = vi.fn().mockImplementation((url: string) => {
      fetchCalls.push(url);
      if (url.includes('/api/settings/profile') && !url.includes('update')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { profile: testData } }),
        });
      }
      // Mock failed update
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal server error' }),
      });
    });

    const { result } = renderHook(() => useProfileForm(), { wrapper });

    // Wait for initial data to load
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    }, { timeout: 2000 });

    const fullNameBefore = result.current.form.getValues().fullName;

    // Attempt to save (which will fail)
    try {
      const valuesToSave = result.current.form.getValues();
      await result.current.saveProfile(valuesToSave);
    } catch (error) {
      expect(error).toBeDefined();
    }

    // Wait for mutation to complete
    await waitFor(() => {
      expect(result.current.isSubmitting).toBe(false);
    }, { timeout: 2000 });

    const fullNameAfter = result.current.form.getValues().fullName;

    expect(fetchCalls).toContain('/api/settings/profile');
    expect(fetchCalls).toContain('/api/csrf-token');

    expect(fullNameAfter).toBe(fullNameBefore);
  });
});
