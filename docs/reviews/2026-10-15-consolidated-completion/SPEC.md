# Final full-application completion specification

Version 1.0, 15 October 2026. Baseline application revision: `381e9439afabe7c6cf829cb1cbded91d36da44ee`. Status: **specified, not implemented**. This consolidation authorizes documentation only. Future implementation requires the user's instruction to start.

## 1. Authority and finite scope

This package governs future completion work and resolves conflicting recommendations in the two source assessments. Read README, this specification, THANDI_SPEC, ACCEPTANCE and the remediation plan together. The historical assessments retain evidentiary value but their pilot deferrals, provider-choice alternatives, unqualified readiness claims and incompatible implementation suggestions are superseded.

Finish every existing advertised capability: identity/recovery, all offered roles, households/shared views, accounts/ledger/transfers/splits, imports/exports, organization/rules, budgets/goals, recurring, investments/GRZ/pension/tax reporting, reports, receipts/OCR, notifications/recap/push, Thandi, settings/MFA/data exit, accessibility and operations. Temporary containment is allowed during implementation; disabling a capability never closes its completion requirement. Remove fictional paid-plan claims; no billing system is introduced.

Bank connections, PWA/offline editing, automatic goal funding, new PDF products, subscriptions, multilingual support, a wholesale redesign and additional AI financial actions are optional enhancements outside this estimate. Existing failure states must still explain offline/unavailable behavior.

The 101 register rows are grouped closure requirements, not 101 independently reproduced bugs. Preserve original IDs; shared findings are cross-referenced, not counted twice simply because both audits found them. All rows are OPEN until their acceptance evidence exists. Priority orders work; even lower-priority defects in promised behavior remain required for full completion.

## 2. Resolved decisions

| Decision | Governing requirement | Basis |
|---|---|---|
| Scope/date | Full product, no November deadline, staging throughout | Explicit owner instruction |
| Thandi | Direct Claude primary, eligible Gemini fallback, labelled local degraded mode | Explicit owner instruction; detailed contract in THANDI_SPEC |
| Identity | Verify email before financial/household access; pending users can verify/resend/recover/logout | Consolidated engineering decision consistent with existing login policy |
| Membership | One active household per user, exactly one owner; transfer is the only owner reassignment path | Preserve current product invariant |
| Professional | Keep offered role; read-only authorized shared financial data; no elevated access to another person's private data | Least-privilege completion decision, not a claim about historical intent |
| Shared views | Persist named filters/configuration over authorized records; no implicit grants or private-data sharing | Complete advertised control without inventing new disclosure authority |
| Privacy | Private accounts and private transactions excluded from other members' results and totals by default | Close all alternate-path leaks |
| Financial effects | One common posting contract, atomic audit/outbox, explicit asset/liability semantics | Resolve inconsistent writers |
| GRZ | Preserve record-only acquisition; confirmed settlements convert holdings into cash with principal distinct from income | Resolve both audits' incomplete alternatives; details below |
| FX | Dated flow conversion; as-of valuation; household overrides scoped, global source write-protected | No 1:1 relabeling or silent missing values |
| Calendar | Date-only values stay date-only; event instants UTC; household timezone for periods and schedules | Resolve local/UTC disagreement |
| Test evidence | Unit/integration plus production-mode staging; no disabled CSRF/rates as release evidence | Original test-mode limitation is not the future contract |
| Estimate reserve | 20% once across the combined plan | Common planning policy; reforecast after G1 and G2 |

These decisions remove implementation ambiguity. External facts and operator-controlled values remain OI-01–06 below; an agent may build safe configuration and synthetic tests without inventing those values.

## 3. Permissions and privacy

Permissions are named capabilities, not an ordinal comparison of role strings. Unknown role fails closed. A database enum does not substitute for authorization.

| Capability | Owner | Admin | Member | View-only | Professional |
|---|---|---|---|---|---|
| Read authorized shared financial data | Yes | Yes | Yes | Yes | Yes |
| Read another person's private account/transaction/derived amounts | No | No | No | No | No |
| Create/edit authorized shared financial records | Yes | Yes | Yes | No | No |
| Create/edit own private financial records | Yes | Yes | Yes | No | No |
| Manage household policy, shared saved views and AI consent | Yes | Yes | No | No | No |
| Invite/remove member/view-only/Professional | Yes | Yes, cannot manage owner/admin | No | No | No |
| Grant/remove admin or transfer ownership | Yes | No | No | No | No |
| Change own profile/display/MFA; revoke own sessions; request own data exit | Yes | Yes | Yes | Yes | Yes |
| Financial/report export job; ad hoc recap generation | Yes | Yes | Yes | No | No |
| Personal privacy export | Own visible/subject data | Own visible/subject data | Own visible/subject data | Own visible/subject data | Own visible/subject data |
| Ask read-only Thandi questions under household consent | Yes | Yes | Yes | Yes | Yes |
| Modify global market/reference source | No | No | No | No | No |

Operator market jobs have separate service credentials, narrow scopes and audit. They are not a household role. Role removal/downgrade takes effect on the next protected request and invalidates pending privileged forms and outbound AI authorization.

Visibility predicate: actor is an active member of the resource household AND has the operation capability AND can view the containing account AND can view the transaction. A private account restricts all descendants regardless of a false transaction flag. A private transaction on a shared account restricts its own related rows. Neither admin nor Professional overrides privacy. Explicit transaction privacy and account privacy are distinct facts; do not backfill one from the other and thereby lose provenance.

Carry actor through goal activity, assignments, tags, recurring, attachments, export manifests/counts, reports, ratios, portfolios, AI and jobs. Hidden amount, name, existence/count and identifiers must not leak. For invisible object IDs return404; malformed IDs400; a known forbidden capability403. Do not mutate a foreign entity while resolving a supplied ID.

Household preferences and personal preferences use separate allowlists and persistence paths. An automated recap is generated for its recipient's visibility, never from an owner's unrestricted snapshot. Shared-view filters cannot widen these predicates. Ownership/private-data changes require explicit authorized operations and audit; reference backfills cannot broaden disclosure.

## 4. Identity, membership, settings and exit

Identity states: pending verification -> verified/pending MFA -> authenticated -> revoked/deleting/erased. Financial handlers reject pending verification and pending mandatory MFA, even if a session cookie exists. Registration may keep a restricted session for recovery; login must not silently promote it.

Mail links use configured public origin and actual registered routes. Verification/reset/email-change tokens are opaque, short-lived, stored hashed and consumed atomically; never treat a stored hash as the mail token. A fresh-browser verification endpoint may use a narrowly scoped token-authenticated CSRF exemption only if it performs no ambient-session-authorized mutation and cannot log the visitor in or switch their identity. Otherwise persist anonymous CSRF session state. Keep normal cookie-authorized mutations CSRF protected.

Revocation covers session store and tracking rows and a late concurrent session-save race. An erased/revoked user cannot be authenticated from a tombstone. DTOs are allowlisted by purpose; own-profile sensitive fields are distinct from general auth/member DTOs. No password hash, token material, MFA codes or recovery codes in ordinary payloads/logs.

Invitation acceptance requires authenticated verified recipient identity, matching normalized intended address, unexpired single-use invitation and household capacity rules. Serialize create/accept for the actor and ownership transitions for the household; keep lock order deterministic. Invite URLs contain the token only in the recipient mail, not ordinary invite API responses. Resend rotates/revokes old tokens. Final owner cannot leave/remove self without completed transfer or explicit household deletion.

MFA enforcement is optional by household policy, but a policy set to mandatory must work for existing sessions. Increment policy version and restrict noncompliant sessions to enrollment/recovery; privileged operations require recent step-up. Preserve current financial step-up until any replacement threshold is configured and verified. Thresholds use household currency and fail closed on missing/stale FX.

All displayed profile/contact/financial fields have typed allowlists, ownership, null-clearing, validation, persistence and minimization/retention decisions. Personal theme/locale/timezone/widget preferences do not alter household policy. Saved shared views have household identity, name, filters and explicit owner/admin edit rights; they do not share private data. Entitlement displays reflect real memberships/roles and actual limits, not a fictional subscription.

Export jobs have durable states queued/running/ready/failed/expired, requester identity, schema version, scoped row counts, storage manifest/checksum and expiry. Downloads reauthorize current access. Erasure has durable requested/revoking/purging/completed/failed states and replay-safe file cleanup. Revoke identity before background purge; block new mutations during deletion. Keep legitimate remaining-household records with pseudonymous attribution and approved retention; do not delete the entire household's audit history on one member's exit. Backup restores reapply erasure markers before serving traffic. OI-04 supplies retention/legal constraints; this spec does not assert legal compliance or invent durations.

MFA enrollment requires recent step-up and proof of possession of the factor channel. Creating a challenge does not immediately set mfaEnabled=true. Issue/activate recovery codes only after enrollment proof succeeds; replacing a factor must not strand the user's recovery path. Notification preference partial updates preserve omitted thresholds; explicit null clears them, and notificationType is an allowlisted enum. Security/session endpoints use the application's canonical success/data envelope.

## 5. Monetary and mutation invariants

Use the existing Money/Decimal utilities and decimal-string DTOs. Never use binary floating-point for financial calculations. Source currency is immutable and derived from the locked account at posting, not a display preference. Existing nulls may be backfilled only when account denomination history makes the currency unambiguous; uncertain rows go to a reconciliation report.

Define canonical account effects independently of transaction labels:

- Asset balance = opening asset amount + asset increases - asset decreases.
- Liability balance = positive amount owed; a purchase/borrow increases owed, repayment reduces it. Do not hide inconsistent signs with abs().
- Expense on a credit account is expense, not debt paid. Repayment from checking to credit reduces cash and liability; it is not a second purchase expense.
- A transfer has one operation identity, both account legs/currencies, explicit conversion rate and any fee. Lock accounts in stable ID order. Reject operations that would strand a leg.
- A split parent counts once; child allocations exactly equal its amount. Replacing amount/category/account/currency revalidates all dependencies atomically. Rounding residual assigned deterministically and visible.
- Refunds explicitly reference/reverse the original economic category; distinguish negative expense presentation from invalid negative input. Planned/pending items are excluded from posted balances and actual reports unless the view explicitly includes and labels them.
- Preserve amount/date/type/account/version for optimistic conflict detection. A stale edit returns409 instead of overwriting intervening work.

Mutation order: authenticate/capability -> validate references -> idempotency/fingerprint -> begin DB transaction -> lock actor/resource/account/dependencies in documented order -> recheck state -> calculate exact old/new effects -> write ledger/splits/links/lots/balances/audit/outbox -> commit -> invalidate/revalidate cache -> publish outcome. Never perform external provider/email calls inside the financial DB transaction. Failure before commit changes no financial or audit state; external delivery retries use outbox identity.

Freeze account currency, asset/liability type and opening balance after activity. Corrections use an explicit adjustment/reconciliation workflow with preview and audit, not editing history underneath balances. Preserve imported history and producer provenance. Report incomplete legacy state rather than blindly replaying untrusted rows.

Goal progress sources are typed: manual progress-only contribution, linked posted transaction allocation, assigned-account balance or real transfer. A goal cannot count the same money from multiple source modes. Link amounts use dated FX and stored allocation provenance; exact unlink/edit/delete reversal restores previous progress without clamping. Correct mistaken contributions through a reversible audited action. Overfunding may be deliberate but requires an explicit warning/confirmation; reject malformed/nonpositive/nonfinite/out-of-range monetary values.

## 6. Imports, organization and planning

Both global and account-detail import entrances share parsing, identity, balance and audit contracts. Preview shows chosen date format/timezone, mapping including Notes, account/currency, row-level validation, duplicate candidates and expected effects. Impossible dates rejected; ambiguous formats require explicit choice. Supported dates are validated against documented product bounds, not a parser's rollover behavior.

Import identity is not date+type+amount, even with description added: two identical legitimate purchases can occur. Use provider reference if supplied; otherwise normalized file/batch fingerprint plus row ordinal and occurrence identity scoped to account/mapping version. Exact batch replay is idempotent. A different overlapping file presents duplicate candidates for explicit resolution. Changed content under the same idempotency key returns409.

Overwrite previews exact affected rows and versions. Default reject any set intersecting a paired transfer and list the conflict; allow completion through a user-reviewed pair-preserving exclusion/operation. Never delete one leg. Replace/update within one transaction and adjust both affected balances when applicable; soft-delete followed by dedupe-skipping replacements is forbidden. Persist import history and honest created/updated/skipped/rejected counts. Do not count deliberate duplicate rows as invalid merely because values match.

Rules have a pure planner returning validated proposed effects and a separate executor. Dry-run can read but cannot write tags/counts/aliases/splits/audit-financial events. Reference membership checked on create/update AND execution; invalid legacy rules quarantined and explained. Amount splits sum to parent; percent splits sum100. Rule application shares the normal writer and transaction/audit contract; apply-to-past errors are itemized and never reported as unqualified success.

Category groups/archive state, tag normalization/scoped uniqueness, merchant aliases/logos/detail/merge/undo, usage counts and default filter presets match UI behavior. Counter changes derive from actual affected rows, not attempted operations or stale snapshots. Group archive either atomically archives valid descendants with preview or blocks with an explanation; no silently visible archived child.

Budgets use posted authorized spend including splits/refunds and dated FX. Historical suggestion uses sum divided by included elapsed periods, includes legitimate zero months, excludes future months, and previews before overwriting manual budgets. Rollover enabled state persists in household policy; next-period carry is created once under unique period identity. Batch audit identity is a UUID with affected IDs in structured metadata.

Partial goal-account assignment defaults must form a valid request: explicitly distinguish fixed allocation from automatic full-balance tracking instead of defaulting to an invalid combination. Goal forecasts use calendar-month boundaries and household-local today, with zero remaining time for a completed goal; do not approximate months as30 days. Reject a move from a budget to itself without a spurious transfer audit.

## 7. Reports, FX and calendar

Global provider FX/securities are service-written/read-only to households. Owner/admin may create household-local overrides with immutable actor/source/pair/as-of timestamp, exact precision and precedence; members cannot mutate global data. Do not assign legacy global manual rows to a household without provenance.

Flow conversion uses the most recent approved rate on or before transaction date within configured validity. Balance valuation uses the selected report's as-of rate, not each historical entry rate. Preserve source currency and rate metadata. Missing/stale rate never means1.0, zero, or dropping a holding. Required complete monetary operation returns a typed422 missing-rate result; optional analytical display may return explicit complete=false with missing components and no misleading total. Financial writes needing conversion fail before mutation.

For equal actor/filter/period and economic definition, transaction list/summary, dashboard, budgets, cashflow, ratios, annual reports, category buckets, Sankey and CSV reconcile. Include Uncategorized and Unassigned buckets. Split children replace, not supplement, parent category contribution. Card spend and debt repayments remain distinct. Aggregate using high-precision decimals and define rounding at output; displayed buckets must foot with explicit residual policy.

Date-only fields are YYYY-MM-DD, never local-midnight strings passed through UTC conversion. Events store UTC instants; the same instant renders consistently. Internal intervals are half-open [start,nextStart); preserve/translate existing inclusive API endDate deliberately. User/household timezone controls local days, weeks, tax years and scheduling. Week is exactly seven local dates. Store monthly anchor day separately:31 Aug ->30 Sep ->31 Oct. Future schedule dates do not prematurely post actual financial effects.

Cache keys include household, actor/visibility revision, period, currency and policy version. Commit triggers all affected server/client invalidation; use revision tokens or revalidation to prevent stale financial reads if invalidation delivery fails. Other members' writes become visible by bounded refetch/invalidation, not staleTime Infinity. History is reconstructed from supported immutable events or labelled snapshot-only/incomplete; never populate old weeks with current net worth.

## 8. Investments, GRZ and pension

All buys, opening holdings and automated contributions create or reconcile valid lot/basis provenance. Positive quantities only; sells lock holding/lots and cannot oversell. FIFO disposal has quantity, basis, fees, proceeds, source/base currency and dated FX. Portfolio cost basis changes with remaining lots. Pension records validate employee+employer totals, date, correction and whether cash was actually moved.

**Acquisition and settlement are separate.** Existing GRZ creation records an already-owned instrument and does not debit a linked cash account. UI states that opening cash must already reflect any external purchase, or the user must link/record a separate actual purchase; neither is silently inferred.

A confirmed sale/maturity cash receipt is an asset-to-cash settlement, not ordinary income for the full face amount. In one operation: lock holding and payment/disposal, validate state/date/entitlement, link an existing matching receipt or post one explicit asset-settlement cash leg, retire the corresponding holding value, record return of principal, realized basis difference and fees separately, then audit. Prevent duplicate import/manual settlement linkage using unique instrument/event identity. If receipt cannot be established, retain pending settlement with no fabricated cash posting.

Example with controlled synthetic valuations: face1000, acquisition cost950, carrying/as-of value1000; principal settlement1000 moves1000 from the holding to cash with zero change in aggregate net worth and zero ordinary income. Realized gain50 is classified separately from principal according to the approved reporting policy; it is not a second cash receipt. If prior carrying value was950, the50 valuation/realization difference must be explained, not hidden or counted twice. Coupon100 with an approved synthetic test withholding15 posts net85 and records gross100/withheld15; that test rate is not a claim about current law.

State machine: active -> sold or matured, with durable settlement state. Scheduled unpaid coupons/principal after disposal are cancelled/unpayable. A genuine late external entitlement needs a distinct reviewed adjustment with provenance, not reuse of stale scheduled pay. Sell/pay races lock the holding consistently and cannot both consume the same entitlement. Validate due date/destination and money range before posting. Receipt may go to another authorized compatible-currency account through explicit selection; do not require a fictional brokerage execution.

Zero-interest maturity is valid; negative discount, malformed rate, maturity before purchase and unsupported tenor are rejected. Rates are decimal fractions with UI units explicit. Day-count, compounding, fees, withholding and tax-year policy are versioned. OI-03 supplies verified current conventions; no hardcoded yield or tax assumption may be promoted to a real-user default. Missing live rollover terms block automatic reinvestment and create an actionable pending item, never invent a yield.

## 9. Jobs, files and outbound

Use externally scheduled authenticated triggers against the declared deployment, backed by a durable job-run/due-item ledger. Process-local timers are not sole evidence. Identity includes job, household/resource and due period; unique constraints guard financial effects. Claim lease with fencing generation, renew while working, reject stale completion, and retry with bounded backoff. A lease is coordination, not proof an external send never happened. Store unknown delivery outcomes honestly.

Registry covers recurring, rollover/alerts, goal dates, snapshots, FX/market refresh, investments/GRZ maturity, outbox, receipt matching/retry, recap and cleanup. Pause/end-date/catch-up have deterministic policy. Catch up at most100 due items per invocation, checkpoint and reschedule remaining backlog; do not skip periods. Members cannot force future asOfDate. Expose last due, last success, lag, attempt, error class and owner.

Default deployment design: existing declared Render application/PostgreSQL/Redis with durable S3-compatible object storage and external scheduler. This is a configuration design, not provisioning authorization. OI-01 confirms actual account/endpoints. Redis is cache/coordination; PostgreSQL is financial/job/AI admission authority.

Files have opaque storage key, household/requester, checksum, media type, size and lifecycle state. Never expose absolute server paths. Authenticated downloads revalidate visibility. Move historical tracked/flat files only with a manifest, checksum verification and rollback; do not delete real data as cleanup. OCR workers/assets are pinned/self-hosted under production CSP. Receipt scan is a proposal until reviewed; conversion to a transaction locks receipt and returns the existing result on identical replay,409 on conflicting retry.

Notifications have independent channel outcomes pending/sent/failed/unknown/suppressed and unique event+recipient+channel identity. Honor consent/preferences/quiet hours; retry without duplicating confirmed delivery. HTML-escape user strings. Validate push service origin and DNS/IP, prohibit credentials/nonstandard ports/private/loopback destinations, bound connections and redirects. Use controlled mocks/local permitted endpoints for egress tests, not probes of real internal infrastructure.

Expose quiet-hours configuration for the existing delivery behavior using the user_quiet_hours model, with timezone and cross-midnight validation. Weekly-recap feedback must persist structured, queryable feedback with subject/requester identity and replay handling; a logger line alone cannot satisfy recorded=true. Missing VAPID configuration produces a truthful unavailable/not-configured state, not an internal-error500. Job notification counters count actual newly created/delivered outcomes, not attempted sends suppressed by dedupe.

## 10. Migration and API contracts

New schema names below are design targets, not claims that tables exist. Reuse equivalent existing tables after inspection; record any mapping in the packet evidence.

| Data contract | Required identity/state/constraints | Packet |
|---|---|---|
| Membership and session revocation | Active user membership uniqueness; exactly-one-owner transition guard; revocation/policy generation when needed | R01/R03 |
| Saved preferences/views | User or household owner scope, version, validated filter schema; no embedded arbitrary SQL | R05 |
| Export/erasure jobs | Requester/subject, immutable request key, state, manifest, retention/expiry, errors, tombstone replay marker | R07 |
| Import batches/rows | Account, normalized fingerprint, mapping version, ordinal/reference, outcome and linked ledger IDs | R09 |
| FX/security overrides | Household scope, provider/manual provenance, pair/instrument, effective date, unique scoped identity | R12 |
| Instrument settlements | Holding/event identity, linked cash entry, basis/fees, policy version, state and audit | R13 |
| Job runs | Unique due identity, fencing generation, lease, attempt, outcome, last success | R14 |
| Storage/delivery manifests | Scoped object/delivery identity, checksum/status, retry and deletion state | R15/R16 |
| AI requests/attempts/budgets | Durable request fingerprint, provider/stage claims, period liabilities, reservations and replay-safe settlement | R17; THANDI_SPEC |

All financial mutations support operation idempotency and conflict detection. Reuse the same request key and fingerprint for identical replay; same key with changed payload409. Standard outcomes:400 malformed input,401 unauthenticated/revoked,403 known forbidden operation,404 invisible object,409 state/version conflict,422 missing required financial data,429 application limit,503 unavailable dependency. A degraded analytical result is200 only with truthful complete/degraded/provenance flags, never false success.

Migrations follow expand -> validate/report -> bounded backfill -> verify -> constrain -> contract in a later compatible release. Test empty and populated upgrades, rollback compatibility and restore. Account histories, memberships, FX ownership, private flags and old GRZ settlements may be ambiguous; do not auto-repair by guessing. Record counts/checksums/exceptions, retain before values, and require reviewed resolution for real data.

## 11. Operational inputs remaining

Unknown /api routes must return the canonical JSON404 before the SPA catch-all. Unsupported version aliases must be documented as unsupported and return404 rather than HTML200 or a no-op; any retained advertised alias needs real handler/guard parity. Complete authorized individual delete/archive/correction controls for transactions, budgets, goals and holdings and create/delete for filter presets. Destructive controls obey the lifecycle contracts: posted holdings require disposal or a reviewed correction, not a button that erases settled cash history.

| ID | Actual input needed | Blocks | Safe progress without it |
|---|---|---|---|
| OI-01 | Hosting accounts, staging/live origins, DB/Redis/object storage/cron/SMTP/VAPID credentials and named operator | External staging/prod verification | Local synthetic implementation and manifests |
| OI-02 | Claude/Gemini keys, allowed model IDs, per-app/household/user/provider monetary caps, period timezone, pricing versions and small staging budget | Paid calls; not provider-order implementation | Deterministic mocks, zero-paid admission by default |
| OI-03 | Qualified/current source for tax/WHT/day-count/reporting conventions and approved model version | Real tax-labelled output and automated real-money GRZ assumptions | Synthetic explicitly labelled policies and structural lifecycle tests |
| OI-04 | Retention/privacy wording, legal holds, sensitive-field necessity and backup deletion policy | Real-user export/erasure policy release | Synthetic end-to-end lifecycle |
| OI-05 | Named implementation/review/UAT/operations owners and actual capacity | Calendar commitment and release sign-off | Packet work queue and handoff |
| OI-06 | Explicit production deployment/rollout authorization after candidate evidence | Production mutation and invitations | Staging/UAT preparation within separate authorization |

No missing input permits an unlimited AI budget, guessed tax rate, fake provider success or erased retained-data obligation. Request an input only when its dependent action is concrete; continue independent authorized work.

## 12. Completion and evidence

Close a register row only with implementation SHA, regression path/result, runtime target/mode, independent DB/file/provider read-back where applicable, negative/race/retry case and review disposition. Use OPEN -> IMPLEMENTED -> LOCALLY_VERIFIED -> STAGING_VERIFIED -> CLOSED; code merged alone does not close readiness. A source hypothesis disproved by an exact bounded test is REFUTED with evidence, never silently dropped.

All22 packets and J01–J16 must pass. Proposed release operating targets: ordinary API p95<=500ms and primary interaction<=3s on a recorded device/network at100 active users across20 synthetic households; restore RPO<=24h/RTO<=4h;14-day candidate soak with no unresolved P0/P1, followed by controlled production72h observation. These are acceptance targets, not current measurements or an SLA.

Test at exact candidate SHA on production-mode staging with valid HTTPS, cookies/CSRF/CSP/rates, Redis, durable files and UTC host/Lusaka users. Real providers use only authorized synthetic samples and bounded costs. Re-run affected evidence after fixes or config/schema changes; reset soak for release-blocking regressions. Owner UAT and deployment authorization remain separate from technical verification.
