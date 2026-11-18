/**
 * Pension Hooks
 *
 * TanStack Query hooks for pension holdings and contributions.
 *
 * @module hooks/investments/usePension
 */

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../lib/queryClient";
import { investmentKeys } from "./keys";
import type { PensionHolding, PensionContribution } from "./types";

export function usePensionHoldings() {
  return useQuery({
    queryKey: investmentKeys.pension(),
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/investments/pension");
      return response.json();
    },
    select: (data) => data.data as PensionHolding[],
  });
}

export function usePensionContributions(pensionHoldingId: string) {
  return useQuery({
    queryKey: investmentKeys.pensionContributions(pensionHoldingId),
    queryFn: async () => {
      const response = await apiRequest(
        "GET",
        `/api/investments/pension/${pensionHoldingId}/contributions`
      );
      return response.json();
    },
    select: (data) => data.data as PensionContribution[],
    enabled: !!pensionHoldingId,
  });
}
