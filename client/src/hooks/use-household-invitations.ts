/**
 * Pending-invitations screen (AH-05): list, resend and revoke. Each calls a
 * route in server/modules/household/household.routes.ts through apiCall, which
 * adds the CSRF token to the mutating requests. The server answers only owners
 * and admins (invitations.controller.ts).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiCall } from "@/lib/api";
import { toastActionError } from "@/lib/actionErrorToast";
import type { InvitationSummary } from "@/hooks/use-household-membership";

export const INVITATIONS_QUERY_KEY = ["householdInvitations"];

export interface PendingInvitation extends InvitationSummary {
  invitedBy: string;
}

export function usePendingInvitations(isEnabled: boolean) {
  return useQuery({
    queryKey: INVITATIONS_QUERY_KEY,
    queryFn: async (): Promise<PendingInvitation[]> => {
      const response = await apiCall<{ data: { invitations: PendingInvitation[] } }>(
        "/household/invitations",
      );
      return response.data.invitations;
    },
    enabled: isEnabled,
    retry: false,
  });
}

export function useResendInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (invitation: PendingInvitation) =>
      apiCall<{ data: { invitation: InvitationSummary } }>(
        `/household/invitations/${encodeURIComponent(invitation.id)}/resend`,
        { method: "POST" },
      ),
    onSuccess: (_result, invitation) => {
      queryClient.invalidateQueries({ queryKey: INVITATIONS_QUERY_KEY });
      toast.success(`Invitation sent again to ${invitation.email}`);
    },
    onError: (error: Error) => {
      toastActionError("Failed to resend the invitation", error);
    },
  });
}

export function useRevokeInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (invitation: PendingInvitation) =>
      apiCall<void>(`/household/invitations/${encodeURIComponent(invitation.id)}`, {
        method: "DELETE",
      }),
    onSuccess: (_result, invitation) => {
      queryClient.invalidateQueries({ queryKey: INVITATIONS_QUERY_KEY });
      toast.success(`Invitation for ${invitation.email} revoked`);
    },
    onError: (error: Error) => {
      toastActionError("Failed to revoke the invitation", error);
    },
  });
}
