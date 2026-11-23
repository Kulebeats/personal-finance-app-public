import { useEffect, type ReactNode } from "react";
import { useHousehold } from "@/hooks/use-settings";
import { setHouseholdCalendarTimeZone } from "@/lib/calendarZone";

/**
 * NEW-15: financial periods ("this month", budgets, reports) follow the
 * household's calendar zone, not each member's display zone, so every member
 * counts the same month. Rendered only for sessions that have a household.
 */
export function HouseholdCalendarZone({ children }: { children: ReactNode }) {
  const { data } = useHousehold();
  const zone = data?.household?.timeZone;
  // Set during render (idempotent), like SettingsProvider, so descendants
  // rendering in this pass already compute their ranges in the new zone.
  setHouseholdCalendarTimeZone(zone);
  // Published again on every effect setup: StrictMode's replay and a replaced
  // provider run the old cleanup after this render, and must not leave it unset.
  useEffect(() => {
    setHouseholdCalendarTimeZone(zone);
    return () => setHouseholdCalendarTimeZone(null);
  }, [zone]);
  return <>{children}</>;
}
