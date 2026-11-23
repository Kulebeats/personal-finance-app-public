import { useLayoutEffect, useRef, type ReactNode } from "react";
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
import { buttonVariants } from "@/components/ui/button";

export interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What will happen if the user confirms. */
  description: ReactNode;
  confirmLabel: string;
  /** Runs once, on confirm only; Cancel, Escape and an outside click run nothing. */
  onConfirm: () => void;
}

/**
 * The app's confirm step for a destructive action (NEW-37), in place of the
 * browser's native confirm box. Built on the AlertDialog primitives, so
 * Escape cancels. These dialogs are opened from state (a button, a keyboard
 * shortcut), not an AlertDialogTrigger, and Radix only returns focus to its
 * own trigger; so the element that had focus when the dialog opened is
 * remembered and focused again when it closes.
 */
export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: ConfirmActionDialogProps) {
  const returnFocusTo = useRef<HTMLElement | null>(null);
  // Layout effect: runs before the dialog's focus scope moves focus inside it.
  useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement) {
      returnFocusTo.current = document.activeElement;
    }
  }, [open]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusTo.current?.focus();
          returnFocusTo.current = null;
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
