import { format } from "date-fns";

export function toISODate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function fromISODate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}
