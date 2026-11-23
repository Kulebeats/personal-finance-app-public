import { useHousehold } from "@/hooks/use-settings";
import { formatCurrency } from "@/lib/money";

/**
 * Formats a bare chart value that the server sent in the household currency.
 * Until the household's currency is known, the value is shown without one,
 * never in a currency it is not in.
 */
export function useHouseholdMoneyFormat(): (value: number) => string {
  const { data } = useHousehold();
  const currency = data?.household?.currency ?? "";
  return (value: number) => formatCurrency(value, currency);
}
