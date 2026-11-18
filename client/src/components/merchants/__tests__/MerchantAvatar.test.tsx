import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MerchantAvatar } from "../MerchantAvatar";

// NOTE (test-rot repair): MerchantAvatar was redesigned to render a lucide
// category icon inside a titled wrapper <div> for the no-logo fallback (it no
// longer renders text initials). When a logoUrl is supplied it renders an
// <img>. These tests assert the current icon/logo behaviour rather than the
// removed initials behaviour. Source: ../MerchantAvatar.tsx.

describe("MerchantAvatar", () => {
  it("renders a fallback icon wrapper when no logo is provided", () => {
    render(<MerchantAvatar name="Test Merchant" />);

    // Fallback renders a titled wrapper (default title "Merchant") containing
    // a lucide icon.
    const wrapper = screen.getByTitle("Merchant");
    expect(wrapper).toBeInTheDocument();
    expect(wrapper.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with logo URL", () => {
    render(
      <MerchantAvatar
        name="Test Merchant"
        logoUrl="https://example.com/logo.png"
      />
    );

    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://example.com/logo.png");
    expect(img).toHaveAttribute("alt", "Test Merchant");
  });

  it("applies the correct size classes to the fallback wrapper", () => {
    const { rerender } = render(<MerchantAvatar name="Test" size="sm" />);

    let wrapper = screen.getByTitle("Merchant");
    expect(wrapper).toHaveClass("h-5", "w-5");

    rerender(<MerchantAvatar name="Test" size="md" />);
    wrapper = screen.getByTitle("Merchant");
    expect(wrapper).toHaveClass("h-8", "w-8");

    rerender(<MerchantAvatar name="Test" size="lg" />);
    wrapper = screen.getByTitle("Merchant");
    expect(wrapper).toHaveClass("h-12", "w-12");
  });

  it("applies the correct size class to a logo image", () => {
    render(
      <MerchantAvatar
        name="Test"
        logoUrl="https://example.com/logo.png"
        size="lg"
      />
    );

    const img = screen.getByRole("img");
    expect(img).toHaveClass("h-12", "w-12");
  });

  it("uses the category as the wrapper title for the fallback icon", () => {
    render(<MerchantAvatar name="Shoprite" category="Food & Dining" />);

    const wrapper = screen.getByTitle("Food & Dining");
    expect(wrapper).toBeInTheDocument();
    expect(wrapper.querySelector("svg")).toBeInTheDocument();
  });

  it("falls back to the default title when no category is provided", () => {
    render(<MerchantAvatar name="Pick n Pay" />);

    expect(screen.getByTitle("Merchant")).toBeInTheDocument();
  });

  it("renders a fallback icon for an empty name", () => {
    render(<MerchantAvatar name="" />);

    const wrapper = screen.getByTitle("Merchant");
    expect(wrapper).toBeInTheDocument();
    expect(wrapper.querySelector("svg")).toBeInTheDocument();
  });

  it("applies a rounded background to the fallback wrapper", () => {
    render(<MerchantAvatar name="Test" category="Food & Dining" />);

    const wrapper = screen.getByTitle("Food & Dining");
    // The fallback wrapper carries a background + rounded styling.
    expect(wrapper.className).toContain("bg-");
    expect(wrapper.className).toContain("rounded");
  });

  it("has accessible alt text for logo", () => {
    render(
      <MerchantAvatar
        name="Test Merchant"
        logoUrl="https://example.com/logo.png"
      />
    );

    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("alt", "Test Merchant");
  });
});
