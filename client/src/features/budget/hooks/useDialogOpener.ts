import { useEffect, useRef, useState } from "react";

const INTERACTIVE = "button, a[href], input, select, textarea, [role='button'], [tabindex]:not([tabindex='-1'])";
/** A press counts as the opener only if the dialog opens within this long of it. */
const OPENER_WINDOW_MS = 1000;

/** The control that opened a dialog, handed out once (see useDialogOpener). */
export interface DialogOpener {
  /** The control pressed just before the dialog opened, or null; clears it. */
  take: () => HTMLElement | null;
}

interface Press { target: HTMLElement; at: number }

const hasFocusedElement = (): boolean =>
  document.activeElement instanceof HTMLElement && document.activeElement !== document.body;

/**
 * The control the user pressed to open a dialog, recorded from the event
 * itself rather than from document.activeElement: Safari does not focus a
 * button it opens by pointer, so the focused element there is not the opener.
 * While the dialog is closed, the last pointerdown, keydown or click on an
 * interactive element is remembered (a click, because assistive technology
 * can activate a control with a synthesized click and no pointer or key
 * event). `take()` returns it when it happened within OPENER_WINDOW_MS, so
 * an old press elsewhere never wins over the focused element, and clears it
 * once used. An older press is still returned when nothing is focused (Safari
 * after a pointer press), since then it is the only opener left.
 */
export function useDialogOpener(isOpen: boolean): DialogOpener {
  const lastPressRef = useRef<Press | null>(null);
  const [opener] = useState<DialogOpener>(() => ({
    take: () => {
      const press = lastPressRef.current;
      lastPressRef.current = null;
      if (!press?.target.isConnected) return null;
      if (performance.now() - press.at <= OPENER_WINDOW_MS) return press.target;
      return hasFocusedElement() ? null : press.target;
    },
  }));
  useEffect(() => {
    if (isOpen) return;
    const remember = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(INTERACTIVE) : null;
      if (target) lastPressRef.current = { target, at: performance.now() };
    };
    const events = ["pointerdown", "keydown", "click"] as const;
    events.forEach((type) => document.addEventListener(type, remember, true));
    return () => events.forEach((type) => document.removeEventListener(type, remember, true));
  }, [isOpen]);
  return opener;
}
