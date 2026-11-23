/**
 * BudgetDialogShell
 *
 * The modal frame for the budget page's settings and edit dialogs. It is a
 * Radix dialog, so it is role="dialog" and aria-modal, named by its title and
 * described by its description; Escape closes it, focus stays inside while it
 * is open and returns to the opener when it closes. A click outside does not
 * close it (a typed amount is not thrown away); the labelled "Close dialog"
 * button and Escape do.
 *
 * Its body scrolls and its footer does not: the frame is capped at 90vh, the
 * header and footer keep their size, and only the body between them shrinks
 * (min-h-0) and scrolls, so Save stays reachable on a short viewport or with
 * large text; the footer's buttons wrap rather than overflow on a narrow
 * screen. With `onSubmit` the body and footer are one form, so Enter in a
 * field and the footer's submit button both submit it.
 */
import { useRef, type FormEvent, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { useDialogOpener, type DialogOpener } from "../hooks/useDialogOpener";
import { cn } from "@/lib/utils";

interface BudgetDialogShellProps {
  isOpen: boolean;
  /** Escape or the close button; not called while `isLocked`. */
  onClose: () => void;
  title: string;
  /** Read to assistive technology as the dialog's description. */
  description: string;
  /** Keeps the dialog open while its save is in flight. */
  isLocked?: boolean;
  className?: string;
  onOpenAutoFocus?: (event: Event) => void;
  /** Wraps body and footer in a form submitted by Enter or a submit button. */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /**
   * The control that opened the dialog, from a useDialogOpener the parent
   * owns. Needed when the parent mounts this dialog already open: its own
   * listener only starts after the opening press.
   */
  opener?: DialogOpener;
  /** Stays in view below the scrolling body. */
  footer: ReactNode;
  /** The scrolling body. */
  children: ReactNode;
}

const FRAME_CLASS = "flex min-h-0 flex-1 flex-col";

/** The scrolling body and the fixed footer, as a form when it submits. */
function DialogFrame({ onSubmit, footer, children }: Pick<BudgetDialogShellProps, "onSubmit" | "footer" | "children">) {
  const content = (
    <>
      <div data-testid="budget-dialog-body" className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <div className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-border bg-muted/10 p-4">{footer}</div>
    </>
  );
  return onSubmit
    ? <form onSubmit={onSubmit} className={FRAME_CLASS}>{content}</form>
    : <div className={FRAME_CLASS}>{content}</div>;
}

export function BudgetDialogShell({
  isOpen,
  onClose,
  title,
  description,
  isLocked = false,
  className,
  onOpenAutoFocus,
  onSubmit,
  opener: parentOpener,
  footer,
  children,
}: BudgetDialogShellProps) {
  // Radix returns focus only to a Dialog.Trigger; these dialogs are opened by
  // page controls (a button, an amount field), so remember the opener when the
  // dialog opens and give it back when it closes. The opener is the control
  // the user pressed (useDialogOpener); a dialog mounted already open has no
  // recorded press, so it falls back to the focused element. A parent that
  // mounts the dialog open passes the press it recorded itself.
  const ownOpener = useDialogOpener(isOpen);
  const pressOpener = parentOpener ?? ownOpener;
  const openerRef = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => { if (!open && !isLocked) onClose(); }}>
      <DialogPortal>
        <DialogOverlay className="bg-black/30 backdrop-blur-none" />
        <DialogPrimitive.Content
          aria-modal="true"
          onOpenAutoFocus={(event) => {
            const focused = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
              ? document.activeElement : null;
            openerRef.current = pressOpener.take() ?? focused;
            onOpenAutoFocus?.(event);
          }}
          onCloseAutoFocus={(event) => {
            const opener = openerRef.current;
            openerRef.current = null;
            if (!opener?.isConnected) return;
            event.preventDefault();
            opener.focus();
          }}
          onInteractOutside={(event) => event.preventDefault()}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg",
            className,
          )}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border p-4">
            <DialogPrimitive.Title className="text-lg font-bold text-foreground">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Close dialog"
              disabled={isLocked}
              className="inline-flex items-center justify-center rounded p-1 hover:bg-muted disabled:opacity-60 max-md:min-h-11 max-md:min-w-11"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">{description}</DialogPrimitive.Description>
          <DialogFrame onSubmit={onSubmit} footer={footer}>{children}</DialogFrame>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
