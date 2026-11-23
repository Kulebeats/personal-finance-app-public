/**
 * The error toast for a failed user action (UX misc toast sweep).
 *
 * The caller's sentence for the action ("Failed to delete preset") is the
 * toast's title, so it always says what went wrong. The description is the
 * plain copy for the error's code or status (see errorCopy.ts), never the
 * server's own text; when the error says nothing more, it asks the user to
 * try again.
 */
import { toast } from "sonner";
import { userErrorMessage } from "./errorCopy";

export const ACTION_ERROR_FALLBACK = "Please try again.";

export function toastActionError(title: string, error: unknown, fallback: string = ACTION_ERROR_FALLBACK): void {
  toast.error(title, { description: userErrorMessage(error, fallback) });
}
