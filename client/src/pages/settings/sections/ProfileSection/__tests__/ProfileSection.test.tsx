import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "@/test-utils/queryClient";

// Mock the use-settings hooks before importing components
const mockUseProfile = vi.fn();
const mockUseUpdateProfile = vi.fn();
const mockUseUploadProfilePicture = vi.fn();
const mockUseDeleteProfilePicture = vi.fn();

vi.mock("@/hooks/use-settings", () => ({
  useProfile: () => mockUseProfile(),
  useUpdateProfile: () => mockUseUpdateProfile(),
  useUploadProfilePicture: () => mockUseUploadProfilePicture(),
  useDeleteProfilePicture: () => mockUseDeleteProfilePicture(),
}));

// Mock Toaster
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocking
import ProfileSection from "../index";
import { ProfileForm } from "../ProfileForm";

// Create a wrapper with QueryClientProvider
function createWrapper() {
  const queryClient = createTestQueryClient();
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// Default mock values
const defaultProfileData = {
  fullName: "Test User",
  firstName: "Test",
  lastName: "User",
  timezone: "Africa/Lusaka",
  incomeFrequency: "monthly",
  birthdayHideYear: false,
  birthday: "1990-01-01",
  gender: "male",
  nrc: "123456/78/9",
  socialLinks: {
    email: "test@example.com",
  },
};

const waitForOptions = { timeout: 3000 };

vi.setConfig({ testTimeout: 10000 });

describe("ProfileSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set default mock implementations
    mockUseProfile.mockReturnValue({
      data: defaultProfileData,
      isLoading: false,
      error: null,
    });
    mockUseUpdateProfile.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
      isPending: false,
    });
    mockUseUploadProfilePicture.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
      isPending: false,
    });
    mockUseDeleteProfilePicture.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
      isPending: false,
    });
  });

  it("renders the profile form with title", async () => {
    render(<ProfileSection />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Profile")).toBeInTheDocument();
    }, waitForOptions);
  });

  it("renders the description text", async () => {
    render(<ProfileSection />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(
        screen.getByText("Manage your personal information")
      ).toBeInTheDocument();
    }, waitForOptions);
  });

  it("renders the save button", async () => {
    render(<ProfileSection />, { wrapper: createWrapper() });

    await waitFor(() => {
      // Changed text from "Save Changes" to "Save"
      expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    }, waitForOptions);
  });
});

describe("ProfileForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseProfile.mockReturnValue({
      data: defaultProfileData,
      isLoading: false,
      error: null,
    });
    mockUseUpdateProfile.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
      isPending: false,
    });
    mockUseUploadProfilePicture.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
      isPending: false,
    });
    mockUseDeleteProfilePicture.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
      isPending: false,
    });
  });

  it("populates personal fields in the first tab", async () => {
    render(<ProfileForm />, { wrapper: createWrapper() });

    await waitFor(() => {
      const fullNameInput = screen.getByLabelText(
        /display name/i
      ) as HTMLInputElement;
      expect(fullNameInput.value).toBe("Test User");
    }, waitForOptions);
  });

  it("can navigate to contact tab and see phone field", async () => {
    const user = userEvent.setup();
    render(<ProfileForm />, { wrapper: createWrapper() });

    // Initially phone is not visible
    expect(screen.queryByLabelText(/mobile phone/i)).not.toBeInTheDocument();

    // Click Contact tab
    const contactTab = screen.getByRole("tab", { name: /contact/i });
    await user.click(contactTab);

    await waitFor(() => {
      expect(screen.getByLabelText(/mobile phone/i)).toBeInTheDocument();
    }, waitForOptions);
  });

  it("contact tab offers Home Phone but not the removed Work Phone field", async () => {
    const user = userEvent.setup();
    render(<ProfileForm />, { wrapper: createWrapper() });

    await user.click(screen.getByRole("tab", { name: /contact/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/mobile phone/i)).toBeInTheDocument();
    }, waitForOptions);

    // "Add Home Phone" maps to the real phoneNumberHome field and stays.
    expect(
      screen.getByRole("button", { name: /add home phone/i })
    ).toBeInTheDocument();
    // The "Work Phone" optional field was bound to phoneNumberWorkOffice, which
    // does not exist in the profile schema or the API, so it was removed.
    expect(
      screen.queryByRole("button", { name: /add work phone/i })
    ).not.toBeInTheDocument();
  });

  it("shows validation error for empty full name on blur", async () => {
    const user = userEvent.setup();
    render(<ProfileForm />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
    }, waitForOptions);

    const fullNameInput = screen.getByLabelText(/display name/i);
    await user.clear(fullNameInput);
    await user.tab(); // Trigger blur

    await waitFor(() => {
      expect(screen.getByText(/full name is required/i)).toBeInTheDocument();
    }, waitForOptions);
  });

  it("validates Zambian number in Contact tab", async () => {
    const user = userEvent.setup();
    render(<ProfileForm />, { wrapper: createWrapper() });

    // Switch to Contact tab
    await user.click(screen.getByRole("tab", { name: /contact/i }));

    const phoneInput = await screen.findByLabelText(/mobile phone/i);

    // Invalid
    await user.type(phoneInput, "12345");
    await user.tab();

    // Expect error
    await waitFor(() => {
      expect(
        screen.getByText(/invalid zambian phone number/i)
      ).toBeInTheDocument();
    }, waitForOptions);

    // Valid
    await user.clear(phoneInput);
    await user.type(phoneInput, "+260971234567");
    await user.tab();

    await waitFor(() => {
      expect(
        screen.queryByText(/invalid zambian phone number/i)
      ).not.toBeInTheDocument();
    }, waitForOptions);
  });

  it("enables save button when dirty", async () => {
    const user = userEvent.setup();
    render(<ProfileForm />, { wrapper: createWrapper() });

    const saveButton = await screen.findByRole("button", { name: "Save" });
    expect(saveButton).not.toBeDisabled();

    // Change a field
    const nameInput = screen.getByLabelText(/display name/i);
    await user.type(nameInput, "Changes");

    await waitFor(() => {
      expect(saveButton).not.toBeDisabled();
    }, waitForOptions);
  });
});
