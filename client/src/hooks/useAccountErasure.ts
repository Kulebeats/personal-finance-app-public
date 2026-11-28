/**
 * AH-08 (d): the client caller of POST /api/settings/account/delete (DPA right
 * to erasure). The route needs a DESTRUCTIVE step-up; apiCall answers its
 * 401 STEP_UP_REQUIRED by opening the step-up dialog and retrying once. The
 * body carries the current password, which the controller checks again. On
 * success the server has already ended the session, so the app drops its
 * session state and leaves for the sign-in page.
 */
import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiCall } from "@/lib/api";
import { invalidateSession } from "@/lib/session";

export const ERASURE_REDIRECT = "/login";
const ERASURE_MUTATION_KEY = ["accountErasure"] as const;

function leaveForSignIn(): void {
  invalidateSession();
  globalThis.location.assign(ERASURE_REDIRECT);
}

export function useAccountErasure(onErased: () => void = leaveForSignIn) {
  return useMutation({
    mutationKey: ERASURE_MUTATION_KEY,
    mutationFn: (password: string) =>
      apiCall<{ success: true }>("/settings/account/delete", {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
    onSuccess: () => onErased(),
    gcTime: 0,
  });
}

/**
 * gcTime 0 drops a settled attempt once nothing observes it, but TanStack
 * keeps a PENDING mutation and its variables (the password) until it settles,
 * for example while the step-up dialog is open. The erasure dialog calls this
 * on close and unmount.
 */
export function useForgetErasurePassword(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    const cache = queryClient.getMutationCache();
    cache.findAll({ mutationKey: ERASURE_MUTATION_KEY }).forEach((mutation) => cache.remove(mutation));
  }, [queryClient]);
}
