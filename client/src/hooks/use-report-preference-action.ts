import { useCallback, useEffect, useRef, useState } from "react";
import { assertOperationLifetime, captureOperationLifetime } from "@/lib/operation-lifetime";

/** Keep a report dialog's draft until acknowledgement, within its originating session. */
export function useReportPreferenceAction(open = true) {
  const operation = useRef(captureOperationLifetime());
  const generation = useRef(0);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    generation.current += 1;
    pendingRef.current = false;
    setPending(false);
    setError(null);
    return () => { generation.current += 1; };
  }, [open]);
  const run = useCallback(async (action: () => Promise<unknown>, acknowledged?: () => void) => {
    if (pendingRef.current) return;
    const started = generation.current;
    const active = () => {
      if (generation.current !== started) return false;
      try { assertOperationLifetime(operation.current); return true; } catch { return false; }
    };
    if (!active()) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
      if (active()) acknowledged?.();
    } catch (failure) {
      if (active()) setError(failure instanceof Error ? failure.message : "Unable to save preferences. Please retry.");
    } finally {
      if (active()) { pendingRef.current = false; setPending(false); }
    }
  }, []);
  return { run, pending, error };
}
