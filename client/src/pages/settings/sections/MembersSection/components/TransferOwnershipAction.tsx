import { useState } from "react";
import { Crown } from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import { useTransferOwnership } from "@/hooks/use-household-membership";

interface TransferOwnershipActionProps {
  memberUserId: string;
  memberName: string;
}

/**
 * Owner-only control on another member's row (AH-05): hands the household to
 * that member after a confirmation. The server demotes the current owner to
 * admin in the same transaction (NEW-12).
 */
export function TransferOwnershipAction({ memberUserId, memberName }: TransferOwnershipActionProps) {
  const transfer = useTransferOwnership();
  const [isConfirming, setIsConfirming] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsConfirming(true)}
        disabled={transfer.isPending}
        aria-label={`Make ${memberName} the owner`}
      >
        <Crown className="w-4 h-4" aria-hidden="true" />
      </Button>
      <AlertDialog open={isConfirming} onOpenChange={setIsConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transfer ownership?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-semibold">{memberName}</span> becomes the
              household owner and you become an admin. Only the new owner can
              transfer it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => transfer.mutate(memberUserId, { onSettled: () => setIsConfirming(false) })}
            >
              Transfer ownership
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
