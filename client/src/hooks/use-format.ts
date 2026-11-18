import { useCallback } from "react";
import { useDisplaySettings } from "./use-settings";
import { formatCurrency as formatCurrencyLib } from "@/lib/format";

export function useFormat() {
  const { data: settings } = useDisplaySettings();

  const formatCurrency = useCallback(
    (amount: number, currencyOverride?: string) => {
      // Default to ZMW/US if settings not loaded yet
      const currency = currencyOverride || settings?.currency || "ZMW";
      const numberFormat = settings?.numberFormat || "US";
      return formatCurrencyLib(amount, currency, numberFormat);
    },
    [settings]
  );

  return {
    formatCurrency,
    // Add other formatters here if needed (date, etc)
  };
}
