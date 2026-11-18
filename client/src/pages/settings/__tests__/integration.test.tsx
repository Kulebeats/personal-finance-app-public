/// <reference types="vitest/globals" />
/**
 * Integration Tests for Settings Page
 * 
 * Tests complete user workflows and end-to-end scenarios including:
 * - Profile save and retrieve workflows
 * - Section isolation on error
 * - Multi-section navigation
 * - Form state persistence across navigation
 * 
 * Requirements: 9.3 - Integration tests for form submission flows
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '@/test-utils/queryClient';

// Mock toast - must be before imports that use it
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { 
  MockSettingsPage as SettingsPage,
  mockProfileApi,
  mockCategoriesApi,
  mockMerchantsApi
} from './mocks/MockSettingsPage';

// Get reference to mocked toast
const mockToast = vi.mocked(await import('sonner')).toast;

// Test wrapper component
function TestWrapper({ children }: { children: React.ReactNode }) {
  const queryClient = createTestQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

const waitForOptions = { timeout: 3000 };

describe('Settings Page Integration Tests', () => {
  let getProfileSpy: any;
  let updateProfileSpy: any;
  let getCategoriesSpy: any;
  let getMerchantsSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Spy on API methods
    getProfileSpy = vi.spyOn(mockProfileApi, 'getProfile');
    updateProfileSpy = vi.spyOn(mockProfileApi, 'updateProfile');
    getCategoriesSpy = vi.spyOn(mockCategoriesApi, 'getCategories');
    getMerchantsSpy = vi.spyOn(mockMerchantsApi, 'getMerchants');
    
    // Default API responses
    getProfileSpy.mockResolvedValue({
      id: 1,
      fullName: 'John Doe',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      timezone: 'Africa/Lusaka',
      phoneNumberMobile: '+260971234567',
      occupation: 'Developer',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    getCategoriesSpy.mockResolvedValue([
      { id: 1, name: 'Food', color: '#FF5733', icon: '🍔', groupId: 1, isArchived: false },
      { id: 2, name: 'Transport', color: '#33FF57', icon: '🚗', groupId: 1, isArchived: false },
    ]);

    getMerchantsSpy.mockResolvedValue([
      { id: 1, name: 'Shoprite', categoryId: 1, isArchived: false },
      { id: 2, name: 'Shell', categoryId: 2, isArchived: false },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Profile Save and Retrieve Workflow', () => {
    it('should save profile data and retrieve the same values', async () => {
      const user = userEvent.setup();
      
      // Mock successful save
      updateProfileSpy.mockResolvedValue({
        id: 1,
        fullName: 'Jane Smith',
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@example.com',
        timezone: 'Africa/Lusaka',
        phoneNumberMobile: '+260977654321',
        occupation: 'Designer',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      render(
        <TestWrapper>
          <SettingsPage defaultSection="profile" />
        </TestWrapper>
      );

      // Wait for profile section to load
      await waitFor(() => {
        expect(screen.getByDisplayValue('John Doe')).toBeInTheDocument();
      }, waitForOptions);

      // Update profile fields
      const fullNameInput = screen.getByDisplayValue('John Doe');
      await user.clear(fullNameInput);
      await user.type(fullNameInput, 'Jane Smith');

      const phoneInput = screen.getByDisplayValue('+260971234567');
      await user.clear(phoneInput);
      await user.type(phoneInput, '+260977654321');

      const occupationInput = screen.getByDisplayValue('Developer');
      await user.clear(occupationInput);
      await user.type(occupationInput, 'Designer');

      // Save the form
      const saveButton = screen.getByRole('button', { name: /save/i });
      await user.click(saveButton);

      // Verify API was called with correct data
      await waitFor(() => {
        expect(updateProfileSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            fullName: 'Jane Smith',
            phoneNumberMobile: '+260977654321',
            occupation: 'Designer',
          })
        );
      }, waitForOptions);

      // Verify success toast
      expect(mockToast.success).toHaveBeenCalledWith('Profile updated successfully');
    });

    it('should handle profile save errors gracefully', async () => {
      const user = userEvent.setup();
      
      // Mock API error
      updateProfileSpy.mockRejectedValue(new Error('Network error'));

      render(
        <TestWrapper>
          <SettingsPage defaultSection="profile" />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByDisplayValue('John Doe')).toBeInTheDocument();
      }, waitForOptions);

      // Update a field
      const fullNameInput = screen.getByDisplayValue('John Doe');
      await user.clear(fullNameInput);
      await user.type(fullNameInput, 'Updated Name');

      // Attempt to save
      const saveButton = screen.getByRole('button', { name: /save/i });
      await user.click(saveButton);

      // Verify error handling
      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Failed to update profile');
      }, waitForOptions);

      // Verify form retains the updated value
      expect(screen.getByDisplayValue('Updated Name')).toBeInTheDocument();
    });
  });

  describe('Section Isolation on Error', () => {
    it('should maintain other sections when one section fails', async () => {
      const user = userEvent.setup();

      // Mock categories API failure
      getCategoriesSpy.mockRejectedValue(new Error('Categories API failed'));

      render(
        <TestWrapper>
          <SettingsPage />
        </TestWrapper>
      );

      // Profile section should still work
      await waitFor(() => {
        expect(screen.getByDisplayValue('John Doe')).toBeInTheDocument();
      });

      // Navigate to categories section
      const categoriesLink = screen.getByRole('link', { name: /categories/i });
      await user.click(categoriesLink);

      // Categories section should show error boundary
      await waitFor(() => {
        expect(screen.getByText(/Categories failed to load/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
      });

      // Navigate back to profile - should still work
      const profileLink = screen.getByRole('link', { name: /profile/i });
      await user.click(profileLink);

      await waitFor(() => {
        expect(screen.getByDisplayValue('John Doe')).toBeInTheDocument();
      });

      // Navigate to merchants - should work independently
      const merchantsLink = screen.getByRole('link', { name: /merchants/i });
      await user.click(merchantsLink);

      await waitFor(() => {
        expect(screen.getByText('Shoprite')).toBeInTheDocument();
        expect(screen.getByText('Shell')).toBeInTheDocument();
      });
    });

    it('should allow retry after section error', async () => {
      const user = userEvent.setup();
      
      // Mock initial failure, then success
      getCategoriesSpy
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce([
          { id: 1, name: 'Food', color: '#FF5733', icon: '🍔', groupId: 1, isArchived: false },
        ]);

      render(
        <TestWrapper>
          <SettingsPage defaultSection="categories" />
        </TestWrapper>
      );

      // Should show error boundary
      await waitFor(() => {
        expect(screen.getByText(/Categories failed to load/i)).toBeInTheDocument();
      });

      // Click retry
      const retryButton = screen.getByRole('button', { name: /retry/i });
      await user.click(retryButton);

      // Should now show categories
      await waitFor(() => {
        expect(screen.getByText('Food')).toBeInTheDocument();
      });
    });
  });

  describe('Multi-Section Navigation', () => {
    it('should navigate between sections without losing state', async () => {
      const user = userEvent.setup();

      render(
        <TestWrapper>
          <SettingsPage />
        </TestWrapper>
      );

      // Start in profile section
      await waitFor(() => {
        expect(screen.getByDisplayValue('John Doe')).toBeInTheDocument();
      });

      // Modify profile without saving
      const fullNameInput = screen.getByDisplayValue('John Doe');
      await user.clear(fullNameInput);
      await user.type(fullNameInput, 'Modified Name');

      // Navigate to categories
      const categoriesLink = screen.getByRole('link', { name: /categories/i });
      fireEvent.click(categoriesLink);

      await waitFor(() => {
        expect(screen.getByText('Food')).toBeInTheDocument();
      });

      // Navigate back to profile
      const profileLink = screen.getByRole('link', { name: /profile/i });
      fireEvent.click(profileLink);

      // Form should retain the modified value (unsaved changes)
      await waitFor(() => {
        expect(screen.getByDisplayValue('Modified Name')).toBeInTheDocument();
      });
    });

    it('should show active section in navigation', async () => {
      render(
        <TestWrapper>
          <SettingsPage defaultSection="merchants" />
        </TestWrapper>
      );

      // Merchants section should be active
      await waitFor(() => {
        const merchantsLink = screen.getByRole('link', { name: /merchants/i });
        expect(merchantsLink).toHaveClass('active');
      });

      // Navigate to profile
      const profileLink = screen.getByRole('link', { name: /profile/i });
      fireEvent.click(profileLink);

      await waitFor(() => {
        expect(profileLink).toHaveClass('active');
        const merchantsLink = screen.getByRole('link', { name: /merchants/i });
        expect(merchantsLink).not.toHaveClass('active');
      });
    });
  });

  describe('Form State Persistence', () => {
    it('should preserve form changes during navigation', async () => {
      const user = userEvent.setup();

      render(
        <TestWrapper>
          <SettingsPage defaultSection="profile" />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByDisplayValue('John Doe')).toBeInTheDocument();
      });

      // Make changes to multiple fields
      const fullNameInput = screen.getByDisplayValue('John Doe');
      await user.clear(fullNameInput);
      await user.type(fullNameInput, 'Changed Name');

      const occupationInput = screen.getByDisplayValue('Developer');
      await user.clear(occupationInput);
      await user.type(occupationInput, 'Changed Occupation');

      // Navigate away and back
      const categoriesLink = screen.getByRole('link', { name: /categories/i });
      fireEvent.click(categoriesLink);

      await waitFor(() => {
        expect(screen.getByText('Food')).toBeInTheDocument();
      });

      const profileLink = screen.getByRole('link', { name: /profile/i });
      fireEvent.click(profileLink);

      // All changes should be preserved
      await waitFor(() => {
        expect(screen.getByDisplayValue('Changed Name')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Changed Occupation')).toBeInTheDocument();
      });
    });

    it('should show dirty state indicator when form has unsaved changes', async () => {
      const user = userEvent.setup();

      render(
        <TestWrapper>
          <SettingsPage defaultSection="profile" />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByDisplayValue('John Doe')).toBeInTheDocument();
      });

      // Initially no dirty indicator
      expect(screen.queryByText(/unsaved changes/i)).not.toBeInTheDocument();

      // Make a change
      const fullNameInput = screen.getByDisplayValue('John Doe');
      await user.clear(fullNameInput);
      await user.type(fullNameInput, 'Modified');

      // Should show dirty indicator
      await waitFor(() => {
        expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
      });
    });
  });

  describe('Loading States', () => {
    it('should show independent loading states for each section', async () => {
      // Mock delayed responses
      getProfileSpy.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({
          id: 1,
          fullName: 'John Doe',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          timezone: 'Africa/Lusaka',
          phoneNumberMobile: '+260971234567',
          occupation: 'Developer',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }), 100))
      );

      getCategoriesSpy.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve([]), 200))
      );

      render(
        <TestWrapper>
          <SettingsPage />
        </TestWrapper>
      );

      // Should show loading skeleton for profile
      expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();

      // Wait for profile to load
      await waitFor(() => {
        expect(screen.getByDisplayValue('John Doe')).toBeInTheDocument();
      });

      // Navigate to categories
      const categoriesLink = screen.getByRole('link', { name: /categories/i });
      fireEvent.click(categoriesLink);

      // Should show loading for categories
      await waitFor(() => {
        expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
      });

      // Wait for categories to load
      await waitFor(() => {
        expect(screen.queryByTestId('loading-skeleton')).not.toBeInTheDocument();
      }, { timeout: 300 });
    });
  });

  describe('Error Recovery', () => {
    it('should recover from network errors on retry', async () => {
      const user = userEvent.setup();
      
      // Mock network failure followed by success
      updateProfileSpy
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          id: 1,
          fullName: 'Recovered Name',
          firstName: 'Recovered',
          lastName: 'Name',
          email: 'recovered@example.com',
          timezone: 'Africa/Lusaka',
          phoneNumberMobile: '+260971234567',
          occupation: 'Developer',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

      render(
        <TestWrapper>
          <SettingsPage defaultSection="profile" />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByDisplayValue('John Doe')).toBeInTheDocument();
      });

      // Make a change and save
      const fullNameInput = screen.getByDisplayValue('John Doe');
      await user.clear(fullNameInput);
      await user.type(fullNameInput, 'Recovered Name');

      const saveButton = screen.getByRole('button', { name: /save/i });
      await user.click(saveButton);

      // Should show error
      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Failed to update profile');
      });

      // Retry save
      await user.click(saveButton);

      // Should succeed on retry
      await waitFor(() => {
        expect(mockToast.success).toHaveBeenCalledWith('Profile updated successfully');
      });
    });
  });
});
