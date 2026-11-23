import { toastActionError } from "@/lib/actionErrorToast";
import { authApi } from "@/lib/api";

/** Sign out from a session gate (verification, MFA); a failure is toasted. */
export function signOut(): void {
  void authApi.logout().catch(error => {
    toastActionError("Unable to sign out", error);
  });
}
