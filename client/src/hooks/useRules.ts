/**
 * Rules Hooks
 *
 * React Query hooks for auto-categorization rules.
 *
 * @module hooks/useRules
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { rulesApi, type Rule, type CreateRuleInput } from "@/lib/api";

/**
 * Fetch all rules for the household
 */
export function useRules() {
  return useQuery({
    queryKey: ["rules"],
    queryFn: () => rulesApi.list(),
  });
}

/**
 * Fetch a single rule by ID
 */
export function useRule(id: string) {
  return useQuery({
    queryKey: ["rules", id],
    queryFn: () => rulesApi.get(id),
    enabled: !!id,
  });
}

/**
 * Create a new rule
 */
export function useCreateRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateRuleInput) => rulesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
    },
  });
}

/**
 * Update an existing rule
 */
export function useUpdateRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreateRuleInput>;
    }) => rulesApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      queryClient.invalidateQueries({ queryKey: ["rules", id] });
    },
  });
}

/**
 * Delete a rule
 */
export function useDeleteRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => rulesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
    },
  });
}

export type { Rule, CreateRuleInput } from "@/lib/api";
