import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "@/test-utils/queryClient";
import { toast } from "sonner";

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

  it("opens the Contact tab when NRC is empty and every required field is filled", async () => {
    const user = userEvent.setup();
    mockUseProfile.mockReturnValue({ data: { ...defaultProfileData, nrc: "" }, isLoading: false, error: null });
    render(<ProfileForm />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByLabelText(/display name/i)).toHaveValue("Test User"));
    // AH-07: NRC is collected (NRC_FIELD_MODE "editable").
    expect(screen.getByLabelText(/national registration card/i)).toBeEnabled();
    await user.click(screen.getByRole("tab", { name: /contact/i }));

    await waitFor(() => expect(screen.getByRole("tab", { name: /contact/i })).toHaveAttribute("data-state", "active"));
    expect(screen.getByLabelText(/mobile phone/i)).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
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

  it("reports and focuses a missing required field on the first Save before blur", async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockResolvedValue({});
    mockUseProfile.mockReturnValue({ data: { ...defaultProfileData, gender: null }, isLoading: false, error: null });
    mockUseUpdateProfile.mockReturnValue({ mutateAsync, isPending: false });
    render(<ProfileForm />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByLabelText(/display name/i)).toHaveValue("Test User"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Profile update failed", {
      description: expect.stringContaining("Gender"),
    }));
    expect(screen.getByRole("tab", { name: /personal/i })).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Gender is required")).toHaveAttribute("role", "alert");
    expect(screen.getByLabelText(/gender/i)).toHaveFocus();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("selects and focuses the tab containing a newly discovered invalid field", async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockResolvedValue({});
    mockUseProfile.mockReturnValue({ data: { ...defaultProfileData, employmentStatus: "invalid" }, isLoading: false, error: null });
    mockUseUpdateProfile.mockReturnValue({ mutateAsync, isPending: false });
    render(<ProfileForm />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByLabelText(/display name/i)).toHaveValue("Test User"));
    await user.click(screen.getByRole("tab", { name: /contact/i }));
    expect(screen.getByRole("tab", { name: /contact/i })).toHaveAttribute("data-state", "active");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("tab", { name: /financial/i })).toHaveAttribute("data-state", "active"));
    expect(screen.getByLabelText(/employment status/i)).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent(/invalid/i);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("saves a valid profile exactly once", async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockResolvedValue({});
    mockUseUpdateProfile.mockReturnValue({ mutateAsync, isPending: false });
    render(<ProfileForm />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByLabelText(/display name/i)).toHaveValue("Test User"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith("Profile updated successfully");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("keeps unsaved edits when a picture upload refreshes the profile", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ProfileForm />, { wrapper: createWrapper() });

    const nameInput = await screen.findByLabelText(/display name/i);
    await waitFor(() => expect(nameInput).toHaveValue("Test User"));
    await user.clear(nameInput);
    await user.type(nameInput, "Edited Before Upload");

    // A picture upload writes the new profile into the ["profile"] query,
    // which hands the form a fresh profile object.
    mockUseProfile.mockReturnValue({
      data: { ...defaultProfileData, profilePictureUrl: "/uploads/profiles/new.png" },
      isLoading: false,
      error: null,
    });
    rerender(<ProfileForm />);

    await waitFor(() => expect(screen.getByLabelText(/display name/i)).toHaveValue("Edited Before Upload"));
    // Give the form's reset effect a chance to run, then check again.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.getByLabelText(/display name/i)).toHaveValue("Edited Before Upload");
  });

  it("saves edits made before a picture upload, without picture keys and with the NRC", async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockResolvedValue({ ...defaultProfileData, fullName: "Edited Before Upload" });
    mockUseUpdateProfile.mockReturnValue({ mutateAsync, isPending: false });
    const { rerender } = render(<ProfileForm />, { wrapper: createWrapper() });

    const nameInput = await screen.findByLabelText(/display name/i);
    await waitFor(() => expect(nameInput).toHaveValue("Test User"));
    await user.clear(nameInput);
    await user.type(nameInput, "Edited Before Upload");
    mockUseProfile.mockReturnValue({
      data: { ...defaultProfileData, profilePictureUrl: "/uploads/profiles/new.png" },
      isLoading: false,
      error: null,
    });
    rerender(<ProfileForm />);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const body = mutateAsync.mock.calls[0][0];
    expect(body.fullName).toBe("Edited Before Upload");
    expect(body).not.toHaveProperty("profilePicture");
    expect(body).not.toHaveProperty("profilePictureUrl");
    expect(body.nrc).toBe(defaultProfileData.nrc);
  });

  it("locks the fields while a save is in flight, so an edit cannot be typed and then lost", async () => {
    const user = userEvent.setup();
    let reply: (profile: unknown) => void = () => {};
    const mutateAsync = vi.fn(() => new Promise(resolve => { reply = resolve; }));
    mockUseUpdateProfile.mockReturnValue({ mutateAsync, isPending: false });
    render(<ProfileForm />, { wrapper: createWrapper() });

    const nameInput = await screen.findByLabelText(/display name/i);
    await waitFor(() => expect(nameInput).toHaveValue("Test User"));
    await user.clear(nameInput);
    await user.type(nameInput, "Alice");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));

    // The reply has not arrived: the field is locked, so the edit to "Alicia" cannot be typed.
    expect(screen.getByLabelText(/display name/i)).toBeDisabled();
    await user.type(screen.getByLabelText(/display name/i), "{Backspace}ia");
    expect(screen.getByLabelText(/display name/i)).toHaveValue("Alice");

    reply({ ...defaultProfileData, fullName: "Alice" });
    await waitFor(() => expect(screen.getByLabelText(/display name/i)).not.toBeDisabled());
    expect(screen.getByLabelText(/display name/i)).toHaveValue("Alice");

    // After the reply the field is editable again and keeps the new edit.
    await user.clear(screen.getByLabelText(/display name/i));
    await user.type(screen.getByLabelText(/display name/i), "Alicia");
    expect(screen.getByLabelText(/display name/i)).toHaveValue("Alicia");
  });

  it("reports an uncertain mutation outcome without claiming validation failure", async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockRejectedValue(new Error("network failure"));
    mockUseUpdateProfile.mockReturnValue({ mutateAsync, isPending: false });
    render(<ProfileForm />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByLabelText(/display name/i)).toHaveValue("Test User"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to update profile", {
      description: "We could not confirm whether your changes were saved. Refresh your profile before trying again.",
    }));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
