import { useEffect, useState } from "react";

/** Match the server's current UTC valuation date, including an idle midnight. */
export function useUtcValuationDate() {
  const [today, setToday] = useState(() => new Date().toISOString().slice(0, 10));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      if (timer !== undefined) clearTimeout(timer);
      const now = new Date();
      setToday(now.toISOString().slice(0, 10));
      const nextDay = new Date(now);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      nextDay.setUTCHours(0, 0, 0, 0);
      timer = setTimeout(sync, Math.max(1, nextDay.getTime() - now.getTime()));
    };
    const visible = () => {
      if (document.visibilityState === "visible") sync();
    };
    sync();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", visible);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return today;
}
