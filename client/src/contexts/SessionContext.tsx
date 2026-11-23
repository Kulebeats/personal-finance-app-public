import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { SessionStatus } from "@shared/session-status";
import { createDataQueryClient, retireDataClient } from "@/lib/queryClient";
import {
  activateOperationLifetime, createOperationLifetime, retireOperationLifetime,
  type OperationLifetime,
} from "@/lib/operation-lifetime";
import {
  fetchSessionStatus, getSessionTransitionError, invalidateSession,
  isSessionTransitionPending, listenForRemoteSessionInvalidation,
  sessionIdentity, subscribeSessionInvalidation,
} from "@/lib/session";
import { isPublicRoute } from "@/lib/public-routes";

interface DataLifetime {
  key: string;
  client: QueryClient;
  operation: OperationLifetime;
}
interface SessionContextValue {
  status: SessionStatus | null;
  error: Error | null;
  actionError: string | null;
  loading: boolean;
  lifetime: DataLifetime | null;
  refresh: () => Promise<void>;
}
const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const publicEntry = isPublicRoute(location);
  const [value, setValue] = useState<Omit<SessionContextValue, "refresh">>({
    status: null, error: null, actionError: null, loading: true, lifetime: null,
  });
  const data = useRef<DataLifetime | null>(null);
  const epoch = useRef(0);
  const inFlight = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null);
  const isPublic = useRef(publicEntry);
  isPublic.current = publicEntry;

  const detach = useCallback(() => {
    if (data.current) {
      retireOperationLifetime(data.current.operation);
      retireDataClient(data.current.client);
      data.current = null;
    }
  }, []);

  const pause = useCallback(() => {
    ++epoch.current;
    inFlight.current?.controller.abort();
    inFlight.current = null;
    detach();
    setValue({ status: null, error: null, actionError: null, loading: true, lifetime: null });
  }, [detach]);

  const refresh: () => Promise<void> = useCallback((): Promise<void> => {
    if (isPublic.current || isSessionTransitionPending()) return Promise.resolve();
    if (inFlight.current) return inFlight.current.promise;
    const requestEpoch = ++epoch.current;
    const controller = new AbortController();
    const promise = fetchSessionStatus(controller.signal).then(status => {
      if (requestEpoch !== epoch.current || controller.signal.aborted || isPublic.current) return;
      const key = sessionIdentity(status);
      if (!data.current || data.current.key !== key) {
        detach();
        if (status.state !== "anonymous") {
          const expectations = "subject" in status ? {
            subject: status.subject.id,
            ...(status.state === "ready" ? { household: status.household.id } : {}),
          } : undefined;
          const operation = createOperationLifetime(expectations);
          activateOperationLifetime(operation);
          const client = createDataQueryClient(withdraw => {
            if (withdraw) invalidateSession();
            else void refresh();
          }, operation);
          data.current = { key, operation, client };
        }
      }
      setValue({
        status, error: null, actionError: getSessionTransitionError(),
        loading: false, lifetime: data.current,
      });
    }).catch((error: unknown) => {
      if (requestEpoch !== epoch.current || controller.signal.aborted) return;
      detach();
      setValue({
        status: null,
        error: error instanceof Error ? error : new Error("Session lookup failed"),
        actionError: getSessionTransitionError(), loading: false, lifetime: null,
      });
    }).finally(() => { if (requestEpoch === epoch.current) inFlight.current = null; });
    inFlight.current = { controller, promise };
    return promise;
  }, [detach]);

  useEffect(() => {
    if (publicEntry) { pause(); return; }
    void refresh();
  }, [location, publicEntry, refresh, pause]);

  useEffect(() => {
    const unsubscribe = subscribeSessionInvalidation(phase => {
      if (phase === "begin") pause();
      else void refresh();
    });
    const remote = listenForRemoteSessionInvalidation(() => { pause(); void refresh(); });
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => {
      unsubscribe();
      remote();
      window.removeEventListener("focus", focus);
      ++epoch.current;
      inFlight.current?.controller.abort();
      inFlight.current = null;
      detach();
    };
  }, [detach, pause, refresh]);

  return <SessionContext.Provider value={{ ...value, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession requires SessionProvider");
  return context;
}

/** Household uploads are unavailable in the personal onboarding shell. */
export function useHouseholdAssetsAllowed(): boolean {
  return useContext(SessionContext)?.status?.state !== "verified_without_household";
}
