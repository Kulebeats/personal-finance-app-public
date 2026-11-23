import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { flushSync } from "react-dom";

const DESKTOP_QUERY = "(min-width: 768px)";
const HISTORY_EVENTS = ["popstate", "pushState", "replaceState", "hashchange"] as const;
type CloseIntent = "dismiss" | "navigation" | "breakpoint";
type DestinationFocus = { destination: string; cancel: () => void };
let pendingDestinationFocus: DestinationFocus | null = null;

function queueDestinationFocus(destination: string) {
  pendingDestinationFocus?.cancel();
  const cancel = () => {
    document.removeEventListener("focusin", onFocus);
    document.removeEventListener("pointerdown", cancel, true);
    document.removeEventListener("keydown", cancel, true);
    HISTORY_EVENTS.forEach(name => window.removeEventListener(name, cancel, true));
    window.clearTimeout(expiry);
    if (pendingDestinationFocus === request) pendingDestinationFocus = null;
  };
  const onFocus = (event: FocusEvent) => {
    if (event.target !== document.body) cancel();
  };
  const request = { destination, cancel };
  const expiry = window.setTimeout(cancel, 30_000);
  pendingDestinationFocus = request;
  document.addEventListener("focusin", onFocus);
  document.addEventListener("pointerdown", cancel, true);
  document.addEventListener("keydown", cancel, true);
  HISTORY_EVENTS.forEach(name => window.addEventListener(name, cancel, true));
}

export function useApplicationNavigation(location: string) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const desktopRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const openRef = useRef(false);
  const closeIntent = useRef<CloseIntent>("dismiss");
  const navigationTarget = useRef<string | null>(null);
  const previousLocation = useRef(location);
  const browserPath = useRef(window.location.pathname);

  const focusDesktop = () => {
    const navigation = desktopRef.current;
    const target = navigation?.querySelector<HTMLElement>('a[aria-current="page"]');
    (target ?? mainRef.current)?.focus();
  };

  const onOpenChange = (open: boolean) => {
    if (open && window.matchMedia(DESKTOP_QUERY).matches) return;
    closeIntent.current = "dismiss";
    navigationTarget.current = null;
    openRef.current = open;
    if (open) setLeaving(false);
    setMobileOpen(open);
  };

  const onNavigate = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey ||
      event.ctrlKey || event.altKey || event.shiftKey) return;
    closeIntent.current = href === location ? "dismiss" : "navigation";
    navigationTarget.current = href === location ? null : href;
    openRef.current = false;
    // An exit animation can be retained by Suspense with its modal locks.
    // Remove the content before a changed route can suspend the source page.
    flushSync(() => {
      if (href !== location) setLeaving(true);
      setMobileOpen(false);
    });
  };

  useEffect(() => {
    const request = pendingDestinationFocus;
    if (!request) return;
    request.cancel();
    const focused = document.activeElement;
    if (request.destination === location &&
      (focused === document.body || focused === document.documentElement)) {
      mainRef.current?.focus();
    }
  }, [location]);

  useLayoutEffect(() => {
    if (previousLocation.current !== location) {
      previousLocation.current = location;
      if (openRef.current || contentRef.current) {
        closeIntent.current = "navigation";
        navigationTarget.current = location;
        openRef.current = false;
        setLeaving(true);
        setMobileOpen(false);
      }
    }
  }, [location]);

  useEffect(() => {
    const onBrowserRouteChange = () => {
      pendingDestinationFocus?.cancel();
      const nextPath = window.location.pathname;
      if (nextPath === browserPath.current) return;
      browserPath.current = nextPath;
      if (openRef.current || contentRef.current) {
        closeIntent.current = "navigation";
        navigationTarget.current = nextPath;
        openRef.current = false;
        flushSync(() => {
          setLeaving(true);
          setMobileOpen(false);
        });
      } else if (navigationTarget.current !== nextPath) {
        closeIntent.current = "dismiss";
        navigationTarget.current = null;
        setLeaving(false);
      }
    };
    // Wouter's browser hook listens in the bubble phase. Dismiss before a
    // history change can suspend the route and retain the previous portal.
    HISTORY_EVENTS.forEach(name => window.addEventListener(name, onBrowserRouteChange, true));
    return () => {
      HISTORY_EVENTS.forEach(name => window.removeEventListener(name, onBrowserRouteChange, true));
    };
  }, []);

  useEffect(() => {
    const desktop = window.matchMedia(DESKTOP_QUERY);
    type Surface = "trigger" | "desktop" | null;
    const surfaceFor = (target: EventTarget | null): Surface => {
      if (target === triggerRef.current) return "trigger";
      return target instanceof Node && desktopRef.current?.contains(target) ? "desktop" : null;
    };
    const isNeutral = (target: EventTarget | null) =>
      target === null || target === document.body || target === document.documentElement;
    const isHidden = (surface: Surface) =>
      surface === "trigger" ? desktop.matches : surface === "desktop" && !desktop.matches;
    let focusedSurface = surfaceFor(document.activeElement);
    const onFocusIn = (event: FocusEvent) => {
      if (isNeutral(event.target) && isHidden(focusedSurface)) return;
      focusedSurface = surfaceFor(event.target);
    };
    const onFocusOut = (event: FocusEvent) => {
      const surface = surfaceFor(event.target);
      // CSS can blur a newly hidden control before matchMedia emits change.
      // An intentional blur while it is still visible releases ownership.
      if (surface) {
        focusedSurface = isHidden(surface) && isNeutral(event.relatedTarget) ? surface : null;
      }
    };
    const onInteraction = () => { focusedSurface = surfaceFor(document.activeElement); };
    const onBreakpointChange = () => {
      if (desktop.matches && openRef.current) {
        closeIntent.current = "breakpoint";
        openRef.current = false;
        setMobileOpen(false);
        return;
      }
      if (openRef.current) return;
      const focused = document.activeElement;
      const surface = surfaceFor(focused) ?? (isNeutral(focused) ? focusedSurface : null);
      if (desktop.matches && surface === "trigger") focusDesktop();
      if (!desktop.matches && surface === "desktop") {
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("pointerdown", onInteraction, true);
    document.addEventListener("keydown", onInteraction, true);
    desktop.addEventListener("change", onBreakpointChange);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("pointerdown", onInteraction, true);
      document.removeEventListener("keydown", onInteraction, true);
      desktop.removeEventListener("change", onBreakpointChange);
    };
  }, []);

  useLayoutEffect(() => () => {
    // A matching destination consumes this once, including after a lazy gap.
    if (navigationTarget.current) queueDestinationFocus(navigationTarget.current);
  }, []);

  const onCloseAutoFocus = (event: Event) => {
    event.preventDefault();
    const focused = document.activeElement;
    const focusMoved = focused instanceof HTMLElement && focused.isConnected &&
      focused !== document.body && focused !== triggerRef.current &&
      !contentRef.current?.contains(focused);

    // Radix defers this callback. A destination or subsequent dialog may have
    // already received focus while the previous Layout was being removed.
    const intent = closeIntent.current;
    const destinationPending = navigationTarget.current !== null &&
      navigationTarget.current !== location;
    closeIntent.current = "dismiss";
    navigationTarget.current = null;
    if (destinationPending || (focusMoved && (intent !== "dismiss" ||
      focused.closest('[role="dialog"]')))) return;
    if (window.matchMedia(DESKTOP_QUERY).matches) {
      if (desktopRef.current) focusDesktop();
    } else if (triggerRef.current?.isConnected) {
      triggerRef.current.focus();
    }
  };

  return { mobileOpen, leaving, triggerRef, desktopRef, contentRef, mainRef,
    onOpenChange, onNavigate, onCloseAutoFocus };
}
