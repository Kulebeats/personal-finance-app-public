# Remaining work — all 101 required closure items

Version 1.0,15 October 2026. **Everything below is OPEN; no remediation was performed.** 17 P0,72 P1,12 P2 are consolidated ordering labels, not counts of runtime-proven exploits. Push is conditional on enabled egress; unknown Professional reachability is reflected in its P1. Every row is required for the full-product brief, including polish on offered controls.

The machine-readable [CSV](REMAINING_WORK.csv) records source aliases, evidence strength, packet owners, statuses and closure fields. Original 62 Codex IDs are preserved; NEW-01–39 distinguish additional Claude failure families. [Source coverage](SOURCE_COVERAGE.md) disambiguates recurring/security ID collisions and preserves smaller domain findings. Closely related variants share rows and packet work; do not add counts from the original reports. Formal technical/operational requirements also apply through SPEC and the packet plan.

## R00 — Reproducible baseline, runtime and dependencies

- **DEP-01 (P1) — production dependency security gate is stale.** Close when: Fresh dependency assessment and targeted fixes pass compatibility and release security gate; no blind major upgrade.
- **DEP-02 (P1) — runtime target requires refresh.** Close when: Supported runtime selected and pinned consistently across CI/local/deployment; implementation-time lifecycle verified.
- **NEW-08 (P1) — Ordinary navigation and auth hit duplicated or broad limiters.** Close when: Normal shared-IP onboarding passes; deliberate brute force throttles; Redis and multi-instance rate counts correct. Uniform lockout responses avoid account enumeration.
- **NEW-39 (P2) — Schema, legacy files and admin surfaces need explicit cleanup.** Close when: Name constraints safely; scoped uniqueness migration; missing-table admin path repaired; health public fields minimized; receipt paths omitted; tracked uploads preserved in approved storage before removal.

## R01 — Sessions, public DTOs and credential concurrency

- **AH-01 (P0) — revocation does not invalidate live cookies.** Close when: Revoked selected/all-other cookies401 including racing delayed session save; unrelated active session preserved.
- **AH-02 (P1) — ordinary user/profile responses expose authentication material.** Close when: Public auth/member/profile DTO key allowlists omit credential and inappropriate sensitive sentinel fields at real HTTP boundary.
- **AH-10 (P1) — “one-time” MFA consumption is not atomic.** Close when: Concurrent same code one winner; concurrent two distinct backup codes both remain consumed; expiry/replay fail.
- **AH-12 (P1) — password changes can downgrade the registration/reset policy.** Close when: Register/reset/change share password validation and history policy; attempted downgrade rejected.

## R02 — Registration, verification and recovery

- **AH-03 (P1) — registration verification emails open an unregistered route.** Close when: Every emitted verification URL resolves to actual page and successfully consumes the raw mail token.
- **AH-04 (P1) — registration grants full access before verification.** Close when: Pending-verification cookie can recover/verify/logout but every financial and household route denies access.
- **UX-01 (P1) — first-run and anonymous data fetching produces misleading error cascades.** Close when: First-run unauthenticated/household-free UI shows correct next action without unrelated query error cascade.
- **NEW-07 (P1) — Fresh-browser verification fails CSRF.** Close when: Exact verification link works without registering cookie with all other mutation CSRF guards intact.

## R03 — Membership, ownership and Professional lifecycle

- **AH-05 (P1) — household collaboration is disconnected at several live boundaries.** Close when: Add-member through recipient mail acceptance works; names/role/leave/transfer controls persist real state.
- **AH-06 (P1) — invite acceptance lacks recipient binding and cross-household serialization.** Close when: Verified intended recipient only; concurrent two-household accepts/create yield one membership and one conflict.
- **AH-13 (P2) — visible collaboration controls make unsupported promises.** Close when: Professional and named shared-view controls work; actual memberships drive UI; fictional paid-plan claims removed.
- **NEW-12 (P0) — Ownership operations can orphan household or create competing owners.** Close when: Self-transfer400; exactly one owner after any successful transition; competing transfers/role writes serialize.

## R04 — Complete visibility and capability enforcement

- **FIN-01 (P0) — private financial data bypasses ordinary account and transaction visibility.** Close when: All indirect readers/writers and export counts exclude unauthorized private account/transaction data; do not rely on one visibility flag.
- **OPS-005 (P0) — Weekly recap can disclose another member's private recurring bills.** Close when: Recipient recap contains no other member private recurring name/amount/id across widget/email/push.
- **ORG-001 (P1) — Professional role falls through organization write checks.** Close when: Explicit Professional read-only matrix enforced and unknown role denied at every capability boundary.
- **ORG-002 (P0) — Tag transaction lists omit private-account visibility.** Close when: Tag lists/counts exclude transactions on private accounts as well as transaction-private rows.
- **ORG-003 (P0) — Rule actions can reference entities outside the household.** Close when: Foreign category/tag/member/goal/merchant IDs fail before writes at authoring and execution; legacy rules quarantined.
- **AH-09 (P1) — view-only members can mutate shared household preferences.** Close when: View-only/member/Professional shared policy writes403, unchanged household row; personal preferences remain writable by their owner.
- **NEW-01 (P0) — Cross-household goal activity exposure.** Close when: Foreign goal activity returns404 with no metadata; same-household private activity excludes hidden amounts.
- **NEW-33 (P2) — Malformed identifiers, foreign paths and detection endpoints mishandle errors.** Close when: Malformed UUID400, invisible object404 without leak; unknown revoke404; recurring detect works or bounded useful error. Reject unsupported far-future dates with documented bounds. Unknown /api paths return JSON404 before SPA fallback; unsupported version aliases are explicit.

## R05 — Persistent settings and shared views

- **AH-07 (P1) — profile saves silently discard offered data.** Close when: Each offered profile field including null clearing persists UI->API->DB->reload; unwanted sensitive fields never broadly disclosed.
- **NEW-11 (P1) — Default shared filter hides first owned account.** Close when: First account appears immediately under All; saved per-user filters restored; empty states distinguish filtering.
- **NEW-16 (P1) — Budget rollover preference cannot be persisted.** Close when: Owner enables rollover; preference read-back persists; next period receives450 exactly once.
- **NEW-26 (P1) — Personal preferences do not persist separately.** Close when: User preferences update own record only; household policy owner/admin; changing currency with history409. Partial notification update preserves omitted threshold; explicit null clears; type is allowlisted.

## R06 — MFA management and security policy

- **AH-11 (P1) — MFA management and policy are unfinished.** Close when: Enroll/login/backup/regenerate/recover/disable UI works; mandatory policy constrains existing sessions with currency-aware step-up. Enrollment also requires step-up and completed factor challenge before enabling MFA or issuing active recovery codes.

## R07 — Self-service export, leave and erasure

- **AH-08 (P1) — account exit and full portability are unfinished.** Close when: Self-service authorized export and all three erasure states complete with replay-safe cleanup and preserved legitimate shared history.

## R08 — Ledger invariants across every writer

- **FIN-05 (P1) — ledger producers lose currency, and summary DTOs label converted totals as ZMW.** Close when: Every writer stores proven account currency; summaries report actual converted currency; ambiguous legacy nulls quarantined.
- **FIN-08 (P1) — editing a split transaction amount leaves budget/report child totals stale.** Close when: Parent100 splits60+40; editing parent requires valid replacement allocations atomically; readers never retain stale sum.
- **FIN-13 (P1) — account edits can reinterpret existing money without ledger reconciliation.** Close when: Account denomination/type/opening balance edits with activity409 unless explicit reconciled adjustment workflow is used.
- **FIN-17 (P1) — transaction summary remains stale after successful financial writes.** Close when: Both server cache families/client keys update after commit without waiting TTL; cross-member reads revalidate; dated-flow FX used.
- **ORG-005 (P1) — Rule split allocations can exceed the parent transaction amount.** Close when: Percent60+60 or money allocation exceeding parent rejected; normal split sums exactly.
- **FIN-16 (P1) — transaction UPDATE audit is not atomic despite its documentation.** Close when: Transaction update and its audit/outbox commit or roll back together; no success without mandatory audit.
- **NEW-05 (P0) — Card purchase reduces debt instead of increasing it.** Close when: Debt500 plus purchase45.50 becomes545.50; net worth falls45.50; migration reports legacy uncertainty.
- **NEW-28 (P1) — Shared owner selection ignored on transaction creation.** Close when: Shared null owner persists on shared account; private ownership cannot be broadened through selector.
- **NEW-32 (P1) — Financial writers/exports omit or duplicate audit records.** Close when: One audit per actual action in same transaction/outbox; bulk audit valid UUID plus batch metadata; exports tracked. Budget transfer to self rejected without transfer audit; rule edits and SIP creation audited.
- **NEW-35 (P2) — Money DTOs and precision inconsistent in peripheral views.** Close when: Decimal/Money through calculations; API amounts decimal strings with currency; display conversion never used for ledger math. Fees persisted in net proceeds/cost and reconciled to lot basis. CSV money values are fixed currency-scale decimal strings.

## R09 — One correct import/export workflow

- **FIN-02 (P0) — replaying an overwrite import deletes the data it previously imported.** Close when: Overwrite same file repeatedly leaves original intended live rows and exact balance; failure rolls back entire replacement.
- **FIN-03 (P0) — CSV overwrite deletes a single leg of an account transfer.** Close when: Account-level overwrite intersects transfer -> explicit preview conflict or reviewed pair-safe operation; never one live leg.
- **FIN-04 (P1) — the account-detail import path cannot import any row and its repair must address sign/balance semantics.** Close when: Valid account-detail CSV imports1 with correct UUID/sign/once-only balance; exported values roundtrip without double charge.
- **FIN-15 (P1) — CSV accepts nonexistent dates and silently chooses US ordering for ambiguous dates.** Close when: Feb30 rejected; ambiguous slash date requires selected format; date-only roundtrip unchanged.
- **NEW-17 (P1) — Import dedupe loses legitimate repeated purchases and metadata.** Close when: Two identical purchases in one batch retained; exact batch replay idempotent; Notes/mapping/history and row errors preserved.

## R10 — Budgets and reversible goals

- **FIN-06 (P0) — primary budget progress sums different currencies without conversion.** Close when: ZMW budget includes USD50 at approved dated FX, never K50 by relabeling; missing rate explicit. Explicitly classified refunds reduce their original expense category; generic income is not silently assumed to be a refund.
- **FIN-07 (P1) — “historical averages” writes the entire multi-month total as one monthly budget.** Close when: Three months totaling550 yields183.33 monthly suggestion; zero months valid; future months excluded; manual budgets preserved without confirmation.
- **FIN-09 (P1) — goal transaction links do not preserve progress across their full lifecycle.** Close when: Link/edit/delete/unlink/contribution/assigned account modes reconcile exact stored progress and inverse correction. Minimal partial assignment defaults must be valid and distinct from automatic full-balance mode.
- **NEW-29 (P1) — Goal contribution errors cannot be reversed safely.** Close when: Invalid/unbounded input rejected; deliberate overfunding explicitly confirmed; correction reverses exact contribution without arbitrary clamping.

## R11 — Rules, tags, merchants and saved organization

- **ORG-004 (P1) — Rule dry-run performs database writes.** Close when: Every rule action dry-run leaves DB snapshots unchanged and faithfully lists tag/alias/split effects.
- **ORG-006 (P1) — Reachable merchant controls have no corresponding server routes.** Close when: All client merchant detail/alias/logo/analytics/transaction/test-rule controls have authorized reachable handlers and persisted outcomes.
- **ORG-007 (P1) — Merchant deletion options disagree with server behavior.** Close when: Delete/archive/reassign options match documented UI/server behavior with referenced transactions preserved correctly.
- **ORG-008 (P2) — Merchant undo adjusts counts using the original snapshot, not rows actually restored.** Close when: Undo updates links/counters from rows actually restored after intervening changes, not original snapshot size.
- **ORG-009 (P2) — Repeating tag removal incorrectly decrements usage count.** Close when: Repeated tag removal changes count once; counts equal actual links after concurrent mutations.
- **ORG-010 (P2) — Saved default preset is stored but never applied on entry.** Close when: Saved default preset applies on entry and survives reload; per-user reset is functional.
- **NEW-09 (P1) — Category picker has no usable categories.** Close when: Select real seeded expense category in UI, submit and verify category_id in DB/reports.
- **NEW-19 (P1) — Tag merge fails UUID/text contract.** Close when: Merge200; links/counts correct; rollback on fault; no foreign household target accepted.
- **NEW-27 (P2) — First household lacks category setup guidance.** Close when: Default categories seeded once or explicit setup offered before dependent entry; retry does not duplicate.
- **NEW-36 (P2) — Archive filters and normalization do not match UI promises.** Close when: Archive filters respected; names normalized per household; invalid rule actions rejected; counts and ordering match persisted rows.

## R12 — FX ownership and reconciled reports

- **FIN-18 (P1) — Annual Dashboard monthly trends misparse the API's month label and lose grouped values.** Close when: API/chart date contract explicit; monthly/quarter grouping and all series retain independently expected values.
- **NEW-02 (P0) — Ratios and debt skip FX and visibility.** Close when: USD75 at26.50 contributes1987.50; private balances excluded; missing pair returns explicit incomplete/error.
- **NEW-06 (P1) — Card purchase missing from expense and savings definitions.** Close when: Card purchase counts as expense once; debt principal repayment is transfer; income-expenses equals cashflow savings.
- **NEW-13 (P0) — Global FX and securities writable across households.** Close when: Member cannot write global source; household override never changes another household's valuations.
- **NEW-14 (P1) — Split rows omitted from reports and exports.** Close when: Parent100 with children60+40 yields100 in all readers and reconstructable CSV, never0 or200.
- **NEW-15 (P1) — Clock and local-period boundaries disagree.** Close when: Date-only stays entered day; event instant renders same across views; UTC server/Lusaka month and tax-year boundary correct. Goal forecasts use calendar months/local today, completed remaining time zero, and recurring due date is household-local.
- **NEW-34 (P1) — Secondary report totals, averages and history not reconciled.** Close when: Missing FX explicit; penny-level totals foot; Unassigned bucket present; elapsed-month mean; snapshot/history completeness shown.

## R13 — Investment, pension and GRZ lifecycle

- **FIN-10 (P1) — buy/sell updates quantity but leaves the portfolio's cost basis unchanged.** Close when: Two buys at same price update remaining cost basis and produce zero invented gain; partial sale updates FIFO remainder.
- **FIN-11 (P1) — automated investment purchases cannot complete the later sell journey.** Close when: Automated/opening purchase produces valid lots or reviewed opening provenance; later sell works and consumes correct basis.
- **FIN-12 (P1) — investment schedules miss overdue executions and drift past month-end.** Close when: Investment overdue item runs under catch-up once;31st anchor returns after short month; paused/end-date items respected.
- **FIN-14 (P1) — missing portfolio FX returns a successful but understated net worth.** Close when: Missing holding valuation/FX is explicit incomplete/error; no successful understated total or dropped component.
- **NEW-03 (P0) — GRZ principal incorrectly classified as income.** Close when: Settlement retires asset and credits/link-matches cash once; principal never ordinary income; no duplicated acquisition debit.
- **NEW-04 (P0) — Disposed bonds still allow future payments.** Close when: Sold/matured bond rejects stale scheduled payment with409; no new cash row; settlement date/destination validated.
- **NEW-20 (P1) — Negative sale creates phantom holding quantity.** Close when: Sell quantity strictly positive and within locked holding; invalid input400; no lot or balance change.
- **NEW-21 (P1) — Investment stored base-currency amounts omit posted FX.** Close when: 180USD at20 records3600ZMW with rate/date provenance; missing rate fails closed.
- **NEW-22 (P1) — Tax reporting omits withholding/income or duplicates year boundary.** Close when: Approved-rate coupon gross/withholding/net reconcile to report/export; Dec31 counted in one declared tax year.
- **NEW-23 (P1) — GRZ validation and zero-interest maturity fail.** Close when: Negative face/rate14/invalid dates rejected; zero-interest maturity succeeds; day-count/fees/conventions versioned; SQL not returned. Persisted precision must reproduce coupon schedule; calculator and stored instrument share day-count and tenor/date validation.
- **NEW-24 (P1) — Pension totals and contribution lifecycle lack validation/audit.** Close when: Employee plus employer equals total, positive bounds, correction/audit and cash effect explicit. Contribution update and audit are atomic under lock, including concurrent updates.
- **NEW-25 (P1) — GRZ, tax and pension UI inaccessible without equity holdings.** Close when: Bond-only and empty-equity user reaches each tab and real tax link; no vacuous fixture skip.

## R14 — Durable recurring and scheduled jobs

- **OPS-003 (P1) — Automatic financial processing is not fully wired or operationally evidenced.** Close when: Each registry job has a deployed trigger and observed due execution; dormant outbox/receipt worker promises completed.
- **OPS-013 (P1) — Coordination uses expiring/evictable Redis keys without durable run identity.** Close when: Two workers/restart/lease expiry cannot duplicate due financial effects; DB identity and fencing survive cache eviction.
- **NEW-10 (P1) — Recurring UI omits required payload fields.** Close when: Frequency and due date submitted; valid rule201 and scheduled effect; validation shown inline.
- **NEW-30 (P1) — Recurring anchor, catch-up and future execution inconsistent.** Close when: Monthly anchor retained after short month; bounded overdue runs keyed by period; member cannot advance clock.

## R15 — Durable receipts and OCR

- **OPS-001 (P1) — Uploaded files have no declared durable deployment storage.** Close when: Uploaded objects survive restart/redeploy and backup restore; manifest proves legacy migration without loss.
- **OPS-004 (P1) — Receipt OCR conflicts with production Content Security Policy.** Close when: OCR upload/worker/recognition works under actual production CSP with pinned assets.
- **NEW-18 (P0) — Receipt conversion duplicates or reverses ledger effect.** Close when: Concurrent/replayed conversion yields one positive expense; negative or zero request rejected before mutation.

## R16 — Notifications, push and weekly recap

- **OPS-008 (P0) — Push subscription accepts an arbitrary outbound HTTPS destination.** Close when: Unknown/private/loopback push destination rejected before dispatch; known allowed service succeeds through controlled test.
- **OPS-006 (P1) — Recap can publish false zero values and incorrect currency labels.** Close when: Missing FX produces incomplete state not zero; household currency rendered accurately.
- **OPS-009 (P1) — User-controlled names are interpolated directly into notification emails.** Close when: Hostile names rendered as escaped text in every email template without executable markup injection.
- **OPS-010 (P1) — Notification delivery status and deduplication do not reflect channel outcomes.** Close when: Per-channel success/failure/unknown/suppressed states and dedupe preserve truthful retry outcomes. Missing VAPID gives not-configured outcome; quiet-hours UI persists; cron counts reflect actual new outcomes after dedupe.
- **OPS-007 (P2) — Saved recap content preferences do not govern generated content.** Close when: Saved includeGoals/includeRecurring controls affect generated content without resetting unrelated settings.
- **NEW-31 (P1) — Recap period snapshots/settings overwrite one another.** Close when: Seven-day interval; independent settings PATCH; historical net worth snapshot remains historical. Recap feedback persists queryable structured record with replay handling.
- **NEW-38 (P2) — Security notices and notification noise inconsistent.** Close when: Credential changes generate sanitized security event and notice; routine login notifications respect preferences; live session timestamps truthful.

## R17 — Thandi Claude primary and Gemini fallback

- **OPS-012 (P1) — AI privacy/cost controls need precise boundaries before provider enablement.** Close when: Complete THANDI_SPEC: both consent and spend controls; correct provenance; Claude->eligible Gemini->local; no evasion of limits. Quota policy headers match allowance; dataWindow reflects actual query; local prompt estimates are not provider token usage.

## R18 — Complete UX, accessibility and date display

- **UX-02 (P1) — small-screen layout prevents core transaction use.** Close when: Core flows usable at320px and200%zoom on recorded devices; navigation never covers inaccessible content.
- **NEW-37 (P2) — Visible controls, attribution and validation remain inert or misleading.** Close when: Transfer direction clear; wizard announces error; copy/reset/radio/navigation works; greetings accurate; accessibility checks complete. Session/history response envelopes match canonical success/data contract. Authorized delete/archive/correction UI exists for individual transactions, budgets, goals and holdings under their lifecycle guards; filter presets can be created and deleted.

## R19 — Deployable operations, storage and recovery

- **OPS-002 (P1) — Release health can stay green while required Redis is unavailable.** Close when: Configured required Redis outage gives bounded unhealthy response, not cache-stats success.
- **OPS-014 (P1) — Job outcomes and errors are lost by the structured logger.** Close when: Structured log retains sanitized request/job/provider/error context and produces actionable failures.
- **OPS-015 (P1) — Database certificate verification remains an unfinished release gate.** Close when: Valid CA verified; invalid certificate rejected; staging/production explicitly configured.
- **QA-02 (P1) — operational evidence is incomplete.** Close when: Exact-candidate staging/provider/job/load/restore/rollback/device/UAT evidence exists; missing proofs remain blockers.

## R20 — Trustworthy automated and runtime verification

- **OPS-011 (P1) — Local browser suites can mutate the wrong environment and bypass production protections.** Close when: Root/server/browser commands refuse real/unknown target and arbitrary reused server; protected runtime uses actual defenses.
- **QA-01 (P1) — green browser tests do not establish completed business journeys.** Close when: Every required browser test submits, asserts persisted result and fails for absent required controls; no vacuous conditional pass.

## R21 — Integrated acceptance and controlled release

Cross-cutting packet: supports the relevant register rows and closes its own ACCEPTANCE gate; a lack of primary defect rows does not mean no implementation work.
