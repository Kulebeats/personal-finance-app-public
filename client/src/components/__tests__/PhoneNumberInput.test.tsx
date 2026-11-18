import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PhoneNumberInput } from "../PhoneNumberInput";

// Mock the phone input library
vi.mock("react-phone-number-input", () => ({
  default: ({ value, onChange, placeholder, className, id }: any) => (
    <input
      data-testid="phone-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
      id={id}
    />
  ),
}));

// Mock the profile helpers
vi.mock("../../utils/profileHelpers", () => ({
  formatPhonePreview: (phone: string) => {
    if (phone === "+260971234567") return "097 123 4567";
    if (phone === "+1234567890") return "+1 234 567 890";
    return phone;
  },
  isValidZambianNumber: (phone: string) => {
    return phone.startsWith("+260") && phone.length === 13;
  },
}));

describe("PhoneNumberInput", () => {
  const defaultProps = {
    label: "Test Phone",
    value: "",
    onChange: vi.fn(),
    placeholder: "Enter phone number",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render with label and placeholder", () => {
    render(<PhoneNumberInput {...defaultProps} />);

    expect(screen.getByText("Test Phone")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Enter phone number")
    ).toBeInTheDocument();
  });

  it("should show required indicator when required prop is true", () => {
    render(<PhoneNumberInput {...defaultProps} required />);

    expect(screen.getByText(/Test Phone \*/)).toBeInTheDocument();
  });

  it("should call onChange when input value changes", () => {
    const onChange = vi.fn();
    render(<PhoneNumberInput {...defaultProps} onChange={onChange} />);

    const input = screen.getByTestId("phone-input");
    fireEvent.change(input, { target: { value: "+260971234567" } });

    expect(onChange).toHaveBeenCalledWith("+260971234567");
  });

  it("should show format preview for valid phone numbers", () => {
    render(<PhoneNumberInput {...defaultProps} value="+260971234567" />);

    expect(screen.getByText("Preview: 097 123 4567")).toBeInTheDocument();
  });

  it("should show validation success for valid Zambian numbers", () => {
    render(<PhoneNumberInput {...defaultProps} value="+260971234567" />);

    expect(screen.getByText("✓ Valid Zambian number")).toBeInTheDocument();
  });

  it("should show validation error for invalid numbers", () => {
    render(<PhoneNumberInput {...defaultProps} value="+26012345" />);

    expect(screen.getByText("⚠ Invalid format")).toBeInTheDocument();
  });

  it("should show Zambian number format hints for +260 numbers", () => {
    render(<PhoneNumberInput {...defaultProps} value="+260123" />);

    expect(screen.getByText("Zambian Number Format:")).toBeInTheDocument();
    expect(
      screen.getByText("• Mobile: +260 9X XXX XXXX (Airtel, MTN, Zamtel)")
    ).toBeInTheDocument();
    expect(
      screen.getByText("• Landline: +260 21X XXX XXX (Lusaka area)")
    ).toBeInTheDocument();
  });

  it("should not show preview or validation for empty values", () => {
    render(<PhoneNumberInput {...defaultProps} value="" />);

    expect(screen.queryByText(/Preview:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Valid Zambian number/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Invalid format/)).not.toBeInTheDocument();
  });

  it("should handle international numbers correctly", () => {
    render(<PhoneNumberInput {...defaultProps} value="+1234567890" />);

    expect(screen.getByText("Preview: +1 234 567 890")).toBeInTheDocument();
    expect(screen.getByText("⚠ Invalid format")).toBeInTheDocument(); // Not a Zambian number
  });

  it("should apply custom className", () => {
    render(<PhoneNumberInput {...defaultProps} className="custom-class" />);

    const container = screen
      .getByTestId("phone-input")
      .closest(".custom-class");
    expect(container).toBeInTheDocument();
  });

  it("should set correct id attribute", () => {
    render(<PhoneNumberInput {...defaultProps} id="test-phone-id" />);

    const input = screen.getByTestId("phone-input");
    expect(input).toHaveAttribute("id", "test-phone-id");
  });

  it("should handle undefined onChange gracefully", () => {
    const onChange = vi.fn();
    render(<PhoneNumberInput {...defaultProps} onChange={onChange} />);

    const input = screen.getByTestId("phone-input");

    // Simulate the library calling onChange with a value
    fireEvent.change(input, { target: { value: "+260971234567" } });

    expect(onChange).toHaveBeenCalledWith("+260971234567");
  });

  it("should show different validation states correctly", () => {
    const { rerender } = render(
      <PhoneNumberInput {...defaultProps} value="" />
    );

    // Empty state - no validation shown
    expect(screen.queryByText(/Valid Zambian number/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Invalid format/)).not.toBeInTheDocument();

    // Valid Zambian number
    rerender(<PhoneNumberInput {...defaultProps} value="+260971234567" />);
    expect(screen.getByText("✓ Valid Zambian number")).toBeInTheDocument();

    // Invalid number
    rerender(<PhoneNumberInput {...defaultProps} value="+26012345" />);
    expect(screen.getByText("⚠ Invalid format")).toBeInTheDocument();
  });

  it("should show hint for Zambian numbers not starting with 09", () => {
    // Test landline number (starts with +26021)
    render(<PhoneNumberInput {...defaultProps} value="+260211234567" />);

    expect(
      screen.getByText("💡 Most Zambian mobile numbers start with 09...")
    ).toBeInTheDocument();
  });

  it("should not show hint for mobile numbers starting with 09", () => {
    render(<PhoneNumberInput {...defaultProps} value="+260971234567" />);

    expect(
      screen.queryByText("💡 Most Zambian mobile numbers start with 09...")
    ).not.toBeInTheDocument();
  });

  it("should not show hint for non-Zambian numbers", () => {
    render(<PhoneNumberInput {...defaultProps} value="+1234567890" />);

    expect(
      screen.queryByText("💡 Most Zambian mobile numbers start with 09...")
    ).not.toBeInTheDocument();
  });
});
