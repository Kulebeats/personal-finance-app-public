import { useCallback, useEffect, useRef, useState } from "react";
import { registerStepUpHandler, securityApi } from "@/lib/api";
import { StepUpDialog } from "./StepUpDialog";

/**
 * Mount once near the app root. Registers a global step-up handler so the API
 * layer (api.ts) can prompt for re-authentication on 401 STEP_UP_REQUIRED and
 * transparently retry. Renders no children; it only hosts the dialog.
 */
export function StepUpProvider() {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<string>("SETTINGS");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Multiple gated requests can 401 concurrently; queue their resolvers so a
  // single step-up resolves every pending request with the same result.
  const resolversRef = useRef<Array<(verified: boolean) => void>>([]);

  useEffect(() => {
    registerStepUpHandler((requestedLevel: string) => {
      const isFirst = resolversRef.current.length === 0;
      const promise = new Promise<boolean>((resolve) => {
        resolversRef.current.push(resolve);
      });
      // Only the first pending request initialises/opens the dialog; concurrent
      // requests just join the queue and ride the same verification.
      if (isFirst) {
        setLevel(requestedLevel);
        setError(null);
        setSubmitting(false);
        setOpen(true);
      }
      return promise;
    });
    return () => {
      registerStepUpHandler(null);
      const pending = resolversRef.current;
      resolversRef.current = [];
      pending.forEach(resolve => resolve(false));
    };
  }, []);

  const finish = useCallback((verified: boolean) => {
    setOpen(false);
    setSubmitting(false);
    const resolvers = resolversRef.current;
    resolversRef.current = [];
    resolvers.forEach((resolve) => resolve(verified));
  }, []);

  const handleSubmit = useCallback(
    async (password: string) => {
      setSubmitting(true);
      setError(null);
      try {
        await securityApi.stepUp({ password });
        finish(true);
      } catch (err) {
        setSubmitting(false);
        setError(err instanceof Error ? err.message : "Verification failed");
      }
    },
    [finish],
  );

  const handleCancel = useCallback(() => finish(false), [finish]);

  return (
    <StepUpDialog
      open={open}
      level={level}
      submitting={submitting}
      error={error}
      onSubmit={handleSubmit}
      onCancel={handleCancel}
    />
  );
}
