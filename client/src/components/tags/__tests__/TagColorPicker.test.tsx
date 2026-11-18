/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { TagColorPicker, TAG_COLORS } from "../TagColorPicker";

describe("TagColorPicker", () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("renders all 12 color buttons", () => {
      render(<TagColorPicker value={TAG_COLORS[0]} onChange={mockOnChange} />);

      const buttons = screen.getAllByRole("radio");
      expect(buttons).toHaveLength(12);
    });

    it("marks the selected color as checked", () => {
      render(<TagColorPicker value="#22C55E" onChange={mockOnChange} />);

      const greenButton = screen.getByRole("radio", { name: /select green color/i });
      expect(greenButton).toHaveAttribute("aria-checked", "true");
    });

    it("marks unselected colors as not checked", () => {
      render(<TagColorPicker value="#EF4444" onChange={mockOnChange} />);

      const blueButton = screen.getByRole("radio", { name: /select blue color/i });
      expect(blueButton).toHaveAttribute("aria-checked", "false");
    });
  });

  describe("Selection", () => {
    it("calls onChange when a color is clicked", async () => {
      const user = userEvent.setup();
      render(<TagColorPicker value="#EF4444" onChange={mockOnChange} />);

      const blueButton = screen.getByRole("radio", { name: /select blue color/i });
      await user.click(blueButton);

      expect(mockOnChange).toHaveBeenCalledWith("#3B82F6");
    });

    it("calls onChange with correct color for each button", async () => {
      const user = userEvent.setup();
      render(<TagColorPicker value="#EF4444" onChange={mockOnChange} />);

      // Test a few colors
      const tests = [
        { name: /select orange/i, expected: "#F97316" },
        { name: /select yellow/i, expected: "#EAB308" },
        { name: /select teal/i, expected: "#14B8A6" },
        { name: /select purple/i, expected: "#8B5CF6" },
      ];

      for (const { name, expected } of tests) {
        mockOnChange.mockClear();
        const button = screen.getByRole("radio", { name });
        await user.click(button);
        expect(mockOnChange).toHaveBeenCalledWith(expected);
      }
    });
  });

  describe("Accessibility - Radiogroup Pattern", () => {
    it("has radiogroup role", () => {
      render(<TagColorPicker value="#EF4444" onChange={mockOnChange} />);

      const radiogroup = screen.getByRole("radiogroup");
      expect(radiogroup).toBeInTheDocument();
      expect(radiogroup).toHaveAttribute("aria-label", "Select tag color");
    });

    it("has proper aria-labels for each color", () => {
      render(<TagColorPicker value="#EF4444" onChange={mockOnChange} />);

      const colorNames = [
        "Red", "Orange", "Yellow", "Green", "Teal", "Cyan",
        "Blue", "Indigo", "Purple", "Pink", "Rose", "Gray"
      ];

      for (const color of colorNames) {
        const button = screen.getByRole("radio", {
          name: new RegExp(`select ${color} color`, "i")
        });
        expect(button).toBeInTheDocument();
      }
    });
  });

  describe("Accessibility - Keyboard Navigation", () => {
    it("supports arrow right navigation", async () => {
      const user = userEvent.setup();
      render(<TagColorPicker value="#EF4444" onChange={mockOnChange} />);

      const redButton = screen.getByRole("radio", { name: /select red color/i });
      redButton.focus();

      await user.keyboard("{ArrowRight}");

      // Should move focus to orange
      expect(document.activeElement).toHaveAttribute(
        "aria-label",
        expect.stringMatching(/select orange color/i)
      );
    });

    it("supports arrow left navigation", async () => {
      const user = userEvent.setup();
      render(<TagColorPicker value="#F97316" onChange={mockOnChange} />);

      const orangeButton = screen.getByRole("radio", { name: /select orange color/i });
      orangeButton.focus();

      await user.keyboard("{ArrowLeft}");

      // Should move focus to red
      expect(document.activeElement).toHaveAttribute(
        "aria-label",
        expect.stringMatching(/select red color/i)
      );
    });

    it("supports arrow down navigation (6 columns)", async () => {
      const user = userEvent.setup();
      render(<TagColorPicker value="#EF4444" onChange={mockOnChange} />);

      const redButton = screen.getByRole("radio", { name: /select red color/i });
      redButton.focus();

      await user.keyboard("{ArrowDown}");

      // Should move focus to blue (6 positions down in grid)
      expect(document.activeElement).toHaveAttribute(
        "aria-label",
        expect.stringMatching(/select blue color/i)
      );
    });

    it("supports arrow up navigation", async () => {
      const user = userEvent.setup();
      render(<TagColorPicker value="#3B82F6" onChange={mockOnChange} />);

      const blueButton = screen.getByRole("radio", { name: /select blue color/i });
      blueButton.focus();

      await user.keyboard("{ArrowUp}");

      // Should move focus to red (6 positions up in grid)
      expect(document.activeElement).toHaveAttribute(
        "aria-label",
        expect.stringMatching(/select red color/i)
      );
    });

    it("supports Home key to go to first color", async () => {
      const user = userEvent.setup();
      render(<TagColorPicker value="#8B5CF6" onChange={mockOnChange} />);

      const purpleButton = screen.getByRole("radio", { name: /select purple color/i });
      purpleButton.focus();

      await user.keyboard("{Home}");

      expect(document.activeElement).toHaveAttribute(
        "aria-label",
        expect.stringMatching(/select red color/i)
      );
    });

    it("supports End key to go to last color", async () => {
      const user = userEvent.setup();
      render(<TagColorPicker value="#EF4444" onChange={mockOnChange} />);

      const redButton = screen.getByRole("radio", { name: /select red color/i });
      redButton.focus();

      await user.keyboard("{End}");

      expect(document.activeElement).toHaveAttribute(
        "aria-label",
        expect.stringMatching(/select gray color/i)
      );
    });

    it("wraps around on arrow right at end", async () => {
      const user = userEvent.setup();
      render(<TagColorPicker value="#A3A3A3" onChange={mockOnChange} />);

      const grayButton = screen.getByRole("radio", { name: /select gray color/i });
      grayButton.focus();

      await user.keyboard("{ArrowRight}");

      // Should wrap to red
      expect(document.activeElement).toHaveAttribute(
        "aria-label",
        expect.stringMatching(/select red color/i)
      );
    });

    it("wraps around on arrow left at start", async () => {
      const user = userEvent.setup();
      render(<TagColorPicker value="#EF4444" onChange={mockOnChange} />);

      const redButton = screen.getByRole("radio", { name: /select red color/i });
      redButton.focus();

      await user.keyboard("{ArrowLeft}");

      // Should wrap to gray
      expect(document.activeElement).toHaveAttribute(
        "aria-label",
        expect.stringMatching(/select gray color/i)
      );
    });
  });

  describe("Accessibility - Roving Tabindex", () => {
    it("only the focused color has tabindex 0", () => {
      render(<TagColorPicker value="#EF4444" onChange={mockOnChange} />);

      const buttons = screen.getAllByRole("radio");
      const tabindex0Count = buttons.filter(
        (btn) => btn.getAttribute("tabindex") === "0"
      ).length;
      const tabindexMinus1Count = buttons.filter(
        (btn) => btn.getAttribute("tabindex") === "-1"
      ).length;

      expect(tabindex0Count).toBe(1);
      expect(tabindexMinus1Count).toBe(11);
    });
  });

  describe("Contrast - WCAG Compliance", () => {
    it("shows dark checkmark on light colors (yellow, cyan)", () => {
      // Yellow is a light color that needs dark checkmark
      const { container } = render(
        <TagColorPicker value="#EAB308" onChange={mockOnChange} />
      );

      const checkIcon = container.querySelector("svg");
      expect(checkIcon).toHaveClass("text-gray-900");
    });

    it("shows white checkmark on dark colors", () => {
      // Blue is a dark color that gets white checkmark
      const { container } = render(
        <TagColorPicker value="#3B82F6" onChange={mockOnChange} />
      );

      const checkIcon = container.querySelector("svg");
      expect(checkIcon).toHaveClass("text-white");
    });
  });

  describe("Visual States", () => {
    it("shows check icon on selected color", () => {
      const { container } = render(
        <TagColorPicker value="#EF4444" onChange={mockOnChange} />
      );

      // There should be exactly one check icon
      const checkIcons = container.querySelectorAll("svg");
      expect(checkIcons).toHaveLength(1);
    });

    it("does not show check icon on unselected colors", () => {
      const { container } = render(
        <TagColorPicker value={null as unknown as string} onChange={mockOnChange} />
      );

      // No value selected, no check icon
      const checkIcons = container.querySelectorAll("svg");
      expect(checkIcons).toHaveLength(0);
    });
  });
});
