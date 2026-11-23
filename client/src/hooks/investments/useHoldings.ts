/**
 * Holdings Hooks
 *
 * TanStack Query hooks for investment holdings management.
 *
 * @module hooks/investments/useHoldings
 */

import { userErrorMessage } from "@/lib/errorCopy";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { investmentKeys } from "./keys";
import type { Holding } from "./types";
import { assertOperationLifetime, captureOperationLifetime } from "@/lib/operation-lifetime";
import { valuationQueryPolicy } from "./valuationQueryPolicy";

export interface CreateHoldingInput {
  operationId: string;
  expectedCurrency: string;
  accountId: string;
  securityId: string;
  quantity: string;
  costBasis: string;
  acquiredDate: string;
  costBasisZmw?: string;
  acquisitionFxRate?: string;
}

export function useHoldings(
  accountIdOrOptions?:
    | string
    | {
        accountId?: string;
        baseCurrency?: string;
      }
) {
  const options =
    typeof accountIdOrOptions === "string"
      ? { accountId: accountIdOrOptions }
      : accountIdOrOptions;
  const resolvedAccountId = options?.accountId;
  const baseCurrency = options?.baseCurrency;

  return useQuery({
    ...valuationQueryPolicy,
    queryKey: resolvedAccountId
      ? investmentKeys.holdingsByAccount(resolvedAccountId, baseCurrency)
      : investmentKeys.holdings(baseCurrency),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (resolvedAccountId) params.append("accountId", resolvedAccountId);
      if (baseCurrency) params.append("baseCurrency", baseCurrency);
      const query = params.toString();
      const url = query
        ? `/api/investments/holdings?${query}`
        : "/api/investments/holdings";
      const response = await apiRequest("GET", url);
      return response.json();
    },
    select: (data: { data: Holding[]; meta?: { baseCurrency?: string } }) =>
      data.data.map(holding => ({ ...holding, baseCurrency: data.meta?.baseCurrency ?? holding.baseCurrency })),
  });
}

export function useCreateHolding() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const operation = captureOperationLifetime();

  return useMutation({
    mutationKey: [...investmentKeys.holdingsRoot(), "create"],
    mutationFn: async (data: Readonly<CreateHoldingInput>) => {
      assertOperationLifetime(operation);
      const response = await apiRequest(
        "POST",
        "/api/investments/holdings",
        data,
        operation,
      );
      const result = await response.json();
      assertOperationLifetime(operation);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: investmentKeys.holdingsRoot() });
      queryClient.invalidateQueries({
        queryKey: investmentKeys.portfolioSummaryRoot(),
      });
      toast({
        title: "Holding Added",
        description: "Your investment has been recorded.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: userErrorMessage(error, "Failed to add holding"),
        variant: "destructive",
      });
    },
  });
}

export function useUpdateHolding() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<Holding>;
    }) => {
      const response = await apiRequest(
        "PUT",
        `/api/investments/holdings/${id}`,
        data
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: investmentKeys.holdingsRoot() });
      queryClient.invalidateQueries({
        queryKey: investmentKeys.portfolioSummaryRoot(),
      });
      toast({
        title: "Holding Updated",
        description: "Your investment has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: userErrorMessage(error, "Failed to update holding"),
        variant: "destructive",
      });
    },
  });
}

export function useDeleteHolding() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const operation = captureOperationLifetime();
  const roots = [investmentKeys.holdingsRoot(), investmentKeys.portfolioSummaryRoot()];
  const cancelReads = async () => {
    assertOperationLifetime(operation);
    await Promise.all(roots.map(queryKey => queryClient.cancelQueries({ queryKey })));
    assertOperationLifetime(operation);
  };
  const refresh = async () => {
    // Cancel first reads after the acknowledgement, including reads begun during DELETE.
    await cancelReads();
    await Promise.all(roots.map(queryKey => queryClient.invalidateQueries({ queryKey, refetchType: "active" })));
    assertOperationLifetime(operation);
  };

  return useMutation({
    mutationKey: [...investmentKeys.holdingsRoot(), "delete"],
    mutationFn: async (id: string) => {
      assertOperationLifetime(operation);
      const response = await apiRequest(
        "DELETE",
        `/api/investments/holdings/${id}`,
        undefined,
        operation,
      );
      // The acknowledgement is an empty 204, including a same-actor replay.
      assertOperationLifetime(operation);
      if (response.status !== 204) {
        throw Object.assign(new Error("The server returned an unexpected removal response. Retry the same holding."), {
          status: response.status,
          code: "UNEXPECTED_DELETE_ACKNOWLEDGEMENT",
        });
      }
    },
    onSuccess: async () => {
      await refresh();
      toast({
        title: "Holding Removed",
        description: "The holding has been deleted.",
      });
    },
    onError: async (error: Error & { status?: number }) => {
      assertOperationLifetime(operation);
      if (error.status === 404 || error.status === 409) await refresh();
      toast({
        title: "Error",
        description: userErrorMessage(error, "Failed to delete holding"),
        variant: "destructive",
      });
    },
  });
}
