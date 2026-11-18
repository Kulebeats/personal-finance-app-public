import type { MoneyDto } from "@/lib/api";
import { toMoneyNumber } from "@/lib/money";

export type LinkType = "contribution" | "spending";

export type LinkDraft = {
  linkType: LinkType;
  amount: string;
};

export function parseAmount(value?: MoneyDto | string | null) {
  if (!value) return 0;
  return toMoneyNumber(value);
}

export function formatDate(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}
