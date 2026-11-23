import { useEffect, useRef, useState } from "react";
import { assertOperationLifetime, captureOperationLifetime } from "@/lib/operation-lifetime";
import { useUserPreferences, useUpdateUserPreferences, type UpdatePersonalPreference, type UpdateUserPreferencesData } from "./use-settings";

/** Personal field intent survives refetches, failed saves, and newer edits. */
export function useUserPreferenceDraft() {
  const query = useUserPreferences();
  const { mutateAsync } = useUpdateUserPreferences();
  const [draft, setDraft] = useState<UpdateUserPreferencesData>({});
  const draftRef = useRef(draft);
  const pendingRef = useRef(false);
  const failed = useRef(false);
  const mounted = useRef(true);
  const operation = useRef(captureOperationLifetime());
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const active = () => {
    try { assertOperationLifetime(operation.current); return mounted.current; } catch { return false; }
  };
  const update: UpdatePersonalPreference = (key, value) => {
    if (!query.data || !active()) return;
    const next = { ...draftRef.current };
    if (!pendingRef.current && !failed.current && value === query.data[key]) delete next[key];
    else next[key] = value;
    draftRef.current = next;
    setDraft(next);
  };
  const save = async () => {
    if (pendingRef.current || !Object.keys(draftRef.current).length || !active()) return;
    const submitted = { ...draftRef.current };
    pendingRef.current = true;
    setPending(true); setSaveError(null);
    try {
      await mutateAsync(submitted);
      if (!active()) return;
      const remaining = { ...draftRef.current };
      for (const key of Object.keys(submitted) as Array<keyof UpdateUserPreferencesData>) {
        if (remaining[key] === submitted[key]) delete remaining[key];
      }
      draftRef.current = remaining;
      setDraft(remaining);
      failed.current = false;
    } catch (error) {
      if (!active()) return;
      failed.current = true;
      setSaveError(error instanceof Error ? error.message : "Unable to save personal preferences. Please retry.");
    } finally {
      if (active()) { pendingRef.current = false; setPending(false); }
    }
  };
  return { ...query, data: query.data ? { ...query.data, ...draft } : undefined, update, save, pending, saveError, hasChanges: Object.keys(draft).length > 0 };
}
