import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { GoalProgressBar } from "../components/GoalProgressBar";

describe("GoalProgressBar", () => {
  it("renders with correct aria attributes", () => {
    render(<GoalProgressBar current={50} target={100} />);
    const progressBar = screen.getByRole("progressbar");
    expect(progressBar).toBeInTheDocument();
    expect(progressBar).toHaveAttribute("aria-valuenow", "50");
    expect(progressBar).toHaveAttribute("aria-valuemin", "0");
    expect(progressBar).toHaveAttribute("aria-valuemax", "100");
  });

  it("calculates progress percentage correctly", () => {
    render(<GoalProgressBar current={25} target={100} />);
    const progressBar = screen.getByRole("progressbar");
    expect(progressBar).toHaveAttribute("aria-valuenow", "25");
  });

  it("caps progress at 100%", () => {
    render(<GoalProgressBar current={150} target={100} />);
    const progressBar = screen.getByRole("progressbar");
    expect(progressBar).toHaveAttribute("aria-valuenow", "100");
  });

  it("handles zero target (0%)", () => {
    render(<GoalProgressBar current={10} target={0} />);
    const progressBar = screen.getByRole("progressbar");
    expect(progressBar).toHaveAttribute("aria-valuenow", "0");
  });

  it("applies custom color style if hex provided", () => {
    const { container } = render(
      <GoalProgressBar current={50} target={100} color="#123456" />
    );
    // inner div is the first child of the progressbar div
    const innerBar = container.querySelector('[role="progressbar"] > div');
    expect(innerBar).toHaveStyle({ backgroundColor: "#123456" });
  });

  it("applies class based color if name provided", () => {
    const { container } = render(
      <GoalProgressBar current={50} target={100} color="emerald" />
    );
    const innerBar = container.querySelector('[role="progressbar"] > div');
    expect(innerBar).toHaveClass("bg-emerald-500");
  });
});
