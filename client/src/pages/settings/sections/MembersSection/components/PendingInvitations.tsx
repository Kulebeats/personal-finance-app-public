import { formatDistanceToNow } from "date-fns";
import { Mail, RotateCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  usePendingInvitations,
  useResendInvitation,
  useRevokeInvitation,
  type PendingInvitation,
} from "@/hooks/use-household-invitations";
import { userErrorMessage } from "@/lib/errorCopy";
import { ROLE_LABELS } from "../roleDescriptions";

interface PendingInvitationsProps {
  canManage: boolean;
}

/**
 * AH-05: the owner's and admins' view of invitations nobody has accepted yet,
 * with resend (a new link and a fresh expiry) and revoke (after a confirm).
 */
export function PendingInvitations({ canManage }: PendingInvitationsProps) {
  const invitations = usePendingInvitations(canManage);

  if (!canManage) {
    return null;
  }

  return (
    <section aria-labelledby="pending-invitations-heading" className="mt-6">
      <h3 id="pending-invitations-heading" className="text-sm font-medium">
        Pending invitations
      </h3>
      {invitations.isLoading ? (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          Loading invitations…
        </p>
      ) : invitations.isError ? (
        <div role="alert" className="mt-2 flex items-center gap-2 text-sm text-destructive">
          <span>
            Could not load invitations. {userErrorMessage(invitations.error, "Please try again.")}
          </span>
          <Button variant="outline" size="sm" onClick={() => invitations.refetch()}>
            Try again
          </Button>
        </div>
      ) : !invitations.data?.length ? (
        <p className="mt-2 text-sm text-muted-foreground">No invitations are waiting.</p>
      ) : (
        <ul className="mt-2 divide-y rounded-md border" aria-label="Pending invitations">
          {invitations.data.map((invitation) => (
            <InvitationRow key={invitation.id} invitation={invitation} />
          ))}
        </ul>
      )}
    </section>
  );
}

function InvitationRow({ invitation }: { invitation: PendingInvitation }) {
  const resend = useResendInvitation();
  const revoke = useRevokeInvitation();
  const isBusy = resend.isPending || revoke.isPending;
  const expires = formatDistanceToNow(new Date(invitation.expiresAt), { addSuffix: true });

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 p-3">
      <div className="flex min-w-0 items-center gap-2">
        <Mail className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate text-sm font-medium">{invitation.email}</span>
        <Badge variant="outline" className="text-xs">
          {ROLE_LABELS[invitation.role]}
        </Badge>
        <span className="text-xs text-muted-foreground">Expires {expires}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={isBusy}
          onClick={() => resend.mutate(invitation)}
          aria-label={`Resend invitation to ${invitation.email}`}
        >
          <RotateCw className="mr-1 h-4 w-4" aria-hidden="true" />
          Resend
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={isBusy}
              className="text-destructive"
              aria-label={`Revoke invitation to ${invitation.email}`}
            >
              <X className="mr-1 h-4 w-4" aria-hidden="true" />
              Revoke
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke this invitation?</AlertDialogTitle>
              <AlertDialogDescription>
                The link sent to {invitation.email} will stop working straight away. You can
                invite them again later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep invitation</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => revoke.mutate(invitation)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Revoke invitation
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}
