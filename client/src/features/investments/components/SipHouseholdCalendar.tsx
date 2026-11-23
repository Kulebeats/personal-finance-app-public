import { useId, useState } from "react";
import { normalizeHouseholdTimeZone } from "@shared/household-calendar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useConfigureSipHouseholdCalendar, useSipHouseholdCalendar } from "@/hooks/investments/useSipOccurrences";
import type { ApiError } from "@/lib/api";

function choices() {
  const runtime = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  const zones = runtime.supportedValuesOf?.("timeZone") ?? [
    "Africa/Lusaka", "Africa/Johannesburg", "Europe/London", "America/New_York", "Asia/Kolkata", "Australia/Sydney",
  ];
  return [...new Set(["UTC", "Africa/Lusaka", ...zones])].sort();
}
const timeZones = choices();

export function SipHouseholdCalendar() {
  const calendar = useSipHouseholdCalendar();
  const configure = useConfigureSipHouseholdCalendar();
  const [selected, setSelected] = useState("");
  const id = useId();
  const error = configure.error as ApiError | null;
  const fields = error?.fields as { timeZone?: unknown } | undefined;
  const fieldMessage = Array.isArray(fields?.timeZone) && typeof fields.timeZone[0] === "string" ? fields.timeZone[0] : null;
  const message = fieldMessage ?? (error ? "The household calendar could not be saved. Review your choice and current owner access." : null);
  if (calendar.isLoading) return <p role="status" className="text-sm">Loading household calendar…</p>;
  if (calendar.isError || !calendar.data) return (
    <div role="alert" className="space-y-2 rounded-md border p-3 text-sm">
      <p>The household calendar could not be refreshed.</p>
      <Button variant="outline" size="sm" onClick={() => void calendar.refetch()}>Retry household calendar</Button>
    </div>
  );
  const policy = calendar.data.data;
  const save = async () => {
    try {
      await configure.mutateAsync(normalizeHouseholdTimeZone(selected));
      setSelected("");
    } catch {
      // Keep the explicit choice; the mutation's safe error is rendered below.
    }
  };
  return (
    <section aria-label="Shared household calendar" className="space-y-3 rounded-md border bg-muted/20 p-3 text-sm">
      <div>
        <h4 className="font-semibold">Shared household calendar</h4>
        {policy.configured ? <p>Time zone: <span className="font-medium">{policy.timeZone}</span></p> : (
          <p>{policy.timeZone ? "Household calendar is unavailable. The owner must choose a supported time zone."
            : "Household calendar is not configured. The owner must choose a time zone before confirmations can be recorded."}</p>
        )}
        {calendar.dayHint && <p className="text-xs text-muted-foreground">Household day hint: {calendar.dayHint}. Recording dates are checked when submitted.</p>}
      </div>
      {configure.canConfigure && <div className="space-y-2">
        <Label htmlFor={id}>Shared household time zone</Label>
        <select id={id} value={selected} disabled={configure.isPending} onChange={event => setSelected(event.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Choose a named time zone</option>
          {timeZones.map(zone => <option key={zone} value={zone}>{zone}</option>)}
        </select>
        <Button size="sm" disabled={!selected || configure.isPending} onClick={() => void save()}>Save household calendar</Button>
      </div>}
      {message && <p role="alert">{message}</p>}
    </section>
  );
}
