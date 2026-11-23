# Acceptance catalogue and evidence protocol

Version 1.0,15 October 2026. All journeys are **NOT RUN for this consolidated completion plan**. Historical audit passes/failures are diagnostic inputs, not candidate release acceptance. No existing app behavior is marked fixed here.

## Fixture and environment rules

Use generated synthetic users in households A/B, with owner/admin/member/view_only/Professional and an outsider; exercise an unknown role through a controlled repository/test seam if the DB enum forbids persisting it. Never weaken the real enum to make a fixture possible. Create private/shared accounts and transactions independently; include linked goals/tags/recurring, empty and populated investments, and foreign IDs. Every test run has its own target manifest, unique fixture prefix and scoped cleanup. Never reuse private audit cookies or secrets.

Use independent expected values, not the same Money/query helper as production. Local test DB plus test-mode suites establish regressions; a separate production-mode HTTPS staging run establishes CSRF/cookies/CSP/limits/deployment. Record UTC server and Africa/Lusaka actor/household timezones. Clock control belongs to isolated tests; do not change production clock.

### Golden fixture A — posting, liability, FX and splits

Run steps in order on fresh rows, with authorized FX valuation20ZMW/USD:

| Step | Expected persisted and reported result |
|---|---|
| Cash A opening1000, cash B opening0, card debt500 | Assets1000; liabilities500; net worth500 |
| Cash A income200 and expense125.50 | A1074.50; assets1074.50; net worth574.50; expense125.50 |
| Transfer100 from A to B | A974.50,B100; assets1074.50; household net worth574.50; expense unchanged |
| Card purchase45.50 | Liability545.50; net worth529.00; combined expense171.00 |
| Add USD account with opening10 at approved rate20 | USD10; converted assets1274.50; net worth729.00 |
| Cash A expense100 split60/40 | A874.50; assets1174.50; net worth629.00; expenses271.00; split categories60+40, parent not double-counted |
| Replay same operation identity | No new financial effect or duplicated audit; row counts stable |
| Edit/delete each fixture operation in separate reset scenario | Exact inverse/replacement effects across balances/splits/links/caches/audit; no orphan transfer |

Separate FX fixture: same USD10 flow dated at rate20 gives200ZMW historical flow; valuation at later rate26.50 gives265ZMW asset value. Missing/stale rate never substitutes1.0. Another household override must not change either result.

Separate goal fixture: manual progress5, explicit linked allocation10 ->15, unlink ->5; edit/delete repeat safely. Separate budget fixture: elapsed three months sum550 ->183.33 suggestion;450 remainder carries once. Separate investment fixture: cost950/face1000/as-of value1000, principal settlement1000 -> cash+1000, holding-1000, ordinary income0, separately explained realized basis difference50.

## J01–J16: required end-to-end outcomes

| ID / packets | Required path | Negative/race/failure cases | Evidence that closes it |
|---|---|---|---|
| J01 Identity; R01/R02 | Register -> actual captured email -> verify in different browser -> login/logout -> password reset -> login with new credential | Pending access denied; wrong/expired/used token; CSRF on normal mutation; mail failure/resend; account enumeration; copied old cookie | Browser trace, exact redacted link route, HTTP outcomes, email_verified/token/session-store read-back |
| J02 Household; R03/R04 | Owner invites every offered role -> verified intended recipient accepts -> real name and correct capabilities -> role change/remove/leave/transfer | Wrong recipient; used/revoked/expired invite; self-transfer; simultaneous transfer/role mutation; two accepts/create-vs-accept | Exactly one active household/user and one owner/household; no unauthorized shared/private read/write; both browser sessions |
| J03 Settings/security; R01/R05/R06 | Every visible field save/clear/reload; personal preferences/shared views; MFA enroll/login/backup/regenerate/disable/recovery; device revocation | Unknown schema keys; view-only household policy; one-time races; outdated open form; policy version on existing session; missing FX for threshold | Field matrix API+DB, no sentinel credential leak; correct role controls; one-winner/replay assertions |
| J04 Ledger; R08 | Golden A plus all manual/import/recurring/receipt/rule/GRZ writers; create/edit/delete/retry and pair-preserving transfers | Competing writer lock; stale version409; mid-transaction fault; wrong currency; split over-allocation; account-type/opening edit | Independent before/after balances, both legs, immutable currency, audit/outbox; no drift or duplicate effects |
| J05 Privacy; R04/R11/R12/R16/R17 | Direct/list/activity/goal/tag/recurring/assignment/portfolio/export/count/report/AI/notification matrix | Private-account false transaction flag; private transaction shared account; unknown role; outsider; foreign category/tag/member/goal; recipient-specific jobs | No private marker/amount/id/count; denied writes unchanged; positive authorized control for each route |
| J06 Imports; R09 | Both UI entry points -> mapping/date/duplicate/transfer preview -> commit -> row errors/history -> export -> roundtrip | Same file repeat; altered same request key; same-day identical valid purchases; Feb30; ambiguous date; transfer-range overwrite; halfway fault | Row-level IDs/outcomes, exact account changes, batch identity, Notes retained, no deleted-and-skipped replacement |
| J07 Organization; R11 | Seed/create/archive categories/groups; tag/merchant merge; alias/logo/details; undo after intervening edits; default preset; rule preview/test/apply | Cross-household IDs at authoring and execution; every dry-run action; repeated removal; invalid reorder; 60/60 split; concurrent undo | Full table snapshots unchanged for dry-run; actual affected counts; all client-called routes persist |
| J08 Budgets; R10/R12/R14 | Create/manual edit/history -> FX/split/refund spend -> average preview -> rollover | Zero/future months; missing FX; concurrent recalculation; owner preference persists; private spend excluded |271.00 expense fixture where applicable;550/3;450 carry once; report/export parity; valid batch audit |
| J09 Goals; R10/R08 | Create -> contribution/correction -> allocation/link/unlink -> assignment -> archive/complete/reopen | Overfunding confirm; invalid huge amount; missing FX; linked transaction edit/delete; concurrent contributions; repeated unlink | Exact progress source identity and inverse values; no hidden-data activity or double-counting |
| J10 Recurring/jobs; R14/R19 | UI rule -> deployed due tick -> exactly-one materialization -> catch-up -> pause/end; every registry job |31st anchor; timezone/DST in supported zones; stale lease; two workers; crash after effect; future asOfDate; backlog>100 | Durable run/due identity, fencing, checkpoints, last-success; staged logs plus ledger rows from actual scheduled triggers |
| J11 Investments; R13/R12 | Opening/manual/automated buy -> FIFO partial/full sell -> basis/fees/FX -> income/withholding/tax export; bond-only UI; pension; maturity/rollover | Negative/oversell; no tax lot; sold-bond pay; sale/pay race; zero-interest bill; invalid rate/date; missing approved rollover terms; Dec31 | Cash/holdings/lot/disposal/report read-back, principal ordinary income0, versioned calculation policy; qualified OI-03 evidence before real use |
| J12 Reports; R12/R18 | Dashboard, summary, cashflow, budgets, ratios, all report/chart periods and CSV with same actor/filter | Latest vs dated rate; stale caches both backends; quarter grouping; Unassigned/Uncategorized; split/card purchase; incomplete snapshots; another member writes | Independent golden totals, no Invalid Date, immediate revalidation, rounding foots, explicit incomplete/error semantics |
| J13 Receipts; R15/R19 | Real file upload -> OCR under CSP -> correct -> match/create -> retry/delete -> restart/restore | Negative amount; concurrent create; provider/worker unavailable; wrong household file; legacy path; corrupt/missing object; duplicate hash | Exactly one ledger effect; persisted reviewed values; manifest checksums, authorized download, no server paths |
| J14 Outbound/AI; R16/R17 | Email/push/recap settings -> scheduled/send outcome; Claude success -> forced eligible Gemini -> both-fail local/unavailable | Unknown/private push endpoint; channel partial failure; consent role/revocation; safety/data errors; two last-budget requests; unknown-cost restart; cancellation/late reply | Per-channel outcome/audit; recipient-private markers absent; correct provider/stage, one conversation, <=3 paid attempts and durable reservations |
| J15 Export/exit; R07 | Request -> async export download -> expiry; household-free/shared/last-owner erasure and leave | Access changes before download; interrupted purge; object deletion failure; stale sessions/tokens; backup restore of erased identity | Visible-only manifest/counts; denied stale access; retained shared audit pseudonymized; erasure state eventually complete; retention input documented |
| J16 Operations/devices; R00/R18/R19/R20/R21 | Empty/populated migrations, HTTPS security, required dependency outages, load, keyboard/screen reader/phone, restore and rollback | Invalid TLS CA; Redis down/eviction; no SMTP/AI key; log redaction; wrong test target; runtime/version mismatch; missing required UI control | Target manifest and SHA; refusal before wrong-target writes; p95/device results; object+DB restore RPO/RTO; functioning alert/runbook |

No automatic pass for controls that are absent, hidden or unpopulated. A mocked client test cannot prove server persistence. An HTTP create without the actual UI payload cannot close the UI journey. A local restore does not certify an unknown production setup.

## Packet evidence template

Create evidence/Rxx/RESULT.md only during authorized execution. It must contain:

- Packet ID, implementing/reviewing agent, branch, exact source SHA and dirty-tree disposition.
- Register IDs claimed and dependency status; intended behavior and failure before repair.
- Target manifest: DB name and host alias without credentials, server origin/run marker, mode, Node/PG/Redis versions, schema version, clock/timezones.
- Changed files and migration IDs; preflight/backfill affected counts, ambiguous rows and approved resolution.
- Exact commands, exits, test counts and actual assertion outcomes. Separate historical, local and staging results.
- Independent expected values and redacted API/SQL/file/provider observations; actor visibility and denied-state before/after controls.
- Retry, concurrency, restart and failure-injection evidence appropriate to the change.
- Review findings/disposition, rollout/rollback notes, unresolved OI items and next action.

Suggested small machine-readable entry:

```json
{
  "packet": "R08",
  "findingIds": ["NEW-05", "FIN-08"],
  "implementationSha": "<actual SHA>",
  "status": "LOCALLY_VERIFIED",
  "targetManifest": "<path>",
  "checks": [
    {"case": "card-debt-sign", "expected": "545.50", "observed": "<actual>", "passed": false}
  ],
  "stagingEvidence": null,
  "reviewDisposition": "pending"
}
```

The illustrative false/pending values must be replaced only with observed outcomes. Never manufacture a passing result from this template.

## Full candidate gates

Current static/build/client/server/bundle checks pass on the exact candidate; targeted regressions and guarded protected-runtime journeys pass; no required register row lacks evidence. Then perform real controlled SMTP, AI, push, scheduled-job, storage, device, restore and rollback checks. Complete14-day no-P0/P1 soak with incident evidence and owner UAT. Security/financial fixes invalidate affected evidence; release-blocking regression resets the relevant soak.

Post-deploy, verify source/config/schema identity, run a synthetic canary without exposing real household data, observe first due production jobs and monitor72h. Production deployment/invitation requires OI-06 authorization; writing this plan did not grant it.
