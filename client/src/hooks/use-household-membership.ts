/**
 * Members-screen mutations (AH-05): invite by email, transfer ownership and
 * leave the household. Each calls a route in
 * server/modules/household/household.routes.ts with the body its controller
 * validates; the request types are shared with the server (Rule 18).
 */
import { toastActionError } from "@/lib/actionErrorToast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { InviteMemberRequest } from "@shared/household-members";
import { apiCall } from "@/lib/api";
import { invalidateSession } from "@/lib/session";

const MEMBERS_QUERY_KEY = ["householdMembers"];
const HOUSEHOLD_QUERY_KEYS = [["household"], MEMBERS_QUERY_KEY, ["profile"]];

export interface InvitationSummary {
  id: string;
  email: string;
  role: InviteMemberRequest["role"];
  expiresAt: string;
  createdAt: string;
}

export function useInviteMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: InviteMemberRequest) =>
      apiCall<{ data: { invitation: InvitationSummary } }>("/household/invite", {
        method: "POST",
        body: JSON.stringify(request),
      }),
    onSuccess: (_result, request) => {
      queryClient.invalidateQueries({ queryKey: ["householdInvitations"] });
      toast.success(`Invitation sent to ${request.email}`);
    },
    onError: (error: Error) => {
      toastActionError("Failed to send the invitation", error);
    },
  });
}

export function useTransferOwnership() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (newOwnerId: string) =>
      apiCall<unknown>("/household/transfer-ownership", {
        method: "POST",
        body: JSON.stringify({ newOwnerId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MEMBERS_QUERY_KEY });
      toast.success("Ownership transferred. You are now an admin.");
      invalidateSession();
    },
    onError: (error: Error) => {
      toastActionError("Failed to transfer ownership", error);
    },
  });
}

export function useLeaveHousehold() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiCall<unknown>("/household/leave", { method: "POST" }),
    onSuccess: async () => {
      await Promise.all(
        HOUSEHOLD_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      toast.success("You have left the household");
      invalidateSession();
    },
    onError: (error: Error) => {
      toastActionError("Failed to leave the household", error);
    },
  });
}
