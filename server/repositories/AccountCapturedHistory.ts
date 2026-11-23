import { and, eq, gte, lte } from "drizzle-orm";
import { accountWorthCaptures, netWorthSnapshots } from "@shared/schema";
import type { db } from "../db";
import { decodeCapturedWorth, projectCapturedWorth, type CapturedWorthRow } from "./CapturedWorthProof";
import { projectNativeAccountCapture } from "./AccountCaptureProof";
import { legacyCaptureContentHash } from "./AccountLegacyCaptureVersion";

type ReadTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ScopedRow = Pick<typeof accountWorthCaptures.$inferSelect,
  "id" | "householdId" | "date" | "captureId" | "capturedAt" | "currency" | "evidence">;
export type CaptureSource = { kind: "legacy"; row: CapturedWorthRow & { contentHash: string } } | { kind: "scoped"; row: ScopedRow };
export interface CaptureVersion {
  kind: "legacy" | "scoped"; id: string; date: string; currency: string | null; captureId: string | null; hasEvidence: boolean;
  contentHash: string | null;
}
export interface CapturedHistoryPoint {
  date: string; currency: string; assets: number; liabilities: number; netWorth: number;
  provenance: "captured_snapshot";
}
export interface CapturedHistory { sources: CaptureSource[]; cut: CaptureVersion[]; series: CapturedHistoryPoint[] }
const key = (value: Pick<CaptureVersion, "kind" | "id">) => `${value.kind}:${value.id}`;
const sourceKey = (source: CaptureSource) => key({ kind: source.kind, id: source.row.id });
export function captureVersion(source: CaptureSource): CaptureVersion {
  const captureId = source.kind === "scoped" ? source.row.captureId
    : source.row.provenance && typeof source.row.provenance === "object" && "captureId" in source.row.provenance
      && typeof source.row.provenance.captureId === "string" ? source.row.provenance.captureId : null;
  return { kind: source.kind, id: source.row.id, date: source.row.date, currency: source.row.currency,
    captureId, hasEvidence: source.kind === "scoped" ? source.row.evidence !== null : source.row.provenance !== null,
    contentHash: source.kind === "legacy" ? source.row.contentHash : null };
}
function sameVersion(a: CaptureVersion, b: CaptureVersion) {
  return a.kind === b.kind && a.id === b.id && a.date === b.date && a.currency === b.currency &&
    a.captureId === b.captureId && a.hasEvidence === b.hasEvidence && a.contentHash === b.contentHash;
}
function project(sources: CaptureSource[], visibleAccountIds: string[], scope: "user" | "household"): CapturedHistoryPoint[] {
  const visible = new Set(visibleAccountIds), dates = Array.from(new Set(sources.map(source => source.row.date))).sort();
  return dates.flatMap(date => {
    const native = scope === "user" ? sources.find(source => source.kind === "scoped" && source.row.date === date) : undefined;
    let value = native?.kind === "scoped" ? projectNativeAccountCapture(native.row, visible) : null;
    // A current independent observation is authoritative even when this reader
    // cannot value it. An older household generation cannot supply its amount.
    // Withdrawn/absent native proof still permits strictly verified legacy rows.
    if (!value && !(native?.kind === "scoped" && native.row.evidence !== null)) {
      const legacy = sources.find(source => source.kind === "legacy" && source.row.date === date);
      const frame = legacy?.kind === "legacy" ? decodeCapturedWorth(legacy.row) : null;
      value = frame ? projectCapturedWorth(frame, visible) : null;
    }
    return value ? [{ date: value.date, currency: value.currency, assets: value.assets.toNumber(), liabilities: value.liabilities.toNumber(),
      netWorth: value.money.toNumber(), provenance: "captured_snapshot" as const }] : [];
  });
}

/** Read each self-contained source once. Imported individual history never
 * supplies denomination or substitutes a missing captured value. */
export async function readCapturedAccountHistory(tx: ReadTransaction, householdId: string, from: string, to: string,
  visibleAccountIds: string[], scope: "user" | "household" = "user"): Promise<CapturedHistory> {
  const legacy = await tx.select({ id: netWorthSnapshots.id, householdId: netWorthSnapshots.householdId, date: netWorthSnapshots.date,
    currency: netWorthSnapshots.currency, totalAssets: netWorthSnapshots.totalAssets, totalLiabilities: netWorthSnapshots.totalLiabilities,
    netWorth: netWorthSnapshots.netWorth, accountBalances: netWorthSnapshots.accountBalances, provenance: netWorthSnapshots.provenance,
    contentHash: legacyCaptureContentHash(),
  }).from(netWorthSnapshots).where(and(eq(netWorthSnapshots.householdId, householdId), gte(netWorthSnapshots.date, from), lte(netWorthSnapshots.date, to)));
  const native = scope === "user" ? await tx.select({ id: accountWorthCaptures.id, householdId: accountWorthCaptures.householdId,
    date: accountWorthCaptures.date, captureId: accountWorthCaptures.captureId, capturedAt: accountWorthCaptures.capturedAt,
    currency: accountWorthCaptures.currency, evidence: accountWorthCaptures.evidence,
  }).from(accountWorthCaptures).where(and(eq(accountWorthCaptures.householdId, householdId), gte(accountWorthCaptures.date, from), lte(accountWorthCaptures.date, to))) : [];
  const sources: CaptureSource[] = [...legacy.map(row => ({ kind: "legacy" as const, row })), ...native.map(row => ({ kind: "scoped" as const, row }))];
  return { sources, cut: sources.map(captureVersion), series: project(sources, visibleAccountIds, scope) };
}

/** Final SQL returns the full metadata cut, including new dates, and payloads
 * only for changed/new generations. Rebuild the current projection from it. */
export function applyCurrentCaptureCut(previous: CapturedHistory, cut: CaptureVersion[], changed: CaptureSource[],
  visibleAccountIds: string[], scope: "user" | "household"): CapturedHistory {
  const current = new Map(previous.sources.map(source => [sourceKey(source), source]));
  const retained = new Set(cut.map(key));
  Array.from(current.keys()).forEach(id => { if (!retained.has(id)) current.delete(id); });
  for (const source of changed) {
    if (source.kind === "scoped" && !(source.row.capturedAt instanceof Date)) source.row.capturedAt = new Date(String(source.row.capturedAt));
    current.set(sourceKey(source), source);
  }
  const sources = cut.map(version => {
    const source = current.get(key(version));
    if (!source || !sameVersion(captureVersion(source), version)) throw new Error("Account capture cut is incomplete");
    return source;
  });
  return { sources, cut, series: project(sources, visibleAccountIds, scope) };
}
