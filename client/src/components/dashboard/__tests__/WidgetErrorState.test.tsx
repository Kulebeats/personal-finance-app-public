import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { WidgetErrorState } from "../WidgetErrorState";

describe("WidgetErrorState", () => {
  it("renders default title and message", () => {
    render(<WidgetErrorState />);

    expect(screen.getByText("Unable to load data")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong. Please try again.")).toBeInTheDocument();
  });

  it("renders custom title and message", () => {
    render(
      <WidgetErrorState
        title="Custom Error Title"
        message="Custom error message here."
      />
    );

    expect(screen.getByText("Custom Error Title")).toBeInTheDocument();
    expect(screen.getByText("Custom error message here.")).toBeInTheDocument();
  });

  it("renders retry button when onRetry is provided", () => {
    const handleRetry = vi.fn();
    render(<WidgetErrorState onRetry={handleRetry} />);

    const retryButton = screen.getByRole("button", { name: /try again/i });
    expect(retryButton).toBeInTheDocument();

    fireEvent.click(retryButton);
    expect(handleRetry).toHaveBeenCalledTimes(1);
  });

  it("does not render retry button when onRetry is not provided", () => {
    render(<WidgetErrorState />);

    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(
      <WidgetErrorState className="custom-class test-class" />
    );

    const card = container.firstChild;
    expect(card).toHaveClass("custom-class");
    expect(card).toHaveClass("test-class");
  });

  it("displays error icon", () => {
    render(<WidgetErrorState />);

    // The AlertCircle icon should be rendered
    // We can check for the destructive color class
    const icon = document.querySelector(".text-destructive");
    expect(icon).toBeInTheDocument();
  });

  // WCAG 2.1 AA: the failure must be announced to assistive tech, and the
  // retry action must be a real, focusable, enabled button.
  it("announces the error via role=alert and exposes a focusable retry button", () => {
    const handleRetry = vi.fn();
    render(<WidgetErrorState onRetry={handleRetry} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: /try again/i });
    expect(retryButton.tagName).toBe("BUTTON");
    expect(retryButton).toBeEnabled();
    retryButton.focus();
    expect(retryButton).toHaveFocus();
  });

  it("has accessible structure", () => {
    render(
      <WidgetErrorState
        title="Network Error"
        message="Please check your connection."
        onRetry={() => {}}
      />
    );

    // Title should be a heading
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Network Error");

    // Retry button should be accessible
    const retryButton = screen.getByRole("button", { name: /try again/i });
    expect(retryButton).toBeEnabled();
  });
});
