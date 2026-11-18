/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { TagBadge } from "../TagBadge";

describe("TagBadge", () => {
  describe("Rendering", () => {
    it("renders tag name", () => {
      render(<TagBadge name="Test Tag" />);
      expect(screen.getByText("Test Tag")).toBeInTheDocument();
    });

    it("renders color dot with correct color", () => {
      const { container } = render(<TagBadge name="Test" color="#FF5733" />);

      const colorDot = container.querySelector('[aria-hidden="true"]');
      expect(colorDot).toHaveStyle({ backgroundColor: "#FF5733" });
    });

    it("uses default gray color when no color provided", () => {
      const { container } = render(<TagBadge name="Test" />);

      const colorDot = container.querySelector('[aria-hidden="true"]');
      expect(colorDot).toHaveStyle({ backgroundColor: "#A3A3A3" });
    });

    it("uses default gray for null color", () => {
      const { container } = render(<TagBadge name="Test" color={null} />);

      const colorDot = container.querySelector('[aria-hidden="true"]');
      expect(colorDot).toHaveStyle({ backgroundColor: "#A3A3A3" });
    });
  });

  describe("Sizes", () => {
    it("renders small size correctly", () => {
      render(<TagBadge name="Test" size="sm" />);

      const badge = screen.getByText("Test").parentElement;
      expect(badge).toHaveClass("text-xs");
      expect(badge).toHaveClass("px-2");
      expect(badge).toHaveClass("py-0.5");
    });

    it("renders medium size correctly", () => {
      render(<TagBadge name="Test" size="md" />);

      const badge = screen.getByText("Test").parentElement;
      expect(badge).toHaveClass("text-sm");
      expect(badge).toHaveClass("px-2.5");
      expect(badge).toHaveClass("py-1");
    });

    it("uses medium as default size", () => {
      render(<TagBadge name="Test" />);

      const badge = screen.getByText("Test").parentElement;
      expect(badge).toHaveClass("text-sm");
    });
  });

  describe("Remove Button", () => {
    it("does not render remove button by default", () => {
      render(<TagBadge name="Test" />);

      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("does not render remove button when removable but no onRemove", () => {
      render(<TagBadge name="Test" removable />);

      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("renders remove button when removable with onRemove", () => {
      const mockOnRemove = vi.fn();
      render(<TagBadge name="Test" removable onRemove={mockOnRemove} />);

      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    it("calls onRemove when remove button clicked", async () => {
      const user = userEvent.setup();
      const mockOnRemove = vi.fn();
      render(<TagBadge name="Test" removable onRemove={mockOnRemove} />);

      await user.click(screen.getByRole("button"));

      expect(mockOnRemove).toHaveBeenCalledTimes(1);
    });

    it("stops event propagation when remove is clicked", async () => {
      const user = userEvent.setup();
      const mockOnRemove = vi.fn();
      const mockParentClick = vi.fn();

      render(
        <div onClick={mockParentClick}>
          <TagBadge name="Test" removable onRemove={mockOnRemove} />
        </div>
      );

      await user.click(screen.getByRole("button"));

      expect(mockOnRemove).toHaveBeenCalled();
      expect(mockParentClick).not.toHaveBeenCalled();
    });
  });

  describe("Accessibility", () => {
    it("has accessible remove button with tag name", () => {
      const mockOnRemove = vi.fn();
      render(<TagBadge name="Coffee" removable onRemove={mockOnRemove} />);

      const button = screen.getByRole("button", { name: "Remove Coffee tag" });
      expect(button).toBeInTheDocument();
    });

    it("hides color dot from screen readers", () => {
      const { container } = render(<TagBadge name="Test" color="#FF5733" />);

      const colorDot = container.querySelector('[aria-hidden="true"]');
      expect(colorDot).toBeInTheDocument();
    });

    it("hides X icon from screen readers", () => {
      const mockOnRemove = vi.fn();
      const { container } = render(
        <TagBadge name="Test" removable onRemove={mockOnRemove} />
      );

      const svg = container.querySelector("svg");
      expect(svg).toHaveAttribute("aria-hidden", "true");
    });

    it("has focus-visible ring on remove button", () => {
      const mockOnRemove = vi.fn();
      render(<TagBadge name="Test" removable onRemove={mockOnRemove} />);

      const button = screen.getByRole("button");
      expect(button).toHaveClass("focus-visible:ring-2");
    });
  });

  describe("Custom className", () => {
    it("applies custom className", () => {
      render(<TagBadge name="Test" className="custom-class" />);

      const badge = screen.getByText("Test").parentElement;
      expect(badge).toHaveClass("custom-class");
    });

    it("preserves base classes when custom className applied", () => {
      render(<TagBadge name="Test" className="custom-class" />);

      const badge = screen.getByText("Test").parentElement;
      expect(badge).toHaveClass("inline-flex");
      expect(badge).toHaveClass("rounded-full");
    });
  });

  describe("Size-specific Dot Sizes", () => {
    it("renders small dot for sm size", () => {
      const { container } = render(<TagBadge name="Test" size="sm" color="#FF5733" />);

      const colorDot = container.querySelector('[aria-hidden="true"]');
      expect(colorDot).toHaveClass("h-2");
      expect(colorDot).toHaveClass("w-2");
    });

    it("renders larger dot for md size", () => {
      const { container } = render(<TagBadge name="Test" size="md" color="#FF5733" />);

      const colorDot = container.querySelector('[aria-hidden="true"]');
      expect(colorDot).toHaveClass("h-2.5");
      expect(colorDot).toHaveClass("w-2.5");
    });
  });

  describe("Size-specific Remove Icon Sizes", () => {
    it("renders small X icon for sm size", () => {
      const mockOnRemove = vi.fn();
      const { container } = render(
        <TagBadge name="Test" size="sm" removable onRemove={mockOnRemove} />
      );

      const svg = container.querySelector("svg");
      expect(svg).toHaveClass("h-3");
      expect(svg).toHaveClass("w-3");
    });

    it("renders larger X icon for md size", () => {
      const mockOnRemove = vi.fn();
      const { container } = render(
        <TagBadge name="Test" size="md" removable onRemove={mockOnRemove} />
      );

      const svg = container.querySelector("svg");
      expect(svg).toHaveClass("h-3.5");
      expect(svg).toHaveClass("w-3.5");
    });
  });
});
