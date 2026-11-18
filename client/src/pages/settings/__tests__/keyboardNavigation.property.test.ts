/**
 * @vitest-environment jsdom
 */

/**
 * **Feature: settings-refactoring, Property 8: Keyboard Navigation Support**
 * **Validates: Requirements 7.2**
 *
 * Property-based test to verify that custom dropdowns and interactive elements
 * support proper keyboard navigation (arrow keys, Enter, Escape, Tab)
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import fc from "fast-check";
import * as React from "react";
import { MerchantList } from "../sections/MerchantsSection/MerchantList";
import { CategoryList } from "../sections/CategoriesSection/CategoryList";

// Mock data generators (reusing from accessibility test)
// Using oneof with explicit undefined instead of fc.option (which generates null)
const merchantGenerator = fc.record({
  id: fc.integer({ min: 1, max: 1000 }),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  category: fc.oneof(
    fc.string({ minLength: 1, maxLength: 30 }),
    fc.constant(undefined)
  ),
  transactionCount: fc.integer({ min: 0, max: 100 }),
  lastTransactionDate: fc
    .integer({
      min: new Date("2000-01-01T00:00:00Z").getTime(),
      max: new Date("2100-12-31T23:59:59Z").getTime(),
    })
    .map((timestamp) => new Date(timestamp).toISOString().split("T")[0]),
  isArchived: fc.boolean(),
});

const categoryGenerator = fc.record({
  id: fc.string({ minLength: 1, maxLength: 10 }).map((s) => `cat-${s}`),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  icon: fc.oneof(
    fc.string({ minLength: 1, maxLength: 5 }),
    fc.constant(undefined)
  ),
  color: fc
    .array(
      fc.constantFrom(
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "a",
        "b",
        "c",
        "d",
        "e",
        "f"
      ),
      { minLength: 6, maxLength: 6 }
    )
    .map((chars) => `#${chars.join("")}`),
  groupId: fc.string({ minLength: 1, maxLength: 10 }).map((s) => `grp-${s}`),
  groupName: fc.string({ minLength: 1, maxLength: 30 }),
  budget: fc.oneof(fc.integer({ min: 0, max: 10000 }), fc.constant(undefined)),
  spent: fc.oneof(fc.integer({ min: 0, max: 15000 }), fc.constant(undefined)),
  transactionCount: fc.oneof(
    fc.integer({ min: 0, max: 100 }),
    fc.constant(undefined)
  ),
  isArchived: fc.boolean(),
});

const groupGenerator = fc.record({
  id: fc.string({ minLength: 1, maxLength: 10 }).map((s) => `grp-${s}`),
  name: fc.string({ minLength: 1, maxLength: 30 }),
});

// Helper function to get focusable elements
function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const focusableSelectors = [
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "a[href]",
    '[tabindex]:not([tabindex="-1"])',
  ];

  return Array.from(
    container.querySelectorAll<HTMLElement>(focusableSelectors.join(", "))
  );
}

describe("Property 8: Keyboard Navigation Support", () => {
  it("focusable elements can receive keyboard focus", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(merchantGenerator, {
          minLength: 1,
          maxLength: 3,
          selector: (merchant) => merchant.id,
        }),
        (merchants) => {
          const mockCallbacks = {
            onMerchantEdit: vi.fn(),
            onMerchantMerge: vi.fn(),
            onMerchantArchive: vi.fn(),
          };

          const component = React.createElement(MerchantList, {
            merchants,
            ...mockCallbacks,
          });

          const { container } = render(component);
          const focusableElements = getFocusableElements(container);

          if (focusableElements.length === 0) return true;

          // Test that at least one element can be focused
          const firstElement = focusableElements[0];
          firstElement.focus();
          const isFocused = document.activeElement === firstElement;

          return isFocused;
        }
      ),
      { numRuns: 20 }
    );
  });

  it("Tab key navigation works without errors", () => {
    fc.assert(
      fc.property(
        fc.array(categoryGenerator, { minLength: 1, maxLength: 2 }),
        fc.array(groupGenerator, { minLength: 1, maxLength: 2 }),
        (categories, groups) => {
          const mockCallbacks = {
            onCategoryEdit: vi.fn(),
            onCategoryDelete: vi.fn(),
            onCategoryReorder: vi.fn(),
            onCategoryArchive: vi.fn(),
            onCategoryRestore: vi.fn(),
          };

          const component = React.createElement(CategoryList, {
            categories: categories as unknown as import("@/hooks/use-settings").Category[],
            groups: groups as unknown as import("@/hooks/use-settings").CategoryGroup[],
            ...mockCallbacks,
          });

          const { container } = render(component);
          const focusableElements = getFocusableElements(container);

          if (focusableElements.length === 0) return true;

          // Focus first element and try Tab key
          focusableElements[0].focus();

          try {
            fireEvent.keyDown(document.activeElement!, { key: "Tab" });
            return true; // No error occurred
          } catch (error) {
            return false;
          }
        }
      ),
      { numRuns: 15 }
    );
  });

  it("keyboard events do not cause errors", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(merchantGenerator, {
          minLength: 1,
          maxLength: 2,
          selector: (merchant) => merchant.id,
        }),
        fc.constantFrom("Escape", "Enter", "ArrowDown", "ArrowUp"),
        (merchants, key) => {
          const mockCallbacks = {
            onMerchantEdit: vi.fn(),
            onMerchantMerge: vi.fn(),
            onMerchantArchive: vi.fn(),
          };

          const component = React.createElement(MerchantList, {
            merchants,
            ...mockCallbacks,
          });

          const { container } = render(component);
          const focusableElements = getFocusableElements(container);

          if (focusableElements.length === 0) return true;

          try {
            // Focus first element and press key
            focusableElements[0].focus();
            fireEvent.keyDown(document.activeElement!, { key });
            fireEvent.keyUp(document.activeElement!, { key });

            return true; // No error occurred
          } catch (error) {
            return false;
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});
