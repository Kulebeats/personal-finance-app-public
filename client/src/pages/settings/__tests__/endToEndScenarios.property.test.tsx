/// <reference types="vitest/globals" />
/**
 * Property-Based Tests for End-to-End User Scenarios
 *
 * **Feature: settings-refactoring, Property 20: End-to-End User Workflow Integrity**
 *
 * Tests that complete user workflows maintain data integrity and state consistency
 * across navigation, form submissions, and error recovery scenarios.
 *
 * Requirements: 9.3 - Integration tests for form submission flows
 */

import React from "react";
import { vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "@/test-utils/queryClient";
import fc from "fast-check";

import {
  MockSettingsPage as SettingsPage,
  mockProfileApi,
  mockCategoriesApi,
  mockMerchantsApi,
} from "./mocks/MockSettingsPage";

const propertyRunConfig = { numRuns: 3 };
const propertyTestTimeoutMs = 30000;

// Mock toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Test wrapper component
function TestWrapper({ children }: { children: React.ReactNode }) {
  const queryClient = createTestQueryClient();

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// Generators for test data
const safeNameArb = fc.string({
  minLength: 1,
  maxLength: 100,
  unit: fc.constantFrom(
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  ),
});

const safeShortNameArb = fc.string({
  minLength: 1,
  maxLength: 50,
  unit: fc.constantFrom(
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  ),
});

const validProfileDataArb = fc.record({
  // The other generated fields are alphanumeric, email or phone text and never contain a space, so
  // a space-bearing full name can never equal another field. Without it fast-check sometimes
  // produced the same value (e.g. "bind") for fullName and firstName, and getByDisplayValue
  // found two inputs.
  fullName: safeShortNameArb.map((name) => `${name} Full`),
  firstName: fc.option(safeNameArb, { nil: undefined }),
  lastName: fc.option(safeNameArb, { nil: undefined }),
  email: fc.emailAddress(),
  timezone: fc.constantFrom("Africa/Lusaka", "UTC", "America/New_York"),
  phoneNumberMobile: fc.option(
    fc
      .integer({ min: 0, max: 999999999 })
      .map((value) => `+260${value.toString().padStart(9, "0")}`),
    { nil: undefined }
  ),
  occupation: fc.option(safeNameArb, { nil: undefined }),
});

const categoryDataArb = fc.record({
  id: fc.nat(),
  name: safeNameArb,
  color: fc
    .string({ minLength: 6, maxLength: 6 })
    .map((s) => `#${s.replace(/[^0-9a-fA-F]/g, "0").padEnd(6, "0")}`),
  icon: fc.constantFrom("🍔", "🚗", "🏠", "💰", "🎮"),
  groupId: fc.nat({ max: 10 }),
  isArchived: fc.boolean(),
});

const merchantDataArb = fc.record({
  id: fc.nat(),
  name: safeNameArb,
  categoryId: fc.nat(),
  isArchived: fc.boolean(),
});

const sectionNamesArb = fc.constantFrom(
  "profile",
  "categories",
  "merchants",
  "display",
  "notifications",
  "security"
);

describe("Property 20: End-to-End User Workflow Integrity", () => {
  let getProfileSpy: any;
  let updateProfileSpy: any;
  let getCategoriesSpy: any;
  let getMerchantsSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Spy on API methods
    getProfileSpy = vi.spyOn(mockProfileApi, "getProfile");
    updateProfileSpy = vi.spyOn(mockProfileApi, "updateProfile");
    getCategoriesSpy = vi.spyOn(mockCategoriesApi, "getCategories");
    getMerchantsSpy = vi.spyOn(mockMerchantsApi, "getMerchants");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    "maintains form data integrity across navigation sequences",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          validProfileDataArb,
          fc.array(sectionNamesArb, { minLength: 2, maxLength: 5 }),
          async (profileData, navigationSequence) => {
            try {
              // Setup API mocks
              getProfileSpy.mockResolvedValue({
                id: 1,
                ...profileData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });

              getCategoriesSpy.mockResolvedValue([]);
              getMerchantsSpy.mockResolvedValue([]);

              const user = userEvent.setup();

              render(
                <TestWrapper>
                  <SettingsPage defaultSection="profile" />
                </TestWrapper>
              );

              // Wait for initial load
              await waitFor(() => {
                expect(
                  screen.getByDisplayValue(profileData.fullName)
                ).toBeInTheDocument();
              });

              // Modify the profile data
              const modifiedName = `Modified ${profileData.fullName}`;
              const fullNameInput = screen.getByDisplayValue(
                profileData.fullName
              );
              await user.clear(fullNameInput);
              await user.type(fullNameInput, modifiedName);

              // Navigate through the sequence
              for (const section of navigationSequence) {
                const sectionLink = screen.getByRole("link", {
                  name: new RegExp(section, "i"),
                });
                fireEvent.click(sectionLink);

                // Wait for section to load
                await waitFor(() => {
                  expect(sectionLink).toHaveClass("active");
                });
              }

              // Navigate back to profile
              const profileLink = screen.getByRole("link", {
                name: /profile/i,
              });
              fireEvent.click(profileLink);

              // Verify data integrity - modified data should be preserved
              await waitFor(() => {
                const nameInput = screen.getByDisplayValue(modifiedName);
                expect(nameInput).toBeInTheDocument();
              });

              return true;
            } finally {
              cleanup();
            }
          }
        ),
        propertyRunConfig
      );
    },
    propertyTestTimeoutMs
  );

  it(
    "handles API failures gracefully without corrupting application state",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          validProfileDataArb,
          fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }),
          async (profileData, failurePattern) => {
            try {
              updateProfileSpy.mockClear();

              // Setup API mocks with intermittent failures
              let callCount = 0;
              updateProfileSpy.mockImplementation(() => {
                const shouldFail =
                  failurePattern[callCount % failurePattern.length];
                callCount++;

                if (shouldFail) {
                  return Promise.reject(new Error("Simulated API failure"));
                }

                return Promise.resolve({
                  id: 1,
                  ...profileData,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                });
              });

              getProfileSpy.mockResolvedValue({
                id: 1,
                ...profileData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });

              const user = userEvent.setup();

              render(
                <TestWrapper>
                  <SettingsPage defaultSection="profile" />
                </TestWrapper>
              );

              await waitFor(() => {
                expect(
                  screen.getByDisplayValue(profileData.fullName)
                ).toBeInTheDocument();
              });

              // Attempt multiple saves with potential failures
              for (let i = 0; i < Math.min(failurePattern.length, 3); i++) {
                const saveButton = screen.getByRole("button", {
                  name: /save/i,
                });
                await user.click(saveButton);

                // Wait for operation to complete (success or failure)
                await waitFor(() => {
                  expect(saveButton).not.toBeDisabled();
                });

                // Verify form data is still intact regardless of API result
                expect(
                  screen.getByDisplayValue(profileData.fullName)
                ).toBeInTheDocument();
              }

              return true;
            } finally {
              cleanup();
            }
          }
        ),
        propertyRunConfig
      );
    },
    propertyTestTimeoutMs
  );

  it(
    "preserves section isolation during concurrent operations",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(categoryDataArb, { minLength: 1, maxLength: 10 }),
          fc.array(merchantDataArb, { minLength: 1, maxLength: 10 }),
          fc.array(fc.boolean(), { minLength: 2, maxLength: 2 }),
          async (
            categories,
            merchants,
            [categoriesFailure, merchantsFailure]
          ) => {
            let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
            try {
              getCategoriesSpy.mockClear();
              getMerchantsSpy.mockClear();

              // Suppress console errors for expected failures
              consoleErrorSpy = vi
                .spyOn(console, "error")
                .mockImplementation(() => {});

              // Setup API mocks with selective failures
              getCategoriesSpy.mockImplementation(() =>
                categoriesFailure
                  ? Promise.reject(new Error("Categories API failed"))
                  : Promise.resolve(categories)
              );

              getMerchantsSpy.mockImplementation(() =>
                merchantsFailure
                  ? Promise.reject(new Error("Merchants API failed"))
                  : Promise.resolve(merchants)
              );

              getProfileSpy.mockResolvedValue({
                id: 1,
                fullName: "Test User",
                email: "test@example.com",
                timezone: "Africa/Lusaka",
                phoneNumberMobile: "+260971234567",
                occupation: "Developer",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });

              render(
                <TestWrapper>
                  <SettingsPage />
                </TestWrapper>
              );

              // Profile should always work (not mocked to fail)
              await waitFor(() => {
                expect(
                  screen.getByDisplayValue("Test User")
                ).toBeInTheDocument();
              });

              // Navigate to categories
              const categoriesLink = screen.getByRole("link", {
                name: /categories/i,
              });
              fireEvent.click(categoriesLink);

              if (categoriesFailure) {
                // Should show error boundary
                await waitFor(() => {
                  expect(
                    screen.getByText(/Categories failed to load/i)
                  ).toBeInTheDocument();
                });
              } else {
                // Should show categories
                await waitFor(() => {
                  expect(
                    screen.getAllByText(categories[0].name).length
                  ).toBeGreaterThan(0);
                });
              }

              // Navigate to merchants
              const merchantsLink = screen.getByRole("link", {
                name: /merchants/i,
              });
              fireEvent.click(merchantsLink);

              if (merchantsFailure) {
                // Should show error boundary
                await waitFor(() => {
                  expect(
                    screen.getByText(/Merchants failed to load/i)
                  ).toBeInTheDocument();
                });
              } else {
                // Should show merchants
                await waitFor(() => {
                  expect(
                    screen.getAllByText(merchants[0].name).length
                  ).toBeGreaterThan(0);
                });
              }

              // Navigate back to profile - should still work regardless of other failures
              const profileLink = screen.getByRole("link", {
                name: /profile/i,
              });
              fireEvent.click(profileLink);

              await waitFor(() => {
                expect(
                  screen.getByDisplayValue("Test User")
                ).toBeInTheDocument();
              });

              return true;
            } finally {
              if (consoleErrorSpy) consoleErrorSpy.mockRestore();
              cleanup();
            }
          }
        ),
        propertyRunConfig
      );
    },
    propertyTestTimeoutMs
  );

  it(
    "maintains consistent loading states across section transitions",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(sectionNamesArb, { minLength: 3, maxLength: 6 }),
          fc.array(fc.nat({ max: 500 }), { minLength: 3, maxLength: 6 }),
          async (sections, delays) => {
            try {
              // Setup delayed API responses
              getProfileSpy.mockImplementation(
                () =>
                  new Promise((resolve) =>
                    setTimeout(
                      () =>
                        resolve({
                          id: 1,
                          fullName: "Test User",
                          email: "test@example.com",
                          timezone: "Africa/Lusaka",
                          phoneNumberMobile: "+260971234567",
                          occupation: "Developer",
                          createdAt: new Date().toISOString(),
                          updatedAt: new Date().toISOString(),
                        }),
                      delays[0] || 0
                    )
                  )
              );

              getCategoriesSpy.mockImplementation(
                () =>
                  new Promise((resolve) =>
                    setTimeout(() => resolve([]), delays[1] || 0)
                  )
              );

              getMerchantsSpy.mockImplementation(
                () =>
                  new Promise((resolve) =>
                    setTimeout(() => resolve([]), delays[2] || 0)
                  )
              );

              render(
                <TestWrapper>
                  <SettingsPage />
                </TestWrapper>
              );

              const sectionsWithLoading = new Set([
                "profile",
                "categories",
                "merchants",
              ]);
              const visitedSections = new Set(["profile"]);

              let currentSection = "profile";
              // Navigate through sections rapidly
              for (let i = 0; i < Math.min(sections.length, 3); i++) {
                const section = sections[i];
                const sectionLink = screen.getByRole("link", {
                  name: new RegExp(section, "i"),
                });
                fireEvent.click(sectionLink);

                if (section !== currentSection) {
                  await waitFor(() => {
                    expect(sectionLink).toHaveClass("active");
                  });
                }

                // Should show loading state immediately on first visit
                if (
                  section !== currentSection &&
                  delays[i] > 50 &&
                  sectionsWithLoading.has(section) &&
                  !visitedSections.has(section)
                ) {
                  await waitFor(() => {
                    expect(
                      screen.getByTestId("loading-skeleton")
                    ).toBeInTheDocument();
                  });
                }

                visitedSections.add(section);
                currentSection = section;
              }

              // Wait for all operations to complete
              await waitFor(
                () => {
                  expect(
                    screen.queryByTestId("loading-skeleton")
                  ).not.toBeInTheDocument();
                },
                { timeout: Math.max(...delays) + 1000 }
              );

              return true;
            } finally {
              cleanup();
            }
          }
        ),
        propertyRunConfig
      );
    },
    propertyTestTimeoutMs
  );

  it(
    "recovers correctly from error states through user interaction",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          validProfileDataArb,
          fc.integer({ min: 1, max: 3 }),
          async (profileData, retryAttempts) => {
            try {
              updateProfileSpy.mockClear();

              let attemptCount = 0;

              // Mock API to fail initially, then succeed
              updateProfileSpy.mockImplementation(() => {
                attemptCount++;
                if (attemptCount <= retryAttempts) {
                  return Promise.reject(new Error("Temporary failure"));
                }
                return Promise.resolve({
                  id: 1,
                  ...profileData,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                });
              });

              getProfileSpy.mockResolvedValue({
                id: 1,
                ...profileData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });

              const user = userEvent.setup();

              render(
                <TestWrapper>
                  <SettingsPage defaultSection="profile" />
                </TestWrapper>
              );

              await waitFor(() => {
                expect(
                  screen.getByDisplayValue(profileData.fullName)
                ).toBeInTheDocument();
              });

              // Attempt saves until success
              for (let i = 0; i <= retryAttempts; i++) {
                const saveButton = screen.getByRole("button", {
                  name: /save/i,
                });
                await user.click(saveButton);

                await waitFor(() => {
                  expect(updateProfileSpy).toHaveBeenCalledTimes(i + 1);
                });

                await waitFor(() => {
                  expect(
                    screen.getByRole("button", { name: /save/i })
                  ).not.toBeDisabled();
                });
              }

              // Final attempt should succeed
              expect(updateProfileSpy).toHaveBeenCalledTimes(retryAttempts + 1);

              // Form should still be functional
              expect(
                screen.getByDisplayValue(profileData.fullName)
              ).toBeInTheDocument();

              return true;
            } finally {
              cleanup();
            }
          }
        ),
        propertyRunConfig
      );
    },
    propertyTestTimeoutMs
  );

  it(
    "maintains data consistency during rapid user interactions",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(safeShortNameArb, { minLength: 2, maxLength: 5 }),
          async (nameSequence) => {
            try {
              getProfileSpy.mockResolvedValue({
                id: 1,
                fullName: nameSequence[0],
                email: "test@example.com",
                timezone: "Africa/Lusaka",
                phoneNumberMobile: "+260971234567",
                occupation: "Developer",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });

              updateProfileSpy.mockImplementation((data: any) =>
                Promise.resolve({
                  id: 1,
                  ...data,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                })
              );

              const user = userEvent.setup();

              render(
                <TestWrapper>
                  <SettingsPage defaultSection="profile" />
                </TestWrapper>
              );

              await waitFor(() => {
                expect(
                  screen.getByDisplayValue(nameSequence[0])
                ).toBeInTheDocument();
              });

              // Rapidly change the name multiple times
              const fullNameInput = screen.getByDisplayValue(nameSequence[0]);

              for (let i = 1; i < nameSequence.length; i++) {
                await user.clear(fullNameInput);
                await user.type(fullNameInput, nameSequence[i]);
              }

              // Final value should be the last one typed
              const finalName = nameSequence[nameSequence.length - 1];
              await waitFor(() => {
                expect(screen.getByDisplayValue(finalName)).toBeInTheDocument();
              });

              return true;
            } finally {
              cleanup();
            }
          }
        ),
        propertyRunConfig
      );
    },
    propertyTestTimeoutMs
  );
});
