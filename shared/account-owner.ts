import { z } from "zod";

const uuid = z.string().uuid();

/** Case is canonical only for a validated UUID. Sentinels and missing values
 * retain their existing meaning and never gain owner authority here. */
export function canonicalAccountOwner(value: string | null): string | null;
export function canonicalAccountOwner(value: string | null | undefined): string | null | undefined;
export function canonicalAccountOwner(value: string | null | undefined): string | null | undefined {
  const parsed = uuid.safeParse(value);
  return parsed.success ? parsed.data.toLowerCase() : value;
}
