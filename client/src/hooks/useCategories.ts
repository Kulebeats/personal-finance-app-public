/**
 * Category Hooks
 *
 * TanStack Query hooks for fetching categories.
 */

import { useQuery } from "@tanstack/react-query";

// Types matching server response
import { Category } from "@/lib/api";
export type { Category };

// Types matching server response

export interface CategoryGroup {
  id: string;
  householdId: string;
  name: string;
  type: "expenses" | "income" | "transfers";
  displayOrder: number | null;
  budgetMode: string;
  rolloverEnabled: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CategoriesApiResponse {
  success: boolean;
  data: {
    categories: Category[];
    groups: CategoryGroup[];
  };
}

// API call helper
async function fetchCategories(
  includeArchived = false
): Promise<{ categories: Category[]; groups: CategoryGroup[] }> {
  const query = includeArchived ? "?includeArchived=true" : "";
  const response = await fetch(`/api/categories${query}`, {
    credentials: "include",
  });
  const data: CategoriesApiResponse = await response.json();
  if (!response.ok) {
    throw new Error("Failed to fetch categories");
  }
  return data.data;
}

// Query keys
export const categoryKeys = {
  all: ["categories"] as const,
  list: (params?: { includeArchived?: boolean }) =>
    [...categoryKeys.all, "list", params] as const,
};

/**
 * Hook to fetch all categories
 */
export function useCategories(params?: { includeArchived?: boolean }) {
  return useQuery({
    queryKey: categoryKeys.list(params),
    queryFn: () => fetchCategories(params?.includeArchived),
    staleTime: 60_000, // 1 minute
  });
}

/**
 * Helper to get category by ID from cached data
 */
export function findCategoryById(
  categories: Category[] | undefined,
  id: string | null | undefined
): Category | undefined {
  if (!categories || !id) return undefined;
  return categories.find((c) => c.id === id);
}

/**
 * Helper to get category by name from cached data
 */
export function findCategoryByName(
  categories: Category[] | undefined,
  name: string | null | undefined
): Category | undefined {
  if (!categories || !name) return undefined;
  return categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
}
