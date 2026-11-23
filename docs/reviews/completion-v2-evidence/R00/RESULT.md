# R00 execution evidence

Status: OPEN; reviewed local runtime, dependency and protected-harness foundation accepted for downstream local work. Full packet acceptance remains pending.
Master: version 2.2. Companion: version 1.2. Canonical IDs DEP-01, DEP-02, NEW-08, NEW-39; R20 guard support OPS-011 retained.

Application baseline `381e9439afabe7c6cf829cb1cbded91d36da44ee`; document preservation base `520fe2e63025e49590024038b3436f4e3930e30b`. Exact worker paths, ownership and model settings are in `../CAMPAIGN.md`. Author/reviewer separation is required; Sol review is same-family evidence.

## Observed baseline and boundaries

- Primary application remains at baseline with its untracked work preserved. Campaign has no copied .env, cookies or launch configuration.
- Host Node 22.23.2/npm 11.19.1 differs from repository engines Node 20. Runtime owner is checking official current support and targeted fresh advisories; no inherited audit count is accepted as a current pass.
- Baseline test database resolver derives from ambient DATABASE_URL; bootstrap uses imperative db:push; root test config and reused browser server are not protected by a common manifest. These are source-level findings with independent pure parser counterexamples; not a destructive runtime probe.
- Independent reviewer demonstrated installed pg honors query host/port overrides despite a safe URL pathname, and old guard accepts malformed/HTTPS-shaped targets. No connection was attempted by these checks.
- A wholly separate PostgreSQL 18.6 synthetic cluster at 127.0.0.1:55432 was initialized and read back. Timezone UTC. See `LOCAL-TARGET.md`. Shared localhost:5432/finance_app was not connected to.
- New target guard regressions are being written/run by r00_targets; runtime/dependency checks by r00_runtime. Their final committed reports, review and integrated reruns are pending.

## Companion reconciliation and prerequisite boundary

The master governs. Companion PostgreSQL 16 is a historical proposal; supported deployment/local/CI parity will be decided from live evidence. CSV advisory remediation is evaluated now under R00 rather than deferred solely because the companion mentioned R09. Any major compatibility change needs focused regressions.

R00 prerequisite availability is distinct from full row closure: NEW-39 explicitly has R15/R19 supporting obligations, and staging-dependent runtime/limiter evidence remains required. Portable A1–A6 fixtures and honest production-mode browser proofs continue under the R00/R20 boundary; they cannot be silently discarded or replaced by green mock tests.

## Acceptance checklist

| Check | Current disposition |
|---|---|
| Supported Node/PostgreSQL pins and native/OCR compatibility | In progress |
| Fresh production audit and targeted fixes | In progress |
| Explicit host/port/database/run manifest before connection | In progress |
| Versioned disposable bootstrap and migration-only constraints | Pending guarded bootstrap |
| Ambient dotenv cannot re-enable provider/mail/push/Redis dispatch | In progress; transport proof pending |
| Root/server/client/browser target and owned-server protections | In progress |
| General limiter once; auth quota scoped; ordinary navigation/brute force | Assigned runtime worker after dependency slice |
| Shared Redis/multi-instance and protected runtime rate evidence | Pending; test-mode passes insufficient |
| Portable A1–A6 fixtures, matching browser and mandatory submit smoke | Pending R00/R20 continuation |
| Separate code/security/TypeScript review and integrated checks | Reviewer assigned; pending final changes |
| Staging identity/CI/external environment proof | Not established; applicable OI gates remain |

## Resume

Await reviewable worker commits, resolve reviewer findings, integrate explicit commits into campaign, install pinned runtime/dependencies and run affected guarded checks. Then dispatch R01/R19-foundation/R20 when their actual R00 local prerequisites are met. No application row is CLOSED or staging-verified.

## Integrated runtime checkpoint

Runtime author commit `b444fdf` was source-reviewed by separate `r00_final_review` (Sol xhigh, TypeScript/code/security review), with no new actionable source findings. Integrated as campaign `fc9ae1f6e84bd7812d4d79b1f09c199ccb5388ca`. Reviewer relied on recorded author static/native evidence; no independent compiler rerun or CI/staging claim.

Parent then ran a clean campaign-local `npm ci --no-audit --no-fund` using Node 24.22.0 Windows ARM64: 681 packages installed, exit 0. The campaign owns its node_modules directory; it is not a junction. On this integrated checkout, `npm run test:runtime` passed 2/2 and `npm run test:dependencies` passed 8/8, exit 0, no skips. Actual local SMTP sink, CSV prototype regression, multipart limits, proxy trust, sharp 0.35.5/libvips 8.18.7 and local OCR text `TOTAL 12345` were exercised. No application server or database was used for these checks.

Target core `de297ad` and Supertest timing fix `60d1c4b` initially remained outside the campaign pending a HIGH review finding: listener permission keyed by port alone could permit an unowned IPv4 endpoint when only the IPv6 endpoint was owned. Reviewer reproduced dispatch eligibility with the underlying socket stubbed; no foreign connection occurred. The checkpoint below supersedes that hold.

## Integrated guard and limiter checkpoint — 15 October 2026

Separate reviewer `r00_final_review` accepted address-family correction `3b08613` after independently repeating the original no-dispatch counterexample: explicit IPv6 ownership no longer permits the unowned IPv4 endpoint. Core, timing fix and endpoint fix integrated as `8e6f6de`, `c011997`, `bf15c6f`. Protected package/CI runners `d93b4a1` and CI context amendment `7c05e5b` integrated as `63aa843` and `b76212c`. The amendment moves runner temporary-path resolution from invalid job-level context into a shell step and persists an absolute manifest path. Hosted CI has not run.

Parent created a separate integrated target, `pfa_completion_integrated_r00int15b1_test`, run `r00int15b1`, on the existing isolated PostgreSQL instance at 127.0.0.1:55432. Manifest `.local/r00-integrated/target.json` declares browser origin http://127.0.0.1:5137. Guarded bootstrap created this new database and applied 12 versioned migrations. Parent marker proof passed promise, callback-once and Pool paths, foreign-marker refusal and final restoration/readback. An initial proof invocation without the required maintenance URL refused before connection; supplying the explicit same-instance maintenance URL completed the proof.

Integrated Node 24.22.0 ARM64 checks at `b76212c`: native target/endpoint regressions 9/9; completion-r00 protected unit tests 19/19; actual account HTTP/database tests 20/20; actual FX database tests 9/9. No skips. An initial combined account command contained a nonexistent FX filter and therefore ran accounts only; the correct FX path was subsequently run separately and passed. These are test-mode proofs, not production security evidence.

Limiter correction `88696d0` was separately reviewed and integrated as `f158f24`: general and analytics accounting once, credential quotas scoped to credential POST routes, existing numeric thresholds retained. Parent integrated limiter regressions passed 6/6. Adjacent merchants/rules/weekly-recap checks passed 3 files / 82 tests. Legacy entrypoint retirement and guarded synthetic diagnostic/fixture replacement `25a17fe` was separately source-reviewed and integrated as `241faa0`. Parent native legacy checks passed 14/14; parent synthetic diagnostic/fixture proof passed independent readback, replay, conflicting-password refusal, credential-log exclusion and exact fixture cleanup on the parent-only target.

Browser runner/global-setup/worker transport and per-client database protections were reviewed and integrated as `be7154e`, including IPv6 host normalization and explicit redirect refusal. The prior browser redirect escape HIGH was resolved by refusing redirect responses rather than collapsing navigation into a passing response. Ordinary-profile redirect journeys remain unsupported and require explicit R20 work.

The first full client run at `649650d` failed all 164 files before test collection with ERR_INVALID_URL_SCHEME: Vite rewrote the guard's static empty-dotenv URL. No application test ran. Reviewed filesystem path correction `2e2a9f5` integrated as `85feb49`; combined client-focused verification passed 2 files / 23 tests. Parent combined Chromium boundary proof passed 1/1 with zero requests at the denied sink, and native target/endpoint/browser guards passed 11/11. Integrated `npm run check` passed at application `85feb49` (subsequent changes were evidence only). The full server attempt was explicitly aborted after detecting another project's broad test workload; only verified campaign-owned processes were stopped and no server-suite result is inferred. Full client retry started after that other workload ended.

These reviewed and independently exercised local protections satisfy the prerequisites for dependency-ready local R01/R19 work and continued R20 harness work. This is a bounded foundation acceptance, not full R00, G0, staging or launch acceptance. Redis multi-instance, production-mode/browser, external runtime, portable A1–A6 and supporting R15/R19 obligations remain open; no canonical group is CLOSED.

## Integrated broad client/build checkpoint

At unchanged application `85feb49` (later commits documentation only), the complete client suite passed165files/1385tests, exit0,347.96s, via the protected wrapper with verbose reporting and stop-on-first-failure. All files passed; no tests skipped. Integrated production build passed and initial JavaScript gzip total185.78kB remains below300kB. The separate existing app login smoke passed1/1 in Chromium on a newly migrated synthetic browser target; its test setup verification reset does not establish real registration/email behavior. Full server retry remains pending resource scheduling. See ../R20/RESULT.md for failed/aborted prior attempts and exact scope.

## Subsequent full-server checkpoint

After reviewed R01/R19 integration and test-fixture compatibility corrections, exact application `8eef29ef04207fe822f5faddd128374ea45472c1` passed the complete protected server suite: 219 files / 2,846 tests, no failures or skips, 339.55s, exit 0. Target was the parent's marked identity database on the isolated 55432 instance, with 13 versioned migrations. `../CAMPAIGN.md` records exact changes, preceding failures and log paths. This supersedes the pending full-server status above; portable generators, production profile, actual Redis and hosted acceptance remain open. R00 and all canonical groups remain OPEN.

Fresh static checks and production build also passed at that unchanged application candidate (documentation HEAD `7aa1e4c`), exit 0; build 12.54s, initial JavaScript gzip 185.87 kB below 300 kB. Subsequent test-only accessible-dialog selector `5007d19` passed both protected Golden prefix browser cases in 33.3s, exit 0, independently reviewed, without weakening persistence or negative-control assertions. See the campaign ledger and R20 result for the preceding selector failure and exact logs. These results do not establish the remaining production or portable-fixture gates.
