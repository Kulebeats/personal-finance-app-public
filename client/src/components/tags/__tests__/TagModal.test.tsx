/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TagModal } from "../TagModal";

// Mock the hooks
const createTagMock = vi.fn();
const updateTagMock = vi.fn();

vi.mock("@/hooks", () => ({
  useCreateTag: () => ({
    mutateAsync: createTagMock,
    isPending: false,
    isError: false,
  }),
  useUpdateTag: () => ({
    mutateAsync: updateTagMock,
    isPending: false,
    isError: false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("TagModal", () => {
  const mockOnOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    createTagMock.mockResolvedValue({ id: "1", name: "Test", color: "#FF5733" });
    updateTagMock.mockResolvedValue({ id: "1", name: "Updated", color: "#FF5733" });
  });

  describe("Create Mode", () => {
    it("renders create modal with correct title", () => {
      render(
        <TagModal open={true} onOpenChange={mockOnOpenChange} />,
        { wrapper: createWrapper() }
      );

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("New tag")).toBeInTheDocument();
    });

    it("has empty name input in create mode", () => {
      render(
        <TagModal open={true} onOpenChange={mockOnOpenChange} />,
        { wrapper: createWrapper() }
      );

      const input = screen.getByPlaceholderText("Name your tag...");
      expect(input).toHaveValue("");
    });

    it("disables save button when name is empty", () => {
      render(
        <TagModal open={true} onOpenChange={mockOnOpenChange} />,
        { wrapper: createWrapper() }
      );

      const saveButton = screen.getByRole("button", { name: /save/i });
      expect(saveButton).toBeDisabled();
    });

    it("enables save button when name has value", async () => {
      const user = userEvent.setup();
      render(
        <TagModal open={true} onOpenChange={mockOnOpenChange} />,
        { wrapper: createWrapper() }
      );

      const input = screen.getByPlaceholderText("Name your tag...");
      await user.type(input, "My Tag");

      const saveButton = screen.getByRole("button", { name: /save/i });
      expect(saveButton).not.toBeDisabled();
    });

    it("calls createTag on submit with trimmed name", async () => {
      const user = userEvent.setup();
      render(
        <TagModal open={true} onOpenChange={mockOnOpenChange} />,
        { wrapper: createWrapper() }
      );

      const input = screen.getByPlaceholderText("Name your tag...");
      await user.type(input, "  My Tag  ");

      const saveButton = screen.getByRole("button", { name: /save/i });
      await user.click(saveButton);

      await waitFor(() => {
        expect(createTagMock).toHaveBeenCalledWith({
          name: "My Tag",
          color: expect.any(String),
        });
      });
    });

    it("closes modal on successful create", async () => {
      const user = userEvent.setup();
      render(
        <TagModal open={true} onOpenChange={mockOnOpenChange} />,
        { wrapper: createWrapper() }
      );

      const input = screen.getByPlaceholderText("Name your tag...");
      await user.type(input, "My Tag");

      const saveButton = screen.getByRole("button", { name: /save/i });
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockOnOpenChange).toHaveBeenCalledWith(false);
      });
    });
  });

  describe("Edit Mode", () => {
    const existingTag = {
      id: "tag-123",
      householdId: "household-123",
      name: "Existing Tag",
      color: "#22C55E",
      icon: null,
      memberSpecific: false,
      memberId: null,
      usageCount: 5,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };

    it("renders edit modal with correct title", () => {
      render(
        <TagModal open={true} onOpenChange={mockOnOpenChange} tag={existingTag} />,
        { wrapper: createWrapper() }
      );

      expect(screen.getByText("Edit tag")).toBeInTheDocument();
    });

    it("pre-fills form with existing tag data", () => {
      render(
        <TagModal open={true} onOpenChange={mockOnOpenChange} tag={existingTag} />,
        { wrapper: createWrapper() }
      );

      const input = screen.getByPlaceholderText("Name your tag...");
      expect(input).toHaveValue("Existing Tag");
    });

    it("calls updateTag on submit", async () => {
      const user = userEvent.setup();
      render(
        <TagModal open={true} onOpenChange={mockOnOpenChange} tag={existingTag} />,
        { wrapper: createWrapper() }
      );

      const input = screen.getByPlaceholderText("Name your tag...");
      await user.clear(input);
      await user.type(input, "Updated Name");

      const saveButton = screen.getByRole("button", { name: /save/i });
      await user.click(saveButton);

      await waitFor(() => {
        expect(updateTagMock).toHaveBeenCalledWith({
          id: "tag-123",
          data: {
            name: "Updated Name",
            color: "#22C55E",
          },
        });
      });
    });
  });

  describe("Cancel Button", () => {
    it("closes modal when cancel is clicked", async () => {
      const user = userEvent.setup();
      render(
        <TagModal open={true} onOpenChange={mockOnOpenChange} />,
        { wrapper: createWrapper() }
      );

      const cancelButton = screen.getByRole("button", { name: /cancel/i });
      await user.click(cancelButton);

      expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe("Accessibility", () => {
    it("has accessible form labels", () => {
      render(
        <TagModal open={true} onOpenChange={mockOnOpenChange} />,
        { wrapper: createWrapper() }
      );

      const label = screen.getByText("Color & Name");
      expect(label).toHaveAttribute("for", "tagName");
    });

    it("has ARIA live region for status", () => {
      render(
        <TagModal open={true} onOpenChange={mockOnOpenChange} />,
        { wrapper: createWrapper() }
      );

      const liveRegion = screen.getByRole("status");
      expect(liveRegion).toHaveAttribute("aria-live", "polite");
    });

    it("hides decorative color preview from screen readers", () => {
      render(
        <TagModal open={true} onOpenChange={mockOnOpenChange} />,
        { wrapper: createWrapper() }
      );

      const colorPreview = document.querySelector('[aria-hidden="true"]');
      expect(colorPreview).toBeInTheDocument();
    });

    it("includes color picker as radiogroup", () => {
      render(
        <TagModal open={true} onOpenChange={mockOnOpenChange} />,
        { wrapper: createWrapper() }
      );

      const colorPicker = screen.getByRole("radiogroup", { name: /select tag color/i });
      expect(colorPicker).toBeInTheDocument();
    });
  });

  describe("Form Reset", () => {
    it("resets form when modal opens in create mode", async () => {
      const { rerender } = render(
        <TagModal open={false} onOpenChange={mockOnOpenChange} />,
        { wrapper: createWrapper() }
      );

      // Open the modal
      rerender(
        <TagModal open={true} onOpenChange={mockOnOpenChange} />
      );

      const input = screen.getByPlaceholderText("Name your tag...");
      expect(input).toHaveValue("");
    });
  });
});
