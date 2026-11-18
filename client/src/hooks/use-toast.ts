import * as React from "react"
import { toast as sonnerToast } from "sonner"

import type {
  ToastActionElement,
  ToastProps,
} from "@/components/ui/toast"

/**
 * Thin adapter that preserves the legacy shadcn `useToast`/`toast` public API
 * while delegating to `sonner` under the hood. This lets every existing call
 * site keep its exact signatures (`toast({ title, description, variant })`)
 * after the app consolidated onto a single sonner `<Toaster />`.
 */

type ToasterToast = ToastProps & {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: ToastActionElement
}

type Toast = Omit<ToasterToast, "id">

function toast({ title, description, variant, action }: Toast) {
  const message = title ?? ""
  const options = {
    description,
    // sonner accepts a ReactNode for `action`; legacy call sites pass a
    // <ToastAction> element, which renders as-is.
    action: action as React.ReactNode,
  }

  const sonnerId =
    variant === "destructive"
      ? sonnerToast.error(message, options)
      : sonnerToast(message, options)

  const id = String(sonnerId)

  return {
    id,
    dismiss: () => sonnerToast.dismiss(sonnerId),
    // No-op: sonner has no equivalent in-place update for this adapter's
    // narrowed surface. Retained for signature compatibility.
    update: () => {},
  }
}

function useToast() {
  return {
    toast,
    dismiss: (toastId?: string) => sonnerToast.dismiss(toastId),
    // Legacy consumers read `toasts` to render their own viewport. With sonner
    // owning rendering, this is always empty.
    toasts: [] as ToasterToast[],
  }
}

export { useToast, toast }
