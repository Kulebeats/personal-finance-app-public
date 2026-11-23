/**
 * @vitest-environment jsdom
 *
 * The checklist reads the same rules as the server password policy
 * (shared/password-policy.ts), so a password that ticks every item is one the
 * server accepts.
 */
import { render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PasswordStrengthMeter, usePasswordValidation } from "../PasswordStrengthMeter";

const MET = "text-green-600";

describe("PasswordStrengthMeter special-character rule", () => {
  it("lists the special-character rule and leaves it unticked until one is typed", () => {
    render(<PasswordStrengthMeter password="Abcdefg1" />);

    const item = screen.getByText(/special character/i).closest('[role="listitem"]');
    expect(item).not.toBeNull();
    expect(item?.className).not.toContain(MET);
    // Every other character rule is already satisfied.
    for (const rule of [/lowercase/i, /uppercase/i, /number/i]) {
      expect(screen.getByText(rule).closest('[role="listitem"]')?.className).toContain(MET);
    }
  });

  it("ticks the special-character rule once the password has one", () => {
    render(<PasswordStrengthMeter password="Abcdefg1!" />);

    expect(screen.getByText(/special character/i).closest('[role="listitem"]')?.className).toContain(MET);
  });

  it("flags a password over the server maximum and treats it as invalid", () => {
    const tooLong = `Aa1!${"x".repeat(125)}`; // 129 characters, every character rule met
    expect(tooLong).toHaveLength(129);

    render(<PasswordStrengthMeter password={tooLong} />);
    const { result } = renderHook(() => usePasswordValidation(tooLong));

    expect(screen.getByText(/at most 128 characters/i).closest('[role="listitem"]')?.className).not.toContain(MET);
    expect(result.current.isValid).toBe(false);
  });

  it("treats a password with no special character as invalid", () => {
    const without = renderHook(() => usePasswordValidation("Abcdefg1"));
    const withSpecial = renderHook(() => usePasswordValidation("Abcdefg1!"));

    expect(without.result.current.isValid).toBe(false);
    expect(withSpecial.result.current.isValid).toBe(true);
  });
});
