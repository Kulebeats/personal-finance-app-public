# Full application completion specification

Owner objective: fully functional existing application, without the former November deadline. This is an implementation-ready specification and decision register, **not authorization to start changing application code**. Baseline and evidence are in [README](README.md) and [EVIDENCE](EVIDENCE.md).

## Definition of the finished product

A person can register, verify their address, recover access, create or join a household, manage appropriate shared/private financial records, understand correct balances and reports, use every advertised organization/planning/investment/automation capability, control their data and notifications, and leave/export/delete through documented self-service flows. The same outcomes must survive refresh, retry, concurrent requests, restart and deployment. An operator can detect failures, restore service/data and explain which jobs/providers succeeded.

Complete each existing advertised capability. A feature flag may contain a risk during development, but disabled imports, AI, investments, OCR, rules, MFA, recap, or missing self-service exit **do not count as full completion**. New discretionary enhancements are listed separately below so “finished” remains a finite target.

## Shared product and data contracts

| Contract | Proposed completion rule | Decision needed |
|---|---|---|
| Identity | Anonymous, pending verification, pending MFA, authenticated, revoked/erased are distinct states; financial access requires verified identity | Confirm address-verification requirement already implied by login behavior |
| Household | One active household per user; invitations bind to the intended verified address; all offered roles including Professional have explicit capabilities | Approve Professional's permission matrix; unknown roles always fail closed |
| Privacy | Private account/transaction details remain private to their owner across direct reads, relationships, lists, search, tags, exports, reports, AI, jobs and notifications | Decide whether shared aggregate totals may include private data, with explicit consent and consistent copy; default to exclusion |
| Currency | Every ledger write has an immutable source currency derived from its account; Money DTOs retain currency; FX conversion names its date/rate basis | Approve historical-flow vs current-valuation policy; no default relabeling on missing rates |
| Ledger | Account balance equals opening balance plus exactly one signed effect per active financial entry; transfer legs stay paired; allocations equal parent amount | Define historical-import balance option and refund/pending treatment |
| Classification | Uncategorized entries remain explainable and reconcile to headline totals; excluded classifications are explicitly disclosed | Decide whether uncategorized forms a displayed bucket; recommended yes |
| Planning | Contributions/adjustments/forecasts are distinguishable from cash movements and actual recorded investment trades | Preserve current GRZ record-only holding creation; label it clearly |
| Calendar | Date-only transactions retain their entered local day; schedules have explicit timezone, anchor and missed-run policy | Approve recurring/investment catch-up, end-date and month-end policy |
| Failure | No false success, fabricated export job, zero-on-provider-failure, or silently skipped financial row | Define partial-result UI where meaningful; otherwise reject atomically |
| Lifecycle | Edits/deletes reverse or recompute every dependent balance, split, goal link, lot, cache and audit under the declared contract | Approve shared-data retention/ownership on household leave/account erasure |
| External processing | Users know which typed/context data leaves the app and which service receives it; consent and delivery preferences have effect | Approve actual AI disclosure, retention, notification quiet-hour behavior and provider costs |
| Operations | Staging and production have known revision, runtime, DB/storage and provider identities, measured recovery targets and named owners | Supply environment ownership/access and select operational targets below |

Product decisions are bounded choices with concrete consequences, not requests to redesign everything. Resolve them in P00 and record them before changing ambiguous monetary/privacy behavior.

## Work packets

Effort is focused developer-days (about six engineering hours), including local regression evidence. Packet estimates are planning ranges; P19 covers cross-packet/UAT work. Specialist reports provide the detailed source locations and additional edge cases for each referenced ID.

### P00 — Reproducible environments, current dependencies and baseline (2–4 days)

Owner: lead engineer + deployment owner. Dependencies: none. Findings: DEP-01/02, OPS-011, QA-02.

- Choose supported Node and PostgreSQL versions; align engines, lockfile, CI, deployment and local verification. Resolve each production audit entry through targeted upgrades/applicability analysis; validate CSV, uploads, SMTP, image and proxy/rate-limit paths.
- Create separate disposable test, production-mode HTTPS staging and production configurations. Test setup must bind server URL/port to an owned DB/run marker before mutations, reject ambient or unknown targets and avoid arbitrary reused servers.
- Inventory secrets by name/provider/rotation owner without placing values in reports. Declare SMTP, Redis, upload storage, AI/push keys, public origin and cron identity. Staging uses sandbox providers and synthetic households.
- Record current schema, migration history, deployment SHA and feature inventory. Preserve existing real data; plan additive migrations and compatibility before backfills. Reconcile the new register with the canonical22-module/W9/W10 governance rather than overwriting historical evidence.

Acceptance: clean bootstrap on declared versions; current audit disposition; target-mismatch test refuses before a write; build and production-mode boot; same release identity visible in health and CI. Unknown provider access remains an assigned blocker, never “passed.”

### P01 — Sessions, safe DTOs and credential policy (3–5 days)

Owner: backend/security engineer. Depends P00. Findings: AH-01/02/10/12.

- Revoke actual PostgreSQL sessions and tracking rows together for selected device, all other devices, password reset/change and erasure. Scope supplied IDs to actor; handle a racing late session save; roll back destructive account operations on revocation failure.
- Allowlist public auth/profile/upload DTOs. No password/token/MFA/backup material in response, error, audit or log payloads.
- Atomically consume one-time MFA/recovery codes under lock/conditional write. Unify password policy across registration, change and recovery; bound attempts and code lifetime.

Acceptance: two-cookie positive/negative test, concurrent revoke/save, concurrent same-code redemption (one winner), concurrent consumption of two different valid backup codes (neither can be restored/reused by a lost update), replay/expiry, credential-field sentinel omission at real HTTP boundary, erased/revoked identity cannot regain access using an old cookie.

### P02 — Complete registration, verification and recovery (2–4 days)

Owner: frontend/backend engineer. Depends P01 and controlled SMTP. Findings: AH-03/04, UX-01.

- Canonical registration/resend/email-change links resolve to real pages. Pending verification has a useful resend/recovery/logout path and no financial authorization. Initialization is atomic or recoverable after a dependent-row failure.
- Complete mail-link -> fresh browser -> API -> persisted state -> subsequent login for verify and reset. Expired, used, malformed and wrong-user links have safe, specific outcomes.
- Stop household-dependent queries until membership exists; the first-run screen has one setup call to action rather than repeated raw404 toasts.

Acceptance: entire fresh browser journey with captured exact mail links; delivery timeout/retry; logout/login after verification; lost-response replay; expired/used reset tokens; password reset invalidates all other sessions. Fixture SQL bypasses cannot satisfy this packet.

### P03 — Full household collaboration lifecycle (4–7 days)

Owner: frontend/backend engineer. Depends P02. Findings: AH-05/06/13.

- Connect Add Member to the actual invitation lifecycle and implement acceptance route/auth continuation, recipient binding, pending list, resend/cancel and expired/reused cases.
- Align flat/nested member DTOs, real names and supported roles; no “Unknown User” for valid data or unsupported professional permission promises.
- Serialize acceptance/creation/leave/transfer/removal to preserve membership/owner invariants under concurrent requests. Implement discoverable self-service leave and ownership transfer, with clear shared/private-data consequences.

Acceptance: owner invites a second person via exact mail URL, existing/new user accepts, third person's token misuse fails, concurrent two-household acceptance yields one membership, role/removal effects apply immediately to active sessions, final owner cannot accidentally orphan household.

### P04 — Complete privacy and authorization matrix (3–5 days)

Owner: backend/security engineer. Depends P01/P03; shared prerequisite for every financial domain. Findings: FIN-01, AH-09, OPS-005, organization role/tag/reference defects.

- One explicit, fail-closed role matrix; no comparisons involving undefined hierarchy values. Cover professional and invalid roles deliberately, including seeding/admin endpoints.
- Carry viewer/actor identity through accounts, transaction export, goals/links/assignments, investments/lots/portfolio, tags, recurring/recap, rule actions, AI and every aggregate consumer. Revalidate references against the current household and visibility before writes.
- Enforce private account **and** private transaction rules consistently, including nested data, counts/metadata and mutations. Household membership alone is insufficient. Personal settings and shared household settings use different authorization policies.

Acceptance: two users plus viewer in H, outsider in J, private/shared account and private/shared transaction cross-product. For every relevant route test allowed owner path, denied other-member path, outsider and role variants, indirect read/export/AI/email paths, guessed foreign IDs and request races. Assert both response and unchanged unauthorized DB rows.

### P05 — Complete settings, MFA management, portability and exit (12–20 days)

Owner: frontend/backend engineer + product/privacy owner. Depends P01–P04. Findings: AH-07/08/11/13.

- Implement every approved visible profile/contact/financial field with explicit schemas, constraints, clearing behavior and persistence. No blanket user-row update; system/role/credential/computed fields are excluded. Document necessity/retention of sensitive profile fields.
- Complete MFA enrollment, disable, recovery-code generation/regeneration, recovery and policy display. Approve mandatory-policy scope and implement real enforcement and coherent onboarding; flipping an inert flag is insufficient. Policy changes must affect existing sessions under the agreed reauthentication rule. Any high-value threshold must normalize currencies and define fail-closed missing/stale-FX behavior, rather than compare unrelated currency amounts.
- Implement genuine self-service data export with a bounded, authorized downloadable artifact and truthful progress/errors. Full-account export differs from a report CSV.
- Complete account erasure for no-household/sole-owner/shared-member states: sessions/tokens, retained shared data, private rows, uploaded files, audit/retention and backup consequences. Add self-service discoverability and confirmation/re-authentication.
- Finish shared/combined view configuration, persisted visibility enforcement and membership/entitlement displays derived from approved actual state. No new paid-billing system is assumed. Operator assistance remains support, not a replacement for advertised self-service functionality. This packet is substantial: profile/display, MFA management, export/erasure and shared-view/entitlement behavior are separate deliverables; its estimate includes all four.

Acceptance: field matrix UI -> API -> DB -> reload; all MFA lifecycle/provider-failure cases, policy changes against existing sessions, cross-currency threshold equivalence and missing/stale-FX decisions; export schema/content/count/privacy verification; erase fixture then stale-cookie/token/file replay; other members retain only intended shared data; interrupted/retried exit is safe.

### P06 — Accounts and ledger invariants across every writer (4–6 days)

Owner: backend financial engineer. Depends P04. Findings: FIN-05/08/13/16/17 and rules split findings.

- Persist currency from locked account for manual, import, recurring, receipt, rule and GRZ postings; migrate legacy nulls only from reliable account/history evidence. Freeze or explicitly reconcile denomination, account type/asset-liability class and opening-balance changes.
- Make split edits atomic and equal to parent amount; reject monetary parent changes without valid replacement splits. Preserve paired transfers through edits/deletes/overwrite paths.
- Maintain durable atomic financial audit/outbox and declared optimistic-version/lock behavior. Centralize cache dependencies for both server cache families and client query keys; await post-commit invalidation across multiple instances and no-Redis mode.

Acceptance: create/edit/delete/restore-if-supported, split and transfer lifecycle, failure rollback and concurrent writers; exact balances, currencies, splits, paired legs, audit and immediate list/summary/dashboard/report agreement. Tests must run with caches enabled, not wait for TTL.

### P07 — One correct import/export product (3–5 days)

Owner: backend/frontend financial engineer. Depends P06. Findings: FIN-02/03/04/15.

- Consolidate global and account-detail UI onto a documented import engine. Preview mapping, explicit date convention, currency, signed expense/income, duplicate decisions, affected existing rows, transfers and balance effect.
- Use batch/row identity compatible with stored key types and retries. Atomically reconcile overwrite; preserve both transfer legs or reject conflicting replacement before any deletion. Do not count validation/database failure as a successful duplicate skip.
- Define legitimate identical-looking purchases, overlap/partial file policy and old-import lineage. Strictly reject impossible dates. Exports round-trip type/sign/currency/precision and protect private data and spreadsheet formula cells.

Acceptance: first/repeat/concurrent/lost-response imports, changed mapping, duplicate-looking purchases, overlapping dates, transfers/private counterpart, mixed/invalid rows, failure after deletion, expense/income export reimport, and both advertised balance options. Opening100-expense10+income20 finishes110 exactly once.

### P08 — Reconciled budgets, history and rollover (3–5 days)

Owner: financial engineer + product owner. Depends P06/P12 and currency policy. Findings: FIN-06/07 and budget policy gaps.

- One date-aware, split-aware currency calculation for category/group/flex progress, forecasts, historical recalculation, rollover and report comparisons.
- Historical average divides by the approved month denominator; preview/confirm recalculation, include zero/partial months deliberately. Define refund, pending, excluded, transfer and private-spending semantics.
- Complete create/edit/delete, month navigation, overspend alerts, category changes and rollover scheduling with visible provenance and retry state.

Acceptance: ZMW100 +USD10 at20 ->ZMW300; three months100/100/100 ->100 monthly; zero months, leap/year boundary, split/refund/private/pending fixtures; one rollover across repeated workers; every visible budget and export agrees with independent expected totals.

### P09 — Reversible, authorized goals (2–4 days)

Owner: financial engineer. Depends P04/P06. Findings: FIN-09 and goal privacy variants.

- Specify currency-aware contributions, spending, allocation limits, assignments and manual adjustments. Preserve effective delta so link/unlink returns the exact starting state, including overspend clamps.
- Source edit/delete recomputes or reverses contributions atomically; soft-deleted transactions are not live links. Expose progress and recorded cash movement distinctly; include archive/complete/delete/reopen states where offered.

Acceptance: goal5 ->spend10 ->unlink returns5; contribute/edit/delete; two goals allocating one source; mismatched currency; repeated/concurrent link/unlink/delete; private assignment and link reads; browser progress and persisted ledger reconcile.

### P10 — Complete investment and GRZ lifecycles (4–7 days)

Owner: financial engineer + domain/product reviewer. Depends P04/P06/P11. Findings: FIN-10/11/12/14 and GRZ policy gaps.

- Unify manual and automated purchase writers: holdings, acquisition/remaining tax lots, cost basis, cash-recording semantics, fees, precision and audit. Derive or atomically maintain aggregate basis; reconcile legacy positions without inventing costs.
- Complete manual/automated buy -> partial/full FIFO sell -> portfolio/report/export, dividend and interest recording, pause/cancel plans, pension/GRZ holding paths already offered, coupon/maturity/rollover, and end-date/overdue/calendar anchoring. Dividend/interest gross, withholding and net values must reconcile with their declared cash effects and investment tax/income reports.
- Preserve current **record-only** GRZ holding creation. Document recorded trade versus external execution; do not introduce brokerage execution. Actual yield/rate/tax/withholding conventions require domain review; no silent15% assumed real yield.
- Missing FX/price means explicit incomplete valuation, never a successful understated net-worth total.

Acceptance: buy at unchanged price produces zero invented gain; sum remaining lots equals holdings/basis; automation purchase can later sell; concurrent sale has one valid outcome; Jan31/leap/overdue dates; coupon/maturity repeat once; dividend/interest gross-withholding=net, retries do not duplicate declared cash effects, and investment tax/income report totals agree; foreign valuation loss/recovery; same fixture across account/portfolio/net-worth/export. These assertions test the approved convention, not legal correctness of tax rates.

### P11 — Reliable recurring work and job operations (3–5 days)

Owner: backend/operations engineer. Depends P06; coordinate P08–P10/P14/P15. Findings: OPS-003/013, FIN-12 and recurring gaps.

- Publish registry for recurring materialization, investment plans, GRZ coupons/maturity, budget rollover, snapshots, receipt matching/retry, cleanup and recap: trigger/timezone, due identity, lease, retry/catch-up, output invariant, last success and owner.
- Wire actual worker/cron startup and deployment schedules. Use durable unique occurrence/run records; an expiring Redis lock alone is not exactly-once proof. Bound/renew leases and separate evictable cache from coordination needs.
- Provide honest due/paused/failed/overdue states, retry controls and staleness alerts. Graceful shutdown does not lose an accepted run or duplicate its financial effect.

Acceptance: simultaneous and delayed ticks, missed days, failure before/after commit, timeout, worker crash/restart, DST/timezone/month-end/end-date, repeated catch-up; exactly one expected persisted occurrence and actionable failures. Verify actual scheduled execution on staging.

### P12 — Finish organization and rule workflows (3–5 days)

Owner: backend/frontend engineer. Depends P04/P06. Findings: all organization findings; FIN-08 interactions.

- Complete category/group, tag/merge, merchant/alias/logo/analytics/transaction-detail/merge/undo and saved-filter create/edit/delete/default/apply journeys.
- Implement missing merchant endpoints behind correct authorization; distinguish archive while retaining existing transactions, actual permanent deletion under the approved history policy, and merge into another merchant. Derive undo counters from actual affected rows, atomically claim history for undo, and define whether aliases are moved or retained. Correct repeat-removal counts and activate saved default filters with explicit URL-filter precedence, reset and user-switch behavior.
- Rule dry-run evaluates an immutable snapshot and returns proposed actions/diffs without writes. Execution validates all foreign IDs, role and private visibility, aggregates split amounts exactly, and commits bounded auditable changes. Define precedence and apply-to-past retry/undo behavior, including accurate failed-row reporting instead of silent partial success.

Acceptance: database snapshots unchanged by every dry-run action; foreign category/tag/owner references rejected; 100 parent cannot produce 150 allocations; apply-to-past row failures are visible and retry safely; archive/permanent-delete/merge produce their separately promised results with existing history; concurrent/replayed merge undo has one valid claim and preserves intervening edits, accurate counts and declared alias ownership; every merchant button reaches a real route and survives reload; preset default applies on fresh navigation but does not override explicit URL filters, and reset/user-switch cannot reuse another user's default.

### P13 — Correct dashboards, reports, cash flow and export (3–5 days)

Owner: frontend/backend financial engineer. Depends P06/P08–P12. Findings: FIN-14/17/18 and classification gaps.

- Define period fields (e.g. `periodStart` ISO date plus separate display label), currency, basis/date, completeness and filter/viewer contract shared by charts/tables/export. Do not parse formatted month labels as ISO.
- Reconcile income/expenses/savings/debt/net worth, monthly/quarterly/half-year/year aggregation, current vs historical FX and uncategorized amounts. Missing data differs from zero. Caches follow post-commit state.
- Finish widget customization/persistence, drill-down, layouts, report export/history and command/navigation affordances with accurate date labels, currencies and negative amounts.

Acceptance: actual server DTO consumed by actual chart adapter for all chart types; no Invalid Date/NaN;12 distinct months stay distinct; quarterly totals equal month sum; filters/privacy/export match; numbers match an independent multi-account/multi-currency ledger, including zero/incomplete/error states.

### P14 — Durable uploads and complete receipts/OCR (2–4 days)

Owner: frontend/backend + operations. Depends P00/P04/P06/P11. Findings: OPS-001/004 and merchant logo completion.

- One durable upload abstraction/root across receipts, transaction attachments, goal images, profile/banner and merchant logos. Authenticated access, size/type/quota validation, orphan cleanup, retention and DB+file recovery are explicit.
- Self-host or narrowly authorize OCR worker/WASM/language assets under production CSP. Complete upload -> scan -> review/correct -> match/create ledger -> reopen/delete, with cancellation, retry and duplicate safety. Wire delayed matching when later transactions arrive.

Acceptance: synthetic known receipt at production headers; correction and currency/date persistence; same image/retry cannot double-post; malicious/oversized input rejected; mobile first scan/error/cancel measured; restart/redeploy/restore retains exact file hashes and authorization.

### P15 — Honest notifications and weekly recap (3–5 days)

Owner: backend/frontend engineer. Depends P04/P11/P13. Findings: OPS-005–010.

- Preserve viewer/currency in recap, respect content/day/quiet-hour preferences under an explicit contract, and signal unavailable inputs instead of false zeros. Complete generation, history, in-app display and email content.
- Validate supported push destinations/keys with egress restrictions and timeouts. Escape user-controlled email text. Record per-event/per-channel queued/sent/failed/skipped state with durable dedupe and controlled retry.
- Subscription/unsubscription, consent revocation, invalid endpoints, delivery failures and preferences have visible, truthful results.

Acceptance: other member's private recurring absent everywhere; mixed-currency totals correct; missing FX suppresses misleading digest; hostile names render as literal text; email-only retry sends once; in-app success/email failure retries only failed channel; controlled inbox/device proof, no arbitrary outbound destination.

### P16 — Working, bounded and truthful AI assistance (4–7 days)

Owner: AI/backend engineer + product/privacy owner. Depends P04/P13 and P18's environment/logging/secret/timeout foundation, not its final full-app closure. Findings: OPS-012.

**Owner-approved specification change CHG-AI-01:** Claude is primary, Gemini is fallback, and the existing local mode is the final degraded path. Implement the [Thandi provider specification](THANDI_PROVIDER_SPEC.md), including stage-aware failover, both-provider consent, honest usage/provenance and bounded spending. The owner reports Claude API credits; no key/account access or live call was performed for this update. Implementation remains unauthorized until separately requested.

**14 October review closure:** household consent is managed only by owners/admins with role-accurate controls and disclosure; other roles cannot toggle it. Paid calls require atomic shared quota/spend reservations across instances, replay-safe settlement and retained reservations for uncertain charges before any Gemini fallback. Acceptance includes concurrent requests competing for the last budget unit and member/viewer/Professional consent-denial cases. See the linked specification for the complete contract; P16's estimate is unchanged.

- Configure a currently supported model with a real availability check; retain deterministic financial calculations in application tools. Align consent copy with typed text, stored history and tool context actually transmitted.
- Enforce identity/privacy in every tool, cancellation/deadline, quota/error recovery, measurable provider usage/cost alerts and deletion/retention. Distinguish estimates from measured token/billing totals.
- Define supported advice/tasks and limitations, grounding in correct data and traceable sources/rate dates. Maintain evaluations for numerical truthfulness, cross-household leakage, prompt injection in user/imported/provider content, refusal/error, consent absence/revocation and provider outage.

Acceptance: controlled synthetic provider smoke; consent absent/revoked yields no provider call; financial answer agrees with independent ledger; unauthorized context never reaches provider; timeout cancels where supported and cannot trigger unbounded retries/spend; latest evaluation report tied to model/config/revision.

### P17 — Complete UX, accessibility and device quality (3–5 days)

Owner: frontend/product engineer + independent usability reviewer. Depends on delivered domain flows. Findings: UX-01/02, unsupported/misleading controls across reports.

- Normalize loading/empty/error/retry/offline states and form-save feedback; protect unsaved work and prevent double submissions. Clearly label destructive actions, privacy and record-only versus actual balance effects.
- Responsive navigation, tables/cards, summaries, dialogs and charts at320/390/768/1280+,200% zoom and portrait/landscape. Keyboard focus/skip links/dialog traps and return, accessible names, error association, contrast, non-color status, reduced motion and chart table alternatives.
- Use explicit user tests through login, invitation, first transaction, reconciliation, import, recurring, goal, receipt, investment and export/exit. No critical action depends on hover or clipping.

Acceptance: documented keyboard/screen-reader and actual phone/browser checks of critical journeys, actionable issue log closed, no horizontal page overflow for ordinary forms/navigation, no inaccessible controls or raw internal error JSON. Target WCAG2.2AA; this is a proposed product quality target requiring executed audit, not a current compliance claim.

### P18 — Production reliability, recovery and support (4–6 days)

Owner: operations engineer + named service owner. Starts with P00; closes after domains stabilize. Findings: OPS-002/013/014/015, QA-02.

- Bounded DB/Redis readiness and dependency errors; correct probe selection, revision identity, strict DB certificate verification (including migrations), secure proxy/cookie/CSRF/CSP configuration, secret rotation and environment separation.
- Structured recursively redacted logs retaining job/provider outcomes; actionable alerts for failed jobs, dependency health, delivery, error rate and recovery. Publish backup/restore, rollback, incident and support/data-request procedures with named owners.
- Rehearse DB+file restore to a fresh target, compatible application rollback, failed migration recovery and outage/recovery without corruption. Measure performance with realistic history and simultaneous households; choose budgets from measurements.

Proposed initial operational acceptance targets, to ratify in P00:100 concurrent active users across20 synthetic households; ordinary API p95<=500ms and core page interaction ready<=3s on a specified device/network; heavier report/import has explicit bounded duration/progress; restore data-loss window<=24h and recovery<=4h. These are engineering targets, not measured current performance or an SLA promise. Adjust based on actual hosting/cost needs and document the agreed values.

Acceptance: controlled DB/Redis/provider faults return within the agreed timeout; bad CA fails; restart/deploy/rollback/restore report with actual timings/counts/file hashes; load report meets agreed budgets; one induced incident alerts a reachable owner and runbook resolves it.

### P19 — Integrated acceptance and release closure (5–8 days)

Owner: QA/reviewer independent of the implementation where feasible; product owner accepts scope. Depends all packets.

- Replace vacuous E2E checks and seed deterministic populated fixtures; exercise actual submit/save/read-back and error branches. Run all supported browsers/devices and production-mode HTTPS flows.
- Close each register row with revision, test name, independent expected result, environment and evidence link. Verify migrations on a realistic sanitized prior-schema dataset as well as empty DBs; no undocumented data loss.
- Complete participant-facing help, supported roles/features, import/record-only explanations, privacy/retention/export/exit and support contacts. Run owner UAT, then a monitored invited-household rollout before broader availability.
- Refresh canonical module assessments/W9/W10 and release notes only from completed evidence. Keep residual nonblocking limitations explicitly accepted with owner/date; full advertised behavior cannot be silently deferred.

Acceptance: all required journeys below pass, all P0/P1 resolved, all promised functions meet contract, reproducible exact-release checks/audit, production operations proved, owner accepts UAT and launch separately. No source assessment alone closes P19.

## Required end-to-end acceptance catalogue

| Journey | Required endpoints/states and independent result |
|---|---|
| J01 Identity | Register -> actual mail -> verify -> login/logout -> reset -> old-cookie denial; failures/replay/expiry |
| J02 Household | Invite -> correct recipient accepts -> role changes/removal -> leave/transfer; concurrent acceptance; outsider rejection |
| J03 Security/settings | MFA enroll/login/recovery/disable, revoke device/all, profile field clear/save/reload, personal vs shared preference roles |
| J04 Accounts/ledger | Opening1,000, income200, expense125.50 ->1,074.50; transfer100 to empty account ->974.50 and100, household1,074.50; retry/edit/delete exact reversal |
| J05 Privacy | Owner/admin/member/view_only/Professional, outsider and invalid-role controls across direct/related/list/tag/search/report/export/AI/notification paths; no hidden writes |
| J06 Imports | Both UI entrances, preview, expense/income signs, date formats, invalid rows, duplicate/overwrite/transfer collisions, rollback and retry |
| J07 Organization | Categories/groups/tags/merchants with merge/undo/alias/logo/details; rules preview no writes, execute valid changes once; default filters |
| J08 Budgets | Multi-currency/split/refund/pending/private policy; historical average and rollover; UI/report/export equality |
| J09 Goals | Contribution/source edit/delete, allocation/assignment, link/unlink reversibility, archive/complete/reopen policy |
| J10 Recurring/jobs | Real scheduled tick, retry/overdue/calendar boundary/pause/end, visible run history and exactly-once financial effect |
| J11 Investments | Manual/automated buy -> lots/basis -> partial/full sell; dividend/interest gross/withholding/net and tax/income-report parity; declared cash effects/retries; GRZ coupon/maturity/rollover, pension/holding paths, missing FX/price |
| J12 Reporting | Dashboard/cashflow/all report tabs/chart types/date periods/filters/drilldown/export/history agree with independent dataset |
| J13 Receipts | Upload/OCR/correct/match/create/retry/delete, CSP, unauthorized access, restart and restore |
| J14 Outbound/AI | Email/push/recap preference/delivery/retry/privacy; provider consent, supported model, cancellation, quota/evaluation |
| J15 Portability/exit | Full export; household-free/sole/shared erasure; stale sessions/tokens/files denied; intended shared records retained |
| J16 Operations/device | Fresh migrate/upgrade, HTTPS/CSRF/cookies/TLS, dependency failures, load, keyboard/screen reader/phone, restore/rollback/alert |

Add independent FX dataset ZMW100 +USD10 at20 =ZMW300; split100=60+40; goal5-spending10-unlink=5; investment two purchases at unchanged price has zero fabricated gain. Preserve transaction date in Lusaka and UTC environments. Expected values must be handwritten/independent, not calculated by the same production helper under test.

## Enhancements beyond repairing existing promises

These do not replace completion work and are not included in the revised 72–122-day estimate. Claude-primary/Gemini-fallback is an approved P16 requirement, not one of these optional enhancements.

| Enhancement | Benefit | Priority / prerequisite | Approximate additional effort |
|---|---|---|---|
| Reconciliation workspace with explained balance changes | Users can trace opening balance, imports, transfers and adjustments and flag discrepancies | First enhancement after P06/P07; existing correctness must work first | 3–6 days |
| Guided setup and sample-data tour with progress checklist | Makes the broad product usable without support | After P02/P03/P17; fix first-run errors before adding a tour | 2–4 days |
| Household activity/approval center | Explains who changed shared data and supports optional approval of major edits | After privacy/audit contracts; never expose private records through feed | 4–7 days |
| Better search and accessible command palette | Faster retrieval across transactions, merchants, receipts and goals | After common visibility/query contract | 3–5 days |
| Offline capture with conflict-aware sync | Useful for intermittent connectivity | Separate design after idempotency/versioning; significant security/data-retention scope | 8–15 days |
| Bank/statement-provider connections | Reduces manual input | Separate provider/licensing/security discovery; not promised by current source scope | Discovery first; no reliable build estimate yet |

Do not begin new bank/broker execution, payment initiation, broad AI automation or a major redesign merely to make the app “complete.” Those are separate products unless the owner explicitly adds them. The full existing application already has a substantial finite completion backlog.
