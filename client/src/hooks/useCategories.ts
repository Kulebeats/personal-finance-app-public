import { protectedFetch } from "@/lib/protected-fetch";
/**
 * Category Hooks
 *
 * TanStack Query hooks for fetching categories.
 */

import { useQuery } from "@tanstack/react-query";

// Types matching server response
import { Category } from "@/lib/api";
import { throwIfResNotOk } from "@/lib/queryClient";
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
  const response = await protectedFetch(`/api/categories${query}`, {
    credentials: "include",
  });
  await throwIfResNotOk(response);
  const data: CategoriesApiResponse = await response.json();
  // The endpoint returns groups separately; picker filtering needs their type.
  // Resolve only references supplied for this category's own household.
  const groupsById = new Map(data.data.groups.map(group => [group.id, group]));
  return {
    ...data.data,
    categories: data.data.categories.map(category => {
      const candidate = category.groupId ? groupsById.get(category.groupId) : undefined;
      const group = candidate && candidate.householdId === category.householdId ? candidate : undefined;
      return { ...category, groupName: group?.name ?? null, groupType: group?.type ?? null };
    }),
  };
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
