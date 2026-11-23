import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Slider } from "../slider";

describe("Slider accessibility", () => {
  it("names the thumb with aria-label and preserves controlled keyboard changes", async () => {
    const user = userEvent.setup();
    const rootRef = React.createRef<HTMLSpanElement>();
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();

    function ControlledSlider() {
      const [value, setValue] = React.useState([80]);

      return (
        <Slider
          ref={rootRef}
          aria-label="OCR Confidence Threshold"
          min={0}
          max={100}
          step={1}
          value={value}
          onValueChange={(nextValue) => {
            onValueChange(nextValue);
            setValue(nextValue);
          }}
          onValueCommit={onValueCommit}
        />
      );
    }

    render(<ControlledSlider />);

    const thumb = screen.getByRole("slider", { name: "OCR Confidence Threshold" });
    expect(thumb).toHaveAttribute("aria-valuemin", "0");
    expect(thumb).toHaveAttribute("aria-valuemax", "100");
    expect(thumb).toHaveAttribute("aria-valuenow", "80");
    expect(rootRef.current).not.toBe(thumb);
    expect(rootRef.current).toContainElement(thumb);

    await user.tab();
    expect(thumb).toHaveFocus();

    await user.keyboard("{Home}");
    expect(thumb).toHaveAttribute("aria-valuenow", "0");
    expect(onValueChange).toHaveBeenLastCalledWith([0]);
    expect(onValueCommit).toHaveBeenLastCalledWith([0]);

    await user.keyboard("{End}{ArrowLeft}");
    expect(thumb).toHaveAttribute("aria-valuenow", "99");
    expect(onValueChange).toHaveBeenLastCalledWith([99]);
    expect(onValueCommit).toHaveBeenLastCalledWith([99]);
  });

  it("names the thumb from aria-labelledby before the aria-label fallback", () => {
    render(
      <>
        <span id="confidence-label">Receipt confidence</span>
        <Slider
          aria-labelledby="confidence-label"
          aria-label="Fallback confidence label"
          defaultValue={[80]}
        />
      </>,
    );

    expect(screen.getByRole("slider", { name: "Receipt confidence" }))
      .toHaveAttribute("aria-labelledby", "confidence-label");
  });
});
