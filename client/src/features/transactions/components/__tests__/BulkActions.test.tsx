/**
 * BulkActions Component Tests
 *
 * R17 dead-control cleanup: the toolbar previously shipped a "Hide" button
 * that only toasted "coming soon" (no backing capability). Asserts the stub
 * is gone and the remaining real actions still fire their handlers.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { BulkActions } from "../BulkActions";

function renderBulkActions(overrides: Partial<Parameters<typeof BulkActions>[0]> = {}) {
  const props = {
    selectedCount: 3,
    onClear: vi.fn(),
    onCategorize: vi.fn(),
    onTag: vi.fn(),
    onReview: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<BulkActions {...props} />);
  return props;
}

describe("BulkActions", () => {
  it("does not render the dead Hide stub", () => {
    renderBulkActions();

    expect(
      screen.queryByRole("button", { name: /hide/i }),
    ).not.toBeInTheDocument();
  });

  it("renders nothing when no rows are selected", () => {
    const { container } = render(
      <BulkActions
        selectedCount={0}
        onClear={vi.fn()}
        onCategorize={vi.fn()}
        onTag={vi.fn()}
        onReview={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("invokes the real bulk action handlers", async () => {
    const user = userEvent.setup();
    const props = renderBulkActions();

    await user.click(screen.getByRole("button", { name: /categorize/i }));
    expect(props.onCategorize).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /^tag$/i }));
    expect(props.onTag).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /review/i }));
    expect(props.onReview).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(props.onDelete).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /clear selection/i }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });
});
