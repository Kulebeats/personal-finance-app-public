import { sql } from "drizzle-orm";
import { accountWorthCaptures, netWorthSnapshots } from "@shared/schema";
import type { CaptureVersion } from "./AccountCapturedHistory";
import { legacyCaptureContentHash } from "./AccountLegacyCaptureVersion";

export interface AccountHistoryWindow { from: string; to: string; scope: "user" | "household"; includeAccounts?: boolean }

/** Included in the final grant/financial proof statement, so metadata and any
 * new/changed payload share its fresh MVCC cut. No second full history read. */
export function accountCaptureCutSql(householdId: string, history: AccountHistoryWindow | undefined, previous: CaptureVersion[]) {
  const native = history?.scope === "user" ? sql`union all
    select 'scoped'::text as kind, s.id::text as id, to_char(s.date, 'YYYY-MM-DD') as date,
      s.currency::text as currency, s.capture_id::text as capture_id, s.evidence is not null as has_evidence,
      null::text as content_hash,
      jsonb_build_object('id',s.id::text,'householdId',s.household_id::text,'date',to_char(s.date,'YYYY-MM-DD'),
        'currency',s.currency,'captureId',s.capture_id::text,
        'capturedAt',to_char(s.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'evidence',s.evidence) as body
    from ${accountWorthCaptures} s where s.household_id=${householdId}::uuid
      and s.date>=${history.from}::date and s.date<=${history.to}::date and exists(select 1 from allowed_member)` : sql``;
  const candidates = history ? sql`
    select 'legacy'::text as kind, n.id::text as id, to_char(n.date,'YYYY-MM-DD') as date,
      n.currency::text as currency, n.provenance->>'captureId' as capture_id, n.provenance is not null as has_evidence,
      ${legacyCaptureContentHash("n")} as content_hash,
      jsonb_build_object('id',n.id::text,'householdId',n.household_id::text,'date',to_char(n.date,'YYYY-MM-DD'),
        'currency',n.currency,'totalAssets',n.total_assets::text,'totalLiabilities',n.total_liabilities::text,
        'netWorth',n.net_worth::text,'accountBalances',n.account_balances,'provenance',n.provenance,
        'contentHash',${legacyCaptureContentHash("n")}) as body
    from ${netWorthSnapshots} n where n.household_id=${householdId}::uuid
      and n.date>=${history.from}::date and n.date<=${history.to}::date and exists(select 1 from allowed_member)
    ${native}` : sql`select ''::text as kind,''::text as id,''::text as date,null::text as currency,
      null::text as capture_id,false as has_evidence,null::text as content_hash,'{}'::jsonb as body where false`;
  return sql`cut_previous as (
    select * from jsonb_to_recordset(${JSON.stringify(previous)}::jsonb)
      as p(kind text,id text,date text,currency text,"captureId" text,"hasEvidence" boolean,"contentHash" text)
  ), cut_candidates as (${candidates}), cut_changed as (
    select c.* from cut_candidates c left join cut_previous p on c.kind=p.kind and c.id=p.id
    where p.id is null or row(c.date,c.currency,c.capture_id,c.has_evidence,c.content_hash)
      is distinct from row(p.date,p.currency,p."captureId",p."hasEvidence",p."contentHash")
  )`;
}

export const accountCaptureCutValues = sql`
  coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'id',id,'date',date,'currency',currency,
    'captureId',capture_id,'hasEvidence',has_evidence,'contentHash',content_hash) order by kind,id) from cut_candidates),'[]'::jsonb) as cut,
  coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'row',body) order by kind,id) from cut_changed),'[]'::jsonb) as changed`;
