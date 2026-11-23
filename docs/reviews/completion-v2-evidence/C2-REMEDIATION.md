# Checkpoint 2 remediation — 31 October 2026

Candidate: `codex/c2-review-remediation`, isolated checkout
`C:\Users\USER\.codex\worktrees\c2-review-remediation`, base
`aa62784c70c5001e570a2a89ef88d88b600a65ac`.
Review input: primary checkout's
`docs/reviews/2026-10-15-unified-completion-spec/reviews/REVIEW-2026-10-31-checkpoint-2.md`.

Local implementation only. Canonical and primary source remain untouched. No
push, merge, deployment, shared DB, providers or real messages authorized.
One implementation lane; coordinator owns independent review and integration.
Only bounded protected unit/component tests, one worker, run here. DB/browser,
native and broad verification require a coordinator-allocated window.
No canonical completion status changes follow from this ledger.

| Finding | Source adjudication / repair | Reproduction, tests, commit / remaining gate |
|---|---|---|
| C2-01 | Reproduced and repaired | 79f802c2; 14 UNIT tests; expanded DB role/readback matrix prepared, unrun |
| C2-02 | Reproduced and repaired prospectively; legacy mismatch still refuses | cb725c62; 11 UNIT tests; cross-writer DB/locking acceptance pending |
| C2-03 | Reproduced and repaired | 283555f5; 6 server/26 client tests; browser acceptance pending |
| C2-04 | Unfinished Redis integration, not authority to remove guard | Coordinator owns R14/R20; concrete proposal before shared contract changes |
| C2-05 | Reproduced and repaired | 662d117d; 4 cooldown tests; distributed lock/HTTP proof pending |
| C2-06 | Missing boot validation reproduced and repaired; silent-failure wording overstated | 87e6b0a8; combined 59 tests; actual boot/delivery unverified |
| C2-07 | Source confirms 13 per-endpoint invalidations/connections; bounds are scans/inspected keys/deadline | No exact 12,800-key threshold; coordinated batching proposal in handoff |
| C2-08 | Stale summary reproduced; consumer cache removed | 84f769f0; 27 tests; generic registry lifecycle proposal and performance proof pending |
| C2-09 | Source-confirmed lifecycle gap; current refusal deliberately required by accepted R04 contract | No silent clearing/backfill; proposed explicit departure reference transition requires adjudication |
| C2-10 | Reproduced and repaired | c646b096; 26 component tests; real Radix/browser proof pending |
| C2-11 | Reproduced and repaired | 7a09b8bd; 31 client tests; two-tab browser proof pending |
| C2-12 | No-fallback behavior confirmed, defect claim not established by requirement; explicit retry exists | Keep saved preference gate; success toast is confirmed UX noise, not a persistence failure |
| C2-13 | Immediate revocation source-confirmed | Firefox/WebKit failure remains unverified; no speculative timeout added |
| C2-14 | Raw error disclosure reproduced and repaired | 87e6b0a8; import execute regression and generic parse error; parse HTTP proof pending |
| C2-15 | Not a defect merely because one-shot SQL cannot run twice | Push-built adoption requires schema/history reconciliation; no fixture execution or adoption proof here |
| C2-16 | Manifest static import and credential/service dynamic imports confirmed | Bundle footprint/side effects not measured; intentional authority checks must survive any relocation; R20 owner gate |

Dependency audit, bounded repair proposals, backup/CI recommendations and remaining
verification commands are in `C2-HANDOFF.md`. No remote publication performed.

C2-01: protected UNIT route handler role matrix reproduced Professional and unknown roles returning 200 (2 failed/12 passed). Capability repair: 14/14 passed. Logs: .local/c2/import-{red,green}.log. No real HTTP or persistence proof. Independent review and broad checks deferred to coordinator.

C2-01 repair commit: 79f802c2.
C2-03: server caller regression reproduced four credential-code failures (4 failed/2 passed); client transport regression reproduced five retired-lifetime failures (5 failed/11 passed). Added distinct INVALID_CREDENTIALS error for password change, account deletion, MFA disable and email change; missing identity retains UNAUTHORIZED. protectedFetch preserves credential challenge lifetime while continuing to invalidate genuine authority loss. Server 6/6 and three client files 26/26 passed through protected unit runner, Node 24.22.0, maxWorkers=1. Logs .local/c2/{credentials,session}-{red,green}.log. No browser, DB or broad check acceptance; coordinator independent review still required.

C2-03 repair commit: 283555f5.
C2-02: 10 failing/1 passing UNIT adapter regressions before repair, 11/11 after. Bulk caller now delegates to TagWriteRepository with fresh membership/capability admission and locked writer recheck. Receipt path locks existing tag, verifies physical count, inserts with RETURNING, increments only actual insert in same transaction. Existing mismatches refuse without recount. Logs .local/c2/tags-{red,green}.log. New completion-c2.cross-writers.realdb.integration.test.ts is PREPARED, NOT RUN; covers role-gated bulk then single remove, receipt duplicate/link then single remove, mismatch rollback and independent SQL counters. Existing R04 counter/race suite remains required. No claim of persistence/concurrency acceptance.
Coordinator command after assigning disposable manifest/run ID/URL: node scripts/run-protected-tests.mjs database vitest --server run modules/tags/__tests__/completion-c2.cross-writers.realdb.integration.test.ts modules/tags/__tests__/completion-r04.tag-writes.realdb.integration.test.ts --maxWorkers=1. Use pinned Node 24.22.0, clear NODE_OPTIONS/NODE_PATH; validate owned target first. No DB target was connected here.

C2-02 repair commit: cb725c62. Follow-up fixture query scoped to owned household.
C2-05: repeated authenticated resend and public/authenticated cross-entry bypass reproduced (3 failed/1 passed); after repair 4/4 resend plus 6/6 credential tests pass. Resend uses existing strictLimiter; under the user-row lock, the persisted 24-hour challenge expiry enforces a 60-second issuance cooldown across processes/IPs. Public cooldown replies remain generic. No new Redis prefix/contract or schema. This relies on existing registration and security-email issuers' common 24-hour lifetime; any lifetime change must update this contract. Logs .local/c2/resend-{red,green}.log. Real concurrent HTTP/DB lock proof and limiter integration remain coordinator gates; no emails sent.

C2-05 repair commit: 662d117d.
C2-06/C2-14: boot validation rejects absent/non-HTTPS/path/credential/query APP_URL in production using the exact public-link origin validator. Import 500 replies are generic; server logging remains. Reproduced 6 failures/37 passes before fixes; 59/59 across environment/import/public-link suites after. Logs .local/c2/config-errors-{red,green}.log. Actual boot and delivery remain unverified.

C2-06/C2-14 commit: 87e6b0a8.
C2-10: modifier/typeahead/guard-prefix regressions reproduced (10 failed/16 passed in corrected red2 log); after repair 26/26 component tests pass. Guarded input, composite widgets and dialogs clear pending prefix; modified navigation does not trigger. Preserves normal shortcuts. JSDOM is not real Radix/Safari/Firefox browser proof. First red log includes a corrected test-edit mistake; use shortcuts-red2.log and shortcuts-green.log.

C2-10 commit: c646b096.
C2-11: corrected broadcast spy to use repository's localStorage mock and clear calls per test; valid red3 run reproduced all four failed-auth broadcasts (4 failed/4 passed). Definite auth rejections now complete local transition without cross-tab broadcast; success, unknown network/5xx and explicit session-context changes still broadcast. 31/31 across auth transition, CSRF and context-precondition suites pass. Logs .local/c2/broadcast-{red3,green}.log. Actual two-tab browser proof pending.

C2-11 commit: 7a09b8bd.
C2-08: real summary/cache with mocked repository reproduced stale next-request amount. Removed this consumer's TTL cache, so summary re-reads current visibility and amounts and no longer creates tag-registry entries per date range. Shared Redis/cache contracts untouched. 27/27 summary/transaction-service tests pass (summary-green2.log); initial green attempt had duplicate local date identifiers from extraction, corrected before acceptance. Tradeoff: every request aggregates; performance acceptance remains open. Generic withCache registry lifecycle for other consumers is a separate coordinated proposal, not claimed fixed.

Final bounded candidate regression: 8 server files / 81 tests passed (40.55s), 6 client files / 67 tests passed (48.59s), sequential commands with maxWorkers=1. Logs .local/c2/final-server.log and final-client.log. Earlier transaction-service focused run: 27/27 including the summary regression. Final DB fixture additions are unrun and do not increase these counts. git diff --check passed. Typecheck/build/broad suites, real DB/browser/native verification and independent review remain unperformed here by allocation boundary.
C2-08 commit: 84f769f0. See C2-HANDOFF.md for full disposition and next commands. Eight repair commits cover C2-01/02/03/05/06/08/10/11/14; no claim that all 16 findings or any campaign packet are closed.
