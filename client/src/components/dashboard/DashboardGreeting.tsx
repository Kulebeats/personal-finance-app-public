import { useEffect, useMemo, useState } from "react";
import { useDisplaySettings } from "@/hooks/use-settings";

export default function DashboardGreeting({ name }: { name?: string | null }) {
  const { data: settings, isLoading, isError } = useDisplaySettings();
  const [now, setNow] = useState(Date.now);
  const timezone = settings?.timezone;
  const formatter = useMemo(() => {
    if (!timezone || isLoading || isError) return null;
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" });
    } catch { return null; }
  }, [timezone, isLoading, isError]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      const current = Date.now();
      setNow(current);
      // Align to the minute so a tab opened at 11:59:59 changes at noon.
      // Resume events refresh immediately after background timer suspension.
      if (document.visibilityState === "visible") timer = setTimeout(refresh, 60000 - current % 60000);
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const hour = formatter ? Number(formatter.format(now)) : null;
  const greeting = hour === null ? "Hello" : hour >= 5 && hour < 12 ? "Good morning"
    : hour >= 12 && hour < 18 ? "Good afternoon" : "Good evening";
  const knownName = name?.trim();
  return <p className="text-muted-foreground">{greeting}{knownName ? `, ${knownName}` : ""}</p>;
}
