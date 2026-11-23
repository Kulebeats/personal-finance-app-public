import { useEffect, useRef, useState } from "react";
import { useSession } from "@/contexts/SessionContext";
import { useUserPreferences, useUpdateUserPreferences } from "@/hooks/use-settings";
import { assertOperationLifetime, captureOperationLifetime } from "@/lib/operation-lifetime";
import type { UserPreferencesResponse } from "@shared/user-preferences";

type SavedFilter = UserPreferencesResponse["defaultAccountFilter"];
export function useAccountOwnerPreference() {
  const query = useUserPreferences();
  const session = useSession();
  const currentUserId = session.status && "subject" in session.status ? session.status.subject.id : undefined;
  const { mutateAsync } = useUpdateUserPreferences();
  const operation = useRef(captureOperationLifetime());
  const mounted = useRef(true);
  const sequence = useRef(0);
  const outstanding = useRef(0);
  const retryFilter = useRef<SavedFilter>();
  const [selected, setSelected] = useState<{ owner: string | null } | null>(null);
  const [filterSaving, setFilterSaving] = useState(false);
  const [filterSaveError, setFilterSaveError] = useState<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const active = () => {
    try { assertOperationLifetime(operation.current); return mounted.current; } catch { return false; }
  };
  const identityError = !session.loading && !currentUserId ? new Error("Session identity is unavailable. Please retry.") : null;
  const ownerPreferencesError = query.error || session.error || identityError;
  const ownerPreferencesReady = !!query.data && !!currentUserId && !ownerPreferencesError && !session.loading;
  const saved = query.data?.defaultAccountFilter;
  const restored = saved === "shared" ? null : saved === "mine" ? currentUserId ?? "all" : "all";
  const ownerUserId = selected ? selected.owner : restored;
  const persist = async (filter: SavedFilter, started: number) => {
    if (!active()) return;
    outstanding.current += 1;
    setFilterSaving(true); setFilterSaveError(null);
    retryFilter.current = filter;
    try {
      await mutateAsync({ defaultAccountFilter: filter });
      if (active() && started === sequence.current) setFilterSaveError(null);
    } catch (error) {
      if (active() && started === sequence.current) setFilterSaveError(error instanceof Error ? error.message : "Unable to save account filter. Please retry.");
    } finally {
      outstanding.current -= 1;
      if (active() && started === sequence.current) setFilterSaving(false);
    }
  };
  const setOwnerUserId = (owner: string | null) => {
    if (!ownerPreferencesReady || !active()) return;
    const started = ++sequence.current;
    setSelected({ owner });
    setFilterSaveError(null);
    const filter = owner === "all" ? "all" : owner === null ? "shared" : owner === currentUserId ? "mine" : undefined;
    if (!filter) { setFilterSaving(false); return; }
    if (filter === saved && outstanding.current === 0 && !filterSaveError) return;
    void persist(filter, started);
  };
  return {
    ownerUserId, setOwnerUserId, currentUserId, ownerPreferencesReady, ownerPreferencesError,
    ownerPreferencesLoading: query.isLoading || session.loading || (!ownerPreferencesReady && !ownerPreferencesError),
    retryOwnerPreferences: () => !currentUserId ? session.refresh() : query.refetch(),
    filterSaving, filterSaveError,
    retryOwnerFilter: () => retryFilter.current ? persist(retryFilter.current, ++sequence.current) : Promise.resolve(),
    resetOwnerFilter: () => setOwnerUserId("all"),
    temporaryOwnerFilter: ownerUserId !== null && ownerUserId !== "all" && ownerUserId !== currentUserId,
  };
}
