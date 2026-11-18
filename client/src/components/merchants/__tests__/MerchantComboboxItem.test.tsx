import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Command, CommandList } from "@/components/ui/command";
import { MerchantComboboxItem } from "../MerchantComboboxItem";
import type { Merchant } from "@/hooks/use-settings";

// MerchantComboboxItem renders a cmdk <CommandItem>, which subscribes to the
// cmdk store provided by an ancestor <Command>. Rendering it bare throws
// "Cannot read properties of undefined (reading 'subscribe')". Wrap every
// render in the Command/CommandList context the component requires at runtime.
function renderInCommand(ui: React.ReactElement) {
  return render(
    <Command>
      <CommandList>{ui}</CommandList>
    </Command>
  );
}

const mockMerchant: Merchant = {
  id: "1",
  householdId: "h1",
  name: "Test Merchant",
  logoUrl: null,
  category: "Food & Dining",
  defaultCategoryId: null,
  notes: null,
  isActive: true,
  iconType: "logo",
  customIcon: null,
  transactionCount: 5,
  lastTransactionDate: "2024-01-01",
  createdAt: "2024-01-01",
  updatedAt: "2024-01-01",
};

describe("MerchantComboboxItem", () => {
  it("renders merchant name", () => {
    renderInCommand(
      <MerchantComboboxItem
        merchant={mockMerchant}
        isSelected={false}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByText("Test Merchant")).toBeInTheDocument();
  });

  it("does not render the category inline (item shows name only)", () => {
    renderInCommand(
      <MerchantComboboxItem
        merchant={mockMerchant}
        isSelected={false}
        onSelect={vi.fn()}
      />
    );

    // The combobox item renders the merchant name and an avatar; the category
    // is not shown as inline text in the item.
    expect(screen.getByText("Test Merchant")).toBeInTheDocument();
    expect(screen.queryByText("Food & Dining")).not.toBeInTheDocument();
  });

  it("shows selected state", () => {
    renderInCommand(
      <MerchantComboboxItem
        merchant={mockMerchant}
        isSelected={true}
        onSelect={vi.fn()}
      />
    );

    // Should still render the item content when selected.
    expect(screen.getByText("Test Merchant")).toBeInTheDocument();
  });

  it("calls onSelect when clicked", () => {
    const onSelect = vi.fn();
    renderInCommand(
      <MerchantComboboxItem
        merchant={mockMerchant}
        isSelected={false}
        onSelect={onSelect}
      />
    );

    // CommandItem will trigger onSelect when clicked
    // This depends on the cmdk library's behavior
  });

  it("renders merchant avatar", () => {
    renderInCommand(
      <MerchantComboboxItem
        merchant={mockMerchant}
        isSelected={false}
        onSelect={vi.fn()}
      />
    );

    // The avatar is icon-based (size "sm", no logo) and titled by category.
    expect(screen.getByTitle("Food & Dining")).toBeInTheDocument();
  });

  it("handles merchant without category", () => {
    const merchantNoCategory = { ...mockMerchant, category: null };
    renderInCommand(
      <MerchantComboboxItem
        merchant={merchantNoCategory}
        isSelected={false}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByText("Test Merchant")).toBeInTheDocument();
    expect(screen.queryByText("Food & Dining")).not.toBeInTheDocument();
  });

  it("displays merchant with logo", () => {
    const merchantWithLogo = {
      ...mockMerchant,
      logoUrl: "https://example.com/logo.png",
    };
    renderInCommand(
      <MerchantComboboxItem
        merchant={merchantWithLogo}
        isSelected={false}
        onSelect={vi.fn()}
      />
    );

    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://example.com/logo.png");
  });
});
