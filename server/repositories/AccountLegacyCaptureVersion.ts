import { sql } from "drizzle-orm";
import { netWorthSnapshots } from "@shared/schema";

/** Legacy capture IDs are caller replaceable. Bind only the decoder's financial
 * content to the read cut; names, notes and unrelated timestamps are not inputs. */
export function legacyCaptureContentHash(alias?: string) {
  const column = (key: "totalAssets" | "totalLiabilities" | "netWorth" | "accountBalances" | "provenance") =>
    alias ? sql`${sql.identifier(alias)}.${sql.identifier(netWorthSnapshots[key].name)}` : netWorthSnapshots[key];
  return sql<string>`encode(sha256(convert_to(jsonb_build_object(
    'totalAssets',${column("totalAssets")}::text,'totalLiabilities',${column("totalLiabilities")}::text,
    'netWorth',${column("netWorth")}::text,'accountBalances',${column("accountBalances")},
    'provenance',${column("provenance")})::text,'UTF8')),'hex')`;
}
