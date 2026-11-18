import { createRef, type RefObject } from "react";
import { describe, it, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouteErrorBoundary } from "../RouteErrorBoundary";

function renderBoundary(resetKey = "/reports", routeName = "Reports") {
  const ref = createRef<RouteErrorBoundary>();
  const view = render(
    <RouteErrorBoundary ref={ref} resetKey={resetKey} routeName={routeName}>
      <div>route content</div>
    </RouteErrorBoundary>,
  );

  return { ...view, ref };
}

function showBoundaryFallback(ref: RefObject<RouteErrorBoundary>) {
  act(() => {
    ref.current?.setState({
      hasError: true,
      error: new Error("Test error (route explosion)"),
    });
  });
}

describe("RouteErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    renderBoundary();

    expect(screen.getByText("route content")).toBeInTheDocument();
  });

  it("renders the route-scoped fallback when a child throws", () => {
    const { ref } = renderBoundary();
    showBoundaryFallback(ref);

    expect(screen.getByText("Reports did not load")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /dashboard/i }),
    ).toBeInTheDocument();
  });

  it("resets the error state when resetKey changes (navigation)", () => {
    const { rerender, ref } = renderBoundary();
    showBoundaryFallback(ref);

    expect(screen.getByText("Reports did not load")).toBeInTheDocument();

    rerender(
      <RouteErrorBoundary ref={ref} resetKey="/budget" routeName="Budget">
        <div>route content</div>
      </RouteErrorBoundary>,
    );

    expect(screen.getByText("route content")).toBeInTheDocument();
    expect(screen.queryByText("Reports did not load")).not.toBeInTheDocument();
  });

  it("recovers via the Retry button once the child no longer throws", async () => {
    const user = userEvent.setup();
    const { ref } = renderBoundary();
    showBoundaryFallback(ref);

    expect(screen.getByText("Reports did not load")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /retry/i }));

    expect(screen.getByText("route content")).toBeInTheDocument();
  });
});
