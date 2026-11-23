import { useEffect, useRef } from "react";
import type { GoalFieldErrors } from "./goalRequiredFields";

export function GoalValidationSummary({ errors, attempt }: { errors: GoalFieldErrors; attempt: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (attempt) ref.current?.focus(); }, [attempt]);
  if (!attempt || !Object.keys(errors).length) return null;
  return <div ref={ref} role="alert" tabIndex={-1} className="rounded-md border border-destructive p-3 text-sm text-destructive">
    <p className="font-medium">Complete the required fields to continue.</p>
    <ul className="list-disc pl-5">
      {Object.entries(errors).map(([field, message]) => <li key={field}>
        <a id={`${field}-error`} href={`#${field}`} className="underline" onClick={event => {
          event.preventDefault();
          // Resolve within this dialog, not another mounted wizard with the same field IDs.
          ref.current?.closest('[role="dialog"]')?.querySelector<HTMLElement>(`[id="${field}"]`)?.focus();
        }}>{message}</a>
      </li>)}
    </ul>
  </div>;
}
