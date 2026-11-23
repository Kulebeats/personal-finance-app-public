import { LogOut } from "lucide-react";
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
import type { HouseholdRole } from "@shared/household-members";
import { useLeaveHousehold } from "@/hooks/use-household-membership";

interface LeaveHouseholdButtonProps {
  currentUserRole: HouseholdRole | undefined;
}

/**
 * AH-05: lets any member except the owner leave. The owner must transfer
 * ownership first; the server refuses an owner's leave as well (NEW-12).
 */
export function LeaveHouseholdButton({ currentUserRole }: LeaveHouseholdButtonProps) {
  const leave = useLeaveHousehold();

  if (!currentUserRole) {
    return null;
  }
  if (currentUserRole === "owner") {
    return (
      <p className="text-sm text-muted-foreground">
        Transfer ownership to another member before you can leave this household.
      </p>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={leave.isPending} className="text-destructive">
          <LogOut className="w-4 h-4 mr-2" aria-hidden="true" />
          Leave household
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave this household?</AlertDialogTitle>
          <AlertDialogDescription>
            You will lose access to this household's shared finances straight
            away. To come back, ask the owner or an admin to invite you again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => leave.mutate()}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
