# Capital Full-Application Completion Specification and Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task once the user separately authorizes application implementation.

**Goal:** Complete every existing advertised Capital workflow from registration through household exit and verified operation, including Claude-primary/Gemini-fallback Thandi, with one consistent agent-executable specification.

**Architecture:** Retain the current modular React/Express application, PostgreSQL financial authority and Money/Decimal arithmetic. Consolidate authorization, posting, idempotency, durable jobs, storage and AI admission contracts across existing modules; use additive migrations and explicit production-mode evidence.

**Tech Stack:** TypeScript, React, Express, PostgreSQL/Drizzle, Redis, Vitest, Playwright; deployment design uses Render, external authenticated scheduling and S3-compatible object storage. Exact supported runtime/provider versions are verified during implementation.

---

**Version:** 2.6,29 October 2026. **Application baseline:** `381e9439afabe7c6cf829cb1cbded91d36da44ee`. **Status:** local implementation campaign authorized, with owner-approved Astra orchestration/final review and parallel Sol implementation; no remediation is claimed by this planning amendment; real-household launch remains NO-GO.

**Authority:** This file is the single governing completion specification. It replaces conflicting planning instructions in both October15 consolidated packages, the older completion/launch plans and all comparison/response documents. Historical assessments remain evidence, not competing implementation instructions. This document and later explicitly approved amendments govern; no agent needs earlier chats to understand required behavior.

**Referenced packet companion:** The owner has designated [FINAL_COMPLETION_SPEC.md](../reviews/2026-10-15-unified-completion-spec/FINAL_COMPLETION_SPEC.md) as the implementation companion. Use its matching R00–R21 work orders for numbered steps, baseline file/line references, named regression tests and assertions, numeric acceptance examples, and host-specific traps. Use its operating protocol and calendar projections where compatible with this master. Those details supplement execution; they do not replace this file's contracts, dependencies, canonical register, estimates or closure criteria.

**Companion use and conflict resolution:** Read the master contract and packet first, then the matching companion work order. Verify cited locations against the implementation SHA; a named test or historical line reference is not evidence of a current passing test. Carry compatible companion checks into packet acceptance. Map companion register entries to the canonical groups and retain detailed subchecks; do not sum the 110 companion rows and 101 master groups, create a second status authority, or silently discard an unmatched requirement. Record unmatched details for explicit reconciliation before claiming the affected packet complete. In a conflict, this master wins: in particular selected-device session revocation, Thandi failover/funding controls, storage baseline and packet dependencies. Record the discrepancy and apply the governing contract rather than asking the owner to re-decide settled behavior.

**Defaults and calendar ergonomics:** Agents may build isolated synthetic fixtures and configurable policy interfaces against clearly labelled companion proposals while OI inputs remain pending. Record each assumed value, its source, intended environment and replacement gate. Unconfirmed tax, retention, spending or other real-user policy values must not become enabled production defaults. Compatible engineering defaults can be used within an authorized packet. The companion's dated calendar is an illustrative scenario based on its stated start date, capacity and alternative effort range, not the governing estimate or a launch commitment; rebase it against this master's effort, actual start, dependencies and measured throughput before scheduling. Missing policy facts block their dependent enablement, not independent implementation.

**Version 2.1 amendment:** Owner-requested authority/companion relationship and agent reading path clarified; applies across R00–R21 and their existing register/J/AI checks. No scope, estimate, application behavior or implementation authorization change. Existing security, data and real-world enablement gates remain in force.

**Version 2.3 model amendment:** On15 October2026 the owner approved continuing with Sol Extra High and asked the coordinator to identify when a switch to Astra is needed. Sol may coordinate and integrate bounded dependency-ready implementation under settled contracts. Before new shared architecture/security contracts, unresolved privacy or financial-policy adjudication, or release-readiness decisions, notify the owner to switch this chat to Astra Extra High, naming the decision and current evidence checkpoint. Keep dependent decisions pending while continuing independent authorized preparation. This supersedes earlier Astra-only coordinator wording for ongoing routine work; the original authorization and model history below remain historical provenance. See section8 for the operative roles.

**Current authorization:** On 15 October 2026 the owner requested an agent-aware plan and a separate Astra implementation session with Sol High/Extra High subagents. That session may implement dependency-ready R00–R21 work, edit application code, install required local development dependencies, run protected synthetic tests against verified disposable databases, and create local branches/worktrees and commits. Delegation to the stated subagents is authorized. This planning session edits documentation and dispatches that session only. Production/shared-database mutations, external provisioning, real messages/invitations, paid provider calls and deployment retain their explicit input and authorization gates. Continue independent local work when an external gate is pending; do not repeatedly request permission for already-authorized local packets.

**Version 2.4 effort amendment:** During the R02 shared auth/query checkpoint on15 October2026, the owner switched this chat to Astra and explicitly accepted High effort going forward ("ok bu going forwad high will be enough"). Astra checkpoints now use `gpt-6-astra`, `high`; earlier instructions to request Astra Extra High are superseded prospectively. Routine Sol and delegated implementer/reviewer settings are unchanged. Preserve actual historical model/effort provenance. This changes no product requirement, closure criterion, review independence or external authority. The checkpoint design is [R02 session access and query boundary](2026-10-15-r02-session-access-design.md).

## Contents

**Version 2.5 team amendment,28 October2026:** The owner approved the [four-agent execution plan](2026-10-28-r02-four-agent-execution.md) and instructed writing the plan before starting implementation. For the current R02 session-access work, Astra High occupies the coordinator/final-code-review slot; two Sol Extra High implementers own server and client respectively; one separate Sol Extra High reviewer checks both candidates before Astra's final assessment. This supersedes routine Sol coordination for this execution and permits parallel construction under the settled shared contract. Integrate server then client only after review; serialize protected DB/broad checks. Maximum four active agents, isolated author worktrees, no new user-owned chats needed. Scope,101-group closure criteria and external gates are unchanged. Record actual selected models/efforts and keep historical evidence intact.

**Version 2.6 bounded parallel-chat amendment,29 October2026:** The owner requested one additional separate Sol Extra High implementation chat for R09/FIN-15 CSV-date correctness, with progress and handoff reporting to the main coordinator (authorization relayed by side chat `01a186fd-9025-73e0-9381-161091533716`). This is one explicit addition to the existing four-agent team, not permission for nested teams or unlimited sessions. The new chat must use an isolated worktree and remain within strict calendar parsing, explicit format selection, preview/submit propagation and focused tests. Main retains orchestration, independent review scheduling, Astra High final assessment, database/native/broad-test windows and canonical integration. Tool concurrency limits still apply; the separate chat must not spawn a team. Its implementation does not close R09, bypass R08 dependencies or alter any product, privacy, financial, external-service or release requirement. Current ownership and the created chat/worktree are recorded in [CAMPAIGN.md](../reviews/completion-v2-evidence/CAMPAIGN.md).

1. [Scope, decisions and definition of complete](#authority)
2. [Product, permission, financial and lifecycle contracts](#product)
3. [Thandi: complete provider, consent and spending specification](#thandi)
4. [Canonical remaining-work register](#remaining)
5. [Delivery sequence and detailed implementation packets](#delivery)
6. [Acceptance journeys, fixtures and evidence](#acceptance)
7. [API/data contracts and migration execution](#interfaces)
8. [Operations, staffing, risk and agent handoff](#handoff)
9. [Source traceability and historical evidence](#sources)
10. [Document validation and change control](#validation)

<a id="authority"></a>
## 1. Scope, decisions and definition of complete

The user withdrew the November deadline and requested a fully functional application. An invited-household rollout is a controlled release stage, not a reduced feature specification. One month is not promised as the completion date.

**Remaining work:**101 canonical closure groups, all OPEN: **18 P0,71 P1,12 P2**, across22 packets R00–R21 and66 implementation slices. OPS-003 scheduling is promoted toP0 as agreed. Priorities order repair; every group and its detailed requirements remains required. These are grouped closure requirements, not101 independently reproduced defects. Stable IDs AH/FIN/ORG/OPS/DEP/UX/QA and NEW-01–39 retain source traceability.

**Effort:**88–145 focused developer-days at about6engineering hours/day;20% reserve once gives105.6–174, rounded up **106–174 developer-days**, approximately22–35 five-day working weeks for one developer. No provider balance, staging environment, staffing capacity or production readiness is inferred from this estimate. The14-day soak is elapsed time with monitoring effort included; external inputs may extend calendar duration. Reforecast after G1 andG2.

### Final settled choices

| Area | Governing choice |
|---|---|
| Product scope | Complete identity, household/settings/shared views/MFA/exit, all money/planning/reporting/investment workflows, organization/imports, receipts, notifications, Thandi, accessibility and operations |
| Providers | Direct Anthropic Claude primary, eligible Google Gemini fallback, useful labelled local fallback; no alternate provider evades consent, safety or budgets |
| Credits | Dated provider prices throughout; available credits are a separately reconciled funding constraint, not a zero price or permission to spend the entire balance |
| Roles | Professional/view_only read authorized shared financial data, cannot run financial/report export jobs; personal settings, permitted chat and personal privacy export retain their separate capabilities |
| Shared views | Named household saved filters, owner/admin editable, applied by authorized members; never widen visibility. Remove fictional paid-plan claims |
| Privacy | Membership AND capability AND account visibility AND transaction visibility; no derived privacy flags or unreviewed backfill |
| Imports | Account-scoped source reference or batch fingerprint/mapping version/occurrence identity; identical legitimate purchases survive; exact replay is idempotent |
| GRZ | Record-only acquisition; confirmed principal receipt links/posts exactly one asset-to-cash settlement; principal is not ordinary income; carrying value, basis and proceeds remain distinct |
| FX/goals | Global data service-written; owner/admin local overrides. Goals support deliberate confirmed overfunding with source-specific cash semantics and exact reversal |
| Durable effects | Atomic financial/audit/outbox transaction; fenced due-job identity; explicit unknown external outcome; no blind resend/refund after uncertain dispatch |
| Storage | S3-compatible durable object storage from the outset is the implementation baseline. A single-instance disk alternative requires an explicit documented amendment and equivalent acceptance, not an agent's silent substitution |
| Evidence | Protected isolated tests plus exact-candidate production-mode staging, independent monetary oracles, restore/rollback and UAT |
| Full completion | Every required group/subrequirement closed or bounded evidence-refuted; hiding an advertised capability does not close it |

The narrowed Professional policy, named shared views, storage baseline and goal semantics are consolidated engineering decisions under the full-product brief, not claims the owner previously specified every implementation detail. They are settled defaults for this version; later changes require a versioned impact assessment.

Explicitly included completion enhancements: usable quiet-hours configuration for the existing delivery capability, named shared views, category seeding, default filter application, meaningful failure states and accessible controls. Quiet-hours UI was not previously advertised; its inclusion is a deliberate scope decision, not a newly reproduced bug.

Outside this estimate: bank feeds, new automatic goal funding, offline editing/PWA, subscriptions/billing, new PDF products, multilingual support, wholesale redesign and write-capable AI. Keep these in a separately estimated enhancement backlog; do not silently add or substitute them for correctness.

### What “complete” means

A user can register and recover access, create/join a household, use every permitted role and offered feature, trust balances/reports, manage privacy and exit, and receive dependable scheduled/provider functionality. This must work through actual UI payloads, authenticated APIs, persisted data and the deployed environment. A green mock, filled form, merged PR or configuration flag alone is not completion.

Closure states: OPEN -> IMPLEMENTED -> LOCALLY_VERIFIED -> STAGING_VERIFIED -> CLOSED. REFUTED requires exact counter-evidence and retained disposition. A source claim disproved by a bounded test is not quietly deleted. Every closure requires implementation SHA, regression, target/mode, independent read-back where applicable, failure/retry/race evidence and reviewer disposition.

### Inputs remaining; no invented defaults

| Input | Required facts | Blocks | Independent work permitted once implementation is authorized |
|---|---|---|---|
| OI-01 | Hosting account/origins, DB/Redis/object storage/cron/SMTP/VAPID access, TLS and operator | External provisioning and staging/production proof | Local synthetic code, migration and infrastructure manifests |
| OI-02 | Claude/Gemini keys, allowed models, dated prices, independent numeric app/household/user/provider caps, verified credit balance/expiry, budget timezone, bounded smoke budget | Paid enablement and real provider smoke | Deterministic mocks, adapters, fail-closed admission |
| OI-03 | Qualified current tax/WHT/day-count/fee/reporting conventions | Real tax-labelled outputs and production GRZ policy | Synthetic policy fixtures and lifecycle tests |
| OI-04 | Sensitive-field necessity, retention/privacy wording, legal holds and backup deletion policy | Real-user export/erasure/privacy release | Synthetic lifecycle and retention configuration design |
| OI-05 | Astra/Sol engineering roles are assigned in section8; human UAT/operator, actual capacity and ownership still required | Calendar commitment and human release sign-off | Dependency-ready local execution by the authorized agent team |
| OI-06 | Explicit deployment and rollout authorization after candidate evidence | Production mutations and invitations | Prepared release candidate and bounded staging/UAT evidence |

15% withholding,5,000 step-up,24-hour MFA grace and historical retention assumptions are **not approved production defaults**. Use clearly synthetic parameters in tests; preserve verified existing security policy until an authorized replacement is configured. Unknown external facts block only their dependent action, not independent authorized work. No unlimited paid configuration is permitted.

### Historical findings that have evidence, and evidence limits

Both source assessments examined the baseline above. Their historical green test counts and limited arithmetic/locking checks are regression leads, not a fresh pass. Claude's14October probes documented foreign rule references, mutating dry-run paths and view-only household preference writes; preserve their fixture scope. One-leg transfer overwrite remains source-confirmed; push acceptance was observed but actual internal egress was not exploited. Actual staging/restore/provider readiness is unverified by this document.

Creation/transfer arithmetic, selected concurrent effects, scoped direct-read denials and existing conversation persistence that worked must be preserved. They do not clear broken overwrite, liability sign, split/edit, privacy or deployment paths. Do not rebuild conversations merely because old guidance called them stubs.



<a id="product"></a>
## 2. Product, permission, financial and lifecycle contracts

### Permissions and privacy

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

### Identity, membership, settings and exit

Identity states: pending verification -> verified/pending MFA -> authenticated -> revoked/deleting/erased. Financial handlers reject pending verification and pending mandatory MFA, even if a session cookie exists. Registration may keep a restricted session for recovery; login must not silently promote it.

Mail links use configured public origin and actual registered routes. Verification/reset/email-change tokens are opaque, short-lived, stored hashed and consumed atomically; never treat a stored hash as the mail token. A fresh-browser verification endpoint may use a narrowly scoped token-authenticated CSRF exemption only if it performs no ambient-session-authorized mutation and cannot log the visitor in or switch their identity. Otherwise persist anonymous CSRF session state. Keep normal cookie-authorized mutations CSRF protected.

Revocation covers session store and tracking rows and a late concurrent session-save race. Selected-device revocation uses durable session-specific state and preserves other devices; revoke-all/reset/deletion may increment a user security generation. Declare schema/session-payload changes and test delayed saves against both scopes. An erased/revoked user cannot be authenticated from a tombstone. DTOs are allowlisted by purpose; own-profile sensitive fields are distinct from general auth/member DTOs. No password hash, token material, MFA codes or recovery codes in ordinary payloads/logs.

Invitation acceptance requires authenticated verified recipient identity, matching normalized intended address, unexpired single-use invitation and household capacity rules. Serialize create/accept for the actor and ownership transitions for the household; keep lock order deterministic. Invite URLs contain the token only in the recipient mail, not ordinary invite API responses. Resend rotates/revokes old tokens. Final owner cannot leave/remove self without completed transfer or explicit household deletion.

MFA enforcement is optional by household policy, but a policy set to mandatory must work for existing sessions. Increment policy version and restrict noncompliant sessions to enrollment/recovery; privileged operations require recent step-up. Preserve current financial step-up until any replacement threshold is configured and verified. Thresholds use household currency and fail closed on missing/stale FX.

All displayed profile/contact/financial fields have typed allowlists, ownership, null-clearing, validation, persistence and minimization/retention decisions. Personal theme/locale/timezone/widget preferences do not alter household policy. Saved shared views have household identity, name, filters and explicit owner/admin edit rights; they do not share private data. Entitlement displays reflect real memberships/roles and actual limits, not a fictional subscription.

Export jobs have durable states queued/running/ready/failed/expired, requester identity, schema version, scoped row counts, storage manifest/checksum and expiry. Downloads reauthorize current access. Erasure has durable requested/revoking/purging/completed/failed states and replay-safe file cleanup. Revoke identity before background purge; block new mutations during deletion. Keep legitimate remaining-household records with pseudonymous attribution and approved retention; do not delete the entire household's audit history on one member's exit. Backup restores reapply erasure markers before serving traffic. OI-04 supplies retention/legal constraints; this spec does not assert legal compliance or invent durations.

MFA enrollment requires recent step-up and proof of possession of the factor channel. Creating a challenge does not immediately set mfaEnabled=true. Issue/activate recovery codes only after enrollment proof succeeds; replacing a factor must not strand the user's recovery path. Notification preference partial updates preserve omitted thresholds; explicit null clears them, and notificationType is an allowlisted enum. Security/session endpoints use the application's canonical success/data envelope.

### Monetary and mutation invariants

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

### Imports, organization and planning

Both global and account-detail import entrances share parsing, identity, balance and audit contracts. Preview shows chosen date format/timezone, mapping including Notes, account/currency, row-level validation, duplicate candidates and expected effects. Impossible dates rejected; ambiguous formats require explicit choice. Supported dates are validated against documented product bounds, not a parser's rollover behavior.

Import identity is not date+type+amount, even with description added: two identical legitimate purchases can occur. Use provider reference if supplied; otherwise normalized file/batch fingerprint plus row ordinal and occurrence identity scoped to account/mapping version. Exact batch replay is idempotent. A different overlapping file presents duplicate candidates for explicit resolution. Changed content under the same idempotency key returns409.

Overwrite previews exact affected rows and versions. Default reject any set intersecting a paired transfer and list the conflict; allow completion through a user-reviewed pair-preserving exclusion/operation. Never delete one leg. Replace/update within one transaction and adjust both affected balances when applicable; soft-delete followed by dedupe-skipping replacements is forbidden. Persist import history and honest created/updated/skipped/rejected counts. Do not count deliberate duplicate rows as invalid merely because values match.

Rules have a pure planner returning validated proposed effects and a separate executor. Dry-run can read but cannot write tags/counts/aliases/splits/audit-financial events. Reference membership checked on create/update AND execution; invalid legacy rules quarantined and explained. Amount splits sum to parent; percent splits sum100. Rule application shares the normal writer and transaction/audit contract; apply-to-past errors are itemized and never reported as unqualified success.

Category groups/archive state, tag normalization/scoped uniqueness, merchant aliases/logos/detail/merge/undo, usage counts and default filter presets match UI behavior. Counter changes derive from actual affected rows, not attempted operations or stale snapshots. Group archive either atomically archives valid descendants with preview or blocks with an explanation; no silently visible archived child.

Budgets use posted authorized spend including splits/refunds and dated FX. Historical suggestion uses sum divided by included elapsed periods, includes legitimate zero months, excludes future months, and previews before overwriting manual budgets. When the user confirms a suggestion for a category with no previous budget, the limit applies only to the month shown. Future months acquire no recurring default from that confirmation. Rollover enabled state persists in household policy; next-period carry is created once under unique period identity. Batch audit identity is a UUID with affected IDs in structured metadata.

Partial goal-account assignment defaults must form a valid request: explicitly distinguish fixed allocation from automatic full-balance tracking instead of defaulting to an invalid combination. Goal forecasts use calendar-month boundaries and household-local today, with zero remaining time for a completed goal; do not approximate months as30 days. Reject a move from a budget to itself without a spurious transfer audit.

### Reports, FX and calendar

Global provider FX/securities are service-written/read-only to households. Owner/admin may create household-local overrides with immutable actor/source/pair/as-of timestamp, exact precision and precedence; members cannot mutate global data. Do not assign legacy global manual rows to a household without provenance.

Flow conversion uses the most recent approved rate on or before transaction date within configured validity. Balance valuation uses the selected report's as-of rate, not each historical entry rate. Preserve source currency and rate metadata. Missing/stale rate never means1.0, zero, or dropping a holding. Required complete monetary operation returns a typed422 missing-rate result; optional analytical display may return explicit complete=false with missing components and no misleading total. Financial writes needing conversion fail before mutation.

For equal actor/filter/period and economic definition, transaction list/summary, dashboard, budgets, cashflow, ratios, annual reports, category buckets, Sankey and CSV reconcile. Include Uncategorized and Unassigned buckets. Split children replace, not supplement, parent category contribution. Card spend and debt repayments remain distinct. Aggregate using high-precision decimals and define rounding at output; displayed buckets must foot with explicit residual policy.

Date-only fields are YYYY-MM-DD, never local-midnight strings passed through UTC conversion. Events store UTC instants; the same instant renders consistently. Internal intervals are half-open [start,nextStart); preserve/translate existing inclusive API endDate deliberately. User/household timezone controls local days, weeks, tax years and scheduling. Week is exactly seven local dates. Store monthly anchor day separately:31 Aug ->30 Sep ->31 Oct. Future schedule dates do not prematurely post actual financial effects.

Cache keys include household, actor/visibility revision, period, currency and policy version. Commit triggers all affected server/client invalidation; use revision tokens or revalidation to prevent stale financial reads if invalidation delivery fails. Other members' writes become visible by bounded refetch/invalidation, not staleTime Infinity. History is reconstructed from supported immutable events or labelled snapshot-only/incomplete; never populate old weeks with current net worth.

### Investments, GRZ and pension

All buys, opening holdings and automated contributions create or reconcile valid lot/basis provenance. Positive quantities only; sells lock holding/lots and cannot oversell. FIFO disposal has quantity, basis, fees, proceeds, source/base currency and dated FX. Portfolio cost basis changes with remaining lots. Pension records validate employee+employer totals, date, correction and whether cash was actually moved.

**Acquisition and settlement are separate.** Existing GRZ creation records an already-owned instrument and does not debit a linked cash account. UI states that opening cash must already reflect any external purchase, or the user must link/record a separate actual purchase; neither is silently inferred.

A confirmed sale/maturity cash receipt is an asset-to-cash settlement, not ordinary income for the full face amount. In one operation: lock holding and payment/disposal, validate state/date/entitlement, link an existing matching receipt or post one explicit asset-settlement cash leg, retire the corresponding holding value, record return of principal, realized basis difference and fees separately, then audit. Prevent duplicate import/manual settlement linkage using unique instrument/event identity. If receipt cannot be established, retain pending settlement with no fabricated cash posting.

Example with controlled synthetic valuations: face1000, acquisition cost950, carrying/as-of value1000; principal settlement1000 moves1000 from the holding to cash with zero change in aggregate net worth and zero ordinary income. Realized gain50 is classified separately from principal according to the approved reporting policy; it is not a second cash receipt. If prior carrying value was950, the50 valuation/realization difference must be explained, not hidden or counted twice. Coupon100 with an approved synthetic test withholding15 posts net85 and records gross100/withheld15; that test rate is not a claim about current law.

State machine: active -> sold or matured, with durable settlement state. Scheduled unpaid coupons/principal after disposal are cancelled/unpayable. A genuine late external entitlement needs a distinct reviewed adjustment with provenance, not reuse of stale scheduled pay. Sell/pay races lock the holding consistently and cannot both consume the same entitlement. Validate due date/destination and money range before posting. Receipt may go to another authorized compatible-currency account through explicit selection; do not require a fictional brokerage execution.

Zero-interest maturity is valid; negative discount, malformed rate, maturity before purchase and unsupported tenor are rejected. Rates are decimal fractions with UI units explicit. Day-count, compounding, fees, withholding and tax-year policy are versioned. OI-03 supplies verified current conventions; no hardcoded yield or tax assumption may be promoted to a real-user default. Missing live rollover terms block automatic reinvestment and create an actionable pending item, never invent a yield.

### Jobs, files and outbound

Use externally scheduled authenticated triggers against the declared deployment, backed by a durable job-run/due-item ledger. Process-local timers are not sole evidence. Identity includes job, household/resource and due period; unique constraints guard financial effects. Claim lease with fencing generation, renew while working, reject stale completion, and retry with bounded backoff. A lease is coordination, not proof an external send never happened. Store unknown delivery outcomes honestly.

Registry covers recurring, rollover/alerts, goal dates, snapshots, FX/market refresh, investments/GRZ maturity, outbox, receipt matching/retry, recap and cleanup. Pause/end-date/catch-up have deterministic policy. Catch up at most100 due items per invocation, checkpoint and reschedule remaining backlog; do not skip periods. Members cannot force future asOfDate. Expose last due, last success, lag, attempt, error class and owner.

Default deployment design: existing declared Render application/PostgreSQL/Redis with durable S3-compatible object storage and external scheduler. This is a configuration design, not provisioning authorization. OI-01 confirms actual account/endpoints. Redis is cache/coordination; PostgreSQL is financial/job/AI admission authority.

Files have opaque storage key, household/requester, checksum, media type, size and lifecycle state. Never expose absolute server paths. Authenticated downloads revalidate visibility. Move historical tracked/flat files only with a manifest, checksum verification and rollback; do not delete real data as cleanup. OCR workers/assets are pinned/self-hosted under production CSP. Receipt scan is a proposal until reviewed; conversion to a transaction locks receipt and returns the existing result on identical replay,409 on conflicting retry.

Notifications have independent channel outcomes pending/sent/failed/unknown/suppressed and unique event+recipient+channel identity. Honor consent/preferences/quiet hours; retry without duplicating confirmed delivery. HTML-escape user strings. Validate push service origin and DNS/IP, prohibit credentials/nonstandard ports/private/loopback destinations, bound connections and redirects. Use controlled mocks/local permitted endpoints for egress tests, not probes of real internal infrastructure.

Expose quiet-hours configuration for the existing delivery behavior using the user_quiet_hours model, with timezone and cross-midnight validation. Weekly-recap feedback must persist structured, queryable feedback with subject/requester identity and replay handling; a logger line alone cannot satisfy recorded=true. Missing VAPID configuration produces a truthful unavailable/not-configured state, not an internal-error500. Job notification counters count actual newly created/delivered outcomes, not attempted sends suppressed by dedupe.

### Migration and API contracts

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
| AI requests/attempts/budgets | Durable request fingerprint, provider/stage claims, period liabilities, reservations and replay-safe settlement | R17; section 3 |

All financial mutations support operation idempotency and conflict detection. Reuse the same request key and fingerprint for identical replay; same key with changed payload409. Standard outcomes:400 malformed input,401 unauthenticated/revoked,403 known forbidden operation,404 invisible object,409 state/version conflict,422 missing required financial data,429 application limit,503 unavailable dependency. A degraded analytical result is200 only with truthful complete/degraded/provenance flags, never false success.

Migrations follow expand -> validate/report -> bounded backfill -> verify -> constrain -> contract in a later compatible release. Test empty and populated upgrades, rollback compatibility and restore. Account histories, memberships, FX ownership, private flags and old GRZ settlements may be ambiguous; do not auto-repair by guessing. Record counts/checksums/exceptions, retain before values, and require reviewed resolution for real data.

#### API fallthrough and individual lifecycle controls

Unknown /api routes must return the canonical JSON404 before the SPA catch-all. Unsupported version aliases must be documented as unsupported and return404 rather than HTML200 or a no-op; any retained advertised alias needs real handler/guard parity. Complete authorized individual delete/archive/correction controls for transactions, budgets, goals and holdings and create/delete for filter presets. Destructive controls obey the lifecycle contracts: posted holdings require disposal or a reviewed correction, not a button that erases settled cash history.



<a id="thandi"></a>
## 3. Thandi: complete provider, consent and spending specification

Exact provider IDs/prices/API capabilities are implementation-time checks against official documentation, not freshly verified claims in this documentation task. The initial finite bounds below are configuration targets; changes require evaluation evidence and must remain explicitly bounded.

### Required provider order

1. **Anthropic Claude is the primary provider** for understanding questions/tool selection and generating explanations.
2. **Google Gemini is the fallback provider** for eligible Claude failures, subject to consent, authorization, time and spending budgets.
3. **Existing local keyword/template fallback is the final degraded mode** if neither external provider can serve the request. It must be clearly identified as limited functionality; it is not a successful Claude/Gemini answer.

Use the direct Anthropic API so the owner's API account can fund Claude requests. Gemini uses its own Google credentials and quota/billing; Claude credits do not fund Google requests. Do not add a routing intermediary or obtain new subscriptions. Do not ask for a key in chat: implementation uses server-side environment/secrets configuration.

Recommended model class: a supported **Claude Sonnet** model for the first evaluation, with the exact ID configurable and validated against the owner's account at implementation time. Gemini's exact supported model must also be configurable. Do not carry forward the hardcoded `gemini-2.0-flash`, or silently choose a more expensive Claude model. Model selection is finalized with the same financial/privacy evaluation suite and measured latency/cost, rather than family name alone. Current IDs/capabilities must be rechecked against the [official Claude model catalogue](https://platform.claude.com/docs/en/models/overview) and [Gemini lifecycle documentation](https://ai.google.dev/gemini-api/docs/deprecations).

### Current source and intended changes

Examined code remains revision `381e9439afabe7c6cf829cb1cbded91d36da44ee`.

| Current coupling | Implementation requirement |
|---|---|
| `ai.service.ts:26,204,217,272` imports and directly calls Gemini for both stages | Introduce a provider-neutral orchestrator with Claude first and bounded Gemini failover |
| `GeminiToolCall` and Gemini-shaped history types appear outside adapter; `ai.service.ts:794` uses Gemini prompt estimation | Shared canonical tool/history/usage contracts; adapter-specific prompt/context budgeting |
| `ai.gemini.ts:27,381,688` hardcodes model, treats configured client as availability, uses a non-cancelling promise timeout | Configured model, separate configuration/health state, real cancellation/deadline handling |
| `ai.controller.ts:98` degrades only when Gemini is unconfigured | Status represents configured primary/fallback, recent outcomes and local mode; configured does not mean healthy |
| `used_gemini`/single attempted/error fields in `ai.service.ts:385–390` | Per-provider/per-stage attempt and final-response provenance; preserve compatibility without mislabeling Claude |
| `ai.fallback.ts` deliberately distinguishes provider errors from application/DB errors | Preserve that distinction; do not wrap the whole service in broad failover |
| Existing sanitizer, allowlist, argument validation, history ownership and analytics layer | Apply identically before either provider/any tool; no new model permissions |
| Consent draft describes Gemini MVP and overstates personal-data removal | Versioned disclosure names Anthropic and Google, accurately describes typed questions/history and sanitized results |

Proposed file boundaries (new files are design targets, not existing implementation):

- `server/modules/ai/ai.provider.types.ts`: canonical request/history/tool/response/usage/error contracts.
- `server/modules/ai/ai.claude.ts`: Anthropic Messages adapter using the official TypeScript SDK; bounded output, tool definitions, text-block handling, usage and cancellation.
- `server/modules/ai/ai.providers.ts`: optional provider registry/factory; stage order, failure classification and deadlines live in ai.provider-orchestrator.ts.
- Existing `ai.gemini.ts`: Gemini adapter conforming to the shared contract; configurable supported model.
- Existing service/controller/types/guardrails/tracking/cache/conversation modules: routing integration and truthful provenance/status with existing scope protections.
- Existing client `features/ai` contracts, consent/status/response components: disclose failover and local degradation without exposing secrets or raw provider errors.
- `.env.example`, environment validation, deployment configuration and operator docs: variable names and setup requirements only; no real keys.
- Existing consent draft and AI evaluation/test suites: both-processor disclosure, re-consent and complete failover matrix.

Follow repository file-size ratchets: extract cohesive pieces rather than grow the already oversized service/Gemini files. Reuse existing analytics and safety layers; do not replace them with autonomous model execution.

### Stage and response contract

Canonical history stores user and assistant text plus approved provenance. Adapters map roles into provider-specific formats. Do not pass Claude thinking/signature blocks, provider credentials, raw debug payloads or unvalidated tool calls into Gemini history. Unknown or unauthorized conversation IDs cannot contribute context.

Each adapter supports (a) question analysis/validated tool-selection candidate and (b) final explanation from sanitized tool results. The application owns tool execution, financial calculations and permission checks. Native provider tool calls are proposals, never authorization to access a household or mutate money.

| Failure point | Required result |
|---|---|
| Claude analysis fails before tools execute | Gemini may analyze the original approved question and canonical bounded history; execute only validated allowed calls |
| Claude analysis succeeds; application tool/DB/authorization/FX fails | Surface the correct application error/incomplete state; no provider failover to conceal it |
| Claude analysis and tools succeed; Claude final explanation fails | Gemini may explain the already sanitized validated results; do not rerun tools merely to switch providers |
| Gemini also fails | Use existing validated results for a truthful local template where possible; otherwise bounded local keyword selection through the same authorized tool layer |
| No useful local result | Clear unavailable/incomplete response, never invented financial numbers or a success-shaped zero |
| User cancels or overall deadline expires | Cancel outstanding work; do not start another provider or write a late second answer |

Only one final answer and one conversation exchange are persisted for one logical chat request. Record analysis and answer providers independently when they differ. Use application request/idempotency identity to prevent duplicate conversation writes and app-quota accounting on network replay; do not claim this guarantees exactly-once external provider billing after an uncertain timeout.

Do not run providers in parallel by default. Once a request switches to Gemini, its remaining stages stay on Gemini; reconsider Claude only on a later request under the recovery policy. Do not splice contradictory partial responses together. Retain non-streaming behavior initially unless a separate streaming contract is approved; any later streaming change must specify what happens after visible text has already been emitted.

### Failure and budget policy

Provider error mapping must use typed errors/status plus documented reason/header information, not catch-all exception handling. HTTP status alone is not enough to distinguish throttling from spending caps. Anthropic documents authentication, billing, request-size, rate-limit, timeout and overload errors, and SDK retries; explicitly configure retries so they do not multiply the application's fallback attempts. See [Claude API errors](https://platform.claude.com/docs/en/api/errors).

| Condition | Policy |
|---|---|
| Connection failure, bounded timeout, transient5xx/overload, transient throttling | Eligible for Gemini if consent and remaining budgets permit; no additional Claude retry by default |
| Missing/revoked primary key or inaccessible configured model | Record configuration failure and alert operator; one eligible Gemini fallback keeps service usable; release cannot call Claude configured/healthy until verified |
| Exhausted provider credits or a provider spending cap | Record billing/cap failure and alert. Default: no paid failover that circumvents a spending cap. Cross-provider spending policy must be explicit and bounded before enabling this category |
| App/household quota or total spend limit reached | No paid fallback; preserve limit outcome. Local mode only if permitted by the same product quota policy |
| Consent missing/revoked, wrong household, invalid user input, blocked injection, disallowed tool or provider safety refusal | No alternate-provider attempt to evade the decision |
| Malformed tool/output payload | Validate before use; fail safely and record protocol failure. Do not execute partial/unknown calls; do not use alternate provider to bypass a validation/safety rejection |
| Internal application, DB, sanitizer or financial-data error | Propagate the application outcome; never relabel it as provider unavailability |

Initial proposed bounds: one attempt per provider per stage, at most three paid calls for a complete two-stage request, no hidden SDK retries; 30-second overall provider-work deadline with a reserved fallback window and per-call timeouts derived from remaining time. Examples: failed Claude analysis -> Gemini analysis -> Gemini answer; or Claude analysis -> failed Claude answer -> Gemini answer. Ratify/tune these bounds with measured model latency; they are proposed configuration, not current behavior. Stop immediately when remaining budget cannot support a valid call. Use abort signals and ignore late responses; cancellation cannot promise the provider did not already incur cost.

Charge the app's daily chat quota once per logical request, not once per provider attempt. Track actual reported input/output/cache usage for **every** successful provider response plus any known usage on failed/partial attempts. Preserve unknown usage as unknown; do not zero it out or cap reported usage to make telemetry fit a budget. Reserve conservatively before calls, cap output, reconcile known usage and alert on unknown/repeated timeouts. Monetary cost accounting uses decimal arithmetic and configured, dated provider pricing.

#### Shared admission, reservation and reconciliation

Quota and spend enforcement must use a **durable shared ledger with atomic admission across all application instances**, not process-local counters or separate read-then-write checks. PostgreSQL transactions/conditional updates with a consistent lock order are the proposed mechanism; an expiring cache lock is not sufficient financial-budget authority.

- Bind the logical request/idempotency key to the authenticated actor, household and request fingerprint. An identical replay reuses the same admission/outcome; a different payload or actor cannot reuse it. Reserve the request's single chat-quota unit atomically with initial financial admission. Define failed-request quota refunds explicitly and apply them at most once.
- Before each paid call, atomically reserve its conservative maximum cost against **every applicable app, household, user and provider budget** for the relevant period. Count settled usage plus all outstanding reservations, including uncertain attempts. Permit the call only if every ceiling has capacity. Prices and output/context limits must bound all billable token classes for that configured model; if a conservative bound cannot be established, reject paid admission rather than assume zero cost.
- Claim each provider/stage attempt once in the shared ledger before dispatch, under its parent request. Concurrent workers must not dispatch the same admitted attempt independently. A denied reservation or failed ledger operation causes no outbound call. Do not hold a database transaction open across a network request.
- On known usage, reconcile the attempt idempotently: replace its reservation with actual cost and release only confirmed unused capacity. Duplicate completion, timeout or cancellation events must not refund twice, charge twice in the app ledger, or release another attempt's funds. Record and alert on actual usage exceeding the reserved estimate; do not truncate usage to hide an overrun.
- On timeout, connection loss, cancellation or crash after possible dispatch, mark the attempt **usage unknown** and retain its conservative reservation. Lease expiry, process restart and a period boundary do not turn uncertain usage into free capacity. Release or settle it only through an auditable provider-usage reconciliation or explicit operator resolution under the agreed accounting policy. Original-period liabilities remain visible; do not re-date them to erase a limit breach.
- Gemini fallback requires its **own atomic reservation** while any uncertain Claude cost remains reserved. If the remaining shared budget cannot cover both, do not make the Gemini call; return the permitted local result or a clear limit outcome. Provider-credit failover still follows the separate billing/cap policy above.

These rules bound application admission and prevent concurrency/replay from bypassing configured budgets. They do not promise exactly-once provider billing or an exact provider invoice ceiling when usage/pricing is uncertain. The operator must configure numerical limits, budget timezone/reset policy, price versions, alert thresholds and unknown-usage resolution before paid enablement; no unlimited default is acceptable.

Circuit breaking uses bounded failure thresholds/cooldowns and a controlled recovery attempt, scoped to provider/model/configuration and coordinated across instances where applicable. Claude returns to primary after a successful recovery check; no permanent silent switch to Gemini. Cancelled requests and client/consent errors do not poison provider health.

### Configuration contract

These are proposed variables; no environment or deployment file has been changed.

| Variable / configuration | Intended use |
|---|---|
| `AI_PRIMARY_PROVIDER=anthropic` | Primary routing identity |
| `AI_FALLBACK_PROVIDER=gemini` | Secondary routing identity |
| `ANTHROPIC_API_KEY` | Server-only secret associated with the owner's Claude API account |
| `ANTHROPIC_MODEL` | Explicit supported model ID, validated at controlled setup |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Server-only fallback secret and supported model |
| `AI_REQUEST_DEADLINE_MS`, provider-stage timeout limits | Shared finite deadline and fallback reservation |
| Existing request token/output/history budgets | Provider-aware context and output limits; do not enlarge silently |
| App/household spend and provider billing-fallback policy | Independent ceilings, reservation and alerts; agreed values required before real-data enablement |

Never use client-exposed `VITE_*` variables for keys. Config/status may return provider names, capability states and model identity if useful, but never secrets or sensitive account/billing diagnostics. Validate settings at startup; a valid-looking key alone is not a live readiness probe. Actual model/API access is proved separately with controlled synthetic data.

### Consent and user experience

Adding Anthropic changes the set of external processors. Version the AI consent policy and require existing households to accept the new provider disclosure before their next external AI request. Server-side enforcement must recheck consent/version before each new outbound attempt; revocation cancels queued/in-flight work where feasible and prevents additional fallback/history transmission. It cannot retract data already transmitted.

**Consent authority is household owner/admin only**, consistent with the existing admin-gated `POST /api/ai/consent` route. Owners and admins can grant, renew or revoke household AI consent. Members, view-only users and Professional users must not be offered a working household consent toggle or gain that permission through a crafted request. Their chat access remains governed by the approved role/visibility policy plus current household consent; being able to ask a question does not grant consent-management rights.

Use role-aware controls and copy: owners/admins see the actionable enable/re-consent/disable controls; other roles see consent status and “Ask a household owner or administrator to enable or disable AI processing.” An outdated disclosure blocks all external AI calls until an authorized owner/admin renews consent. No personal opt-out control is promised or introduced by this change. A future personal opt-out would require its own persisted preference, server-side outbound checks and tests.

Proposed concise disclosure (draft for product/privacy review):

> Thandi normally uses Anthropic Claude to answer your financial questions. If Claude is unavailable, Google Gemini may process the request instead. Your question, selected recent conversation messages and the financial summaries needed to answer may be sent to the provider used. Questions you type can contain personal information. A household owner or administrator can disable household AI processing in Settings.

Add the actual retention, access/deletion and applicable provider terms once verified; do not promise that all personal identifiers in typed messages are removed. Both providers receive only authorized minimized context; provider change does not justify extra data access.

Ordinary users keep one Thandi chat. A response can show “Answered using Claude”, “Answered using Gemini — backup provider”, or “Limited local summary”. On the status surface distinguish primary unavailable/fallback operating from complete outage. Technical failures and billing details go to the operator with sanitized diagnostics, not raw exceptions in a household's chat.

Audit metadata includes logical request ID, ordered provider/stage attempts, configured model, start/end/outcome/failure category, external request ID when available, known/unknown usage, consent version, whether transmission was attempted, final answer mode and data provenance. Retain failed Claude attempts even when Gemini answered; never use `used_gemini=true` for a Claude answer. Log safe metadata, not keys or expanded raw financial prompts. Existing historical rows remain valid historical evidence; use additive schema/DTO compatibility where needed.

Tool cache remains scoped to authorized user/viewer/household, arguments and data generation. Do not cache a degraded answer as a fresh primary-provider answer. If answer caching is later added, include provider/model/prompt/consent versions and actual response provenance; never allow failover to cross user or household context.

### Acceptance tests and release evidence

| Case | Required proof |
|---|---|
| Claude healthy | Claude handles both applicable stages; zero Gemini calls; answer, amounts and provenance correct |
| Claude transient analysis failure | Exactly one eligible Gemini analysis path; bounded history; no duplicate tools/exchange/quota charge |
| Claude final-stage failure | Gemini reuses sanitized tool results; no duplicated analytics/tool work; both attempts audited |
| Both providers fail or both unconfigured | Honest local limited summary or unavailable state; no fabricated totals or primary-health claim |
| Invalid primary key/model | Operator sees configuration failure; fallback behavior matches policy; no secret in response/log |
| Provider credit/spend exhaustion and app quota | No cap bypass; no unlimited retries; Gemini paid usage only under explicitly enabled bounded policy |
| Concurrent final budget unit across two instances | Two distinct requests compete for the last available quota/cost capacity; only the admissible request reserves and dispatches. Test each applicable user/household/app/provider ceiling; no overspend from read-then-write races |
| Same logical request reaches two instances | One quota admission and attempt claim; duplicate request reuses the in-progress/completed result; changed payload/actor is rejected; duplicate reconciliation cannot double charge/refund |
| Unknown Claude charge followed by fallback | Timeout/crash retains Claude reservation across restart; Gemini dispatches only if a separate atomic reservation fits the remaining limits; otherwise local/limit outcome, no paid call |
| Reservation/reconciliation failure or period rollover | Ledger failure prevents dispatch; repeated/out-of-order terminal events cannot free funds twice; unresolved original-period cost remains accounted for; operator resolution is auditable |
| Consent missing/outdated/revoked mid-request | No prohibited next provider call; re-consent UI works; revoke cancels eligible outstanding work |
| Consent controls by role | Owner and admin can grant/re-consent/revoke; member/view_only/Professional see accurate non-actionable status and crafted consent writes are denied without state changes. Role downgrade or household removal invalidates a previously open management form server-side |
| Safety/tool/validation/DB/FX failures | No fallback used to evade a safety/authorization/data error |
| Same request retried; late/cancelled completion | One persisted conversation exchange and app quota charge; late result ignored; unknown external cost retained honestly |
| Tools and history across providers | Allowed tool schema preserved; foreign/private data excluded; role conversion correct; no provider-specific reasoning blocks replayed |
| Usage and health | Actual tokens across all attempts; unknown usage distinct; finite deadline/retries; circuit opens/recovers; configured != proven healthy |
| Real staging integration | Separate synthetic smoke proves Claude, forced eligible Claude failure -> Gemini, and both-fail local mode; exact model/config/revision recorded |

Use controlled transport mocks for exhaustive failure cases and isolated fixtures for persistence/privacy. Real staging smoke uses operator-configured keys, approved synthetic messages and a small explicit test-cost budget. API-credit presence alone is not closure evidence. Repeat existing injection, sanitizer, history ownership, consent, quota, fallback and financial evaluation suites for both adapters. Full financial calculations remain deterministic application logic.

### Delivery and estimate

R17 is estimated at 5–8 focused developer-days within the consolidated 88–145-day plan, including durable admission schema, role-aware consent, adapters and controlled integration evidence. No second AI project is added. The master delivery table in section 5 governs sizing.

Implement canonical contracts and transport mocks -> durable request/attempt/reservation repository -> Claude/Gemini adapters -> orchestration and cancellation -> consent/provenance/UI -> evaluation and authorized staging smoke. R04 visibility, R05 settings, R12 financial truth and R19 environment/observability foundations are completion dependencies.

### Concrete persistence contract (new design, not existing tables)

Reuse equivalent tables only after documenting field/constraint parity. Required logical entities:

| Entity | Minimum fields and constraints |
|---|---|
| ai_requests | UUID; household_id; actor_id; client_request_key; canonical fingerprint; consent_version; status; chat_quota_state; final_response_id; created/completed timestamps. Unique household+actor+client key; conflicting fingerprint409. |
| ai_attempts | UUID; request_id; stage analysis/answer; provider/model; unique logical attempt ordinal; dispatch-claim identity; status reserved/dispatched/succeeded/failed/usage_unknown; provider_request_id; known token classes; deadline; error class. Unique request+stage+ordinal prevents duplicate worker dispatch. |
| ai_budget_reservations | attempt_id; budget_identity; original period; price/version; reserved amount; actual amount nullable; settlement version; unknown flag. Unique attempt+budget; financial amounts decimal. |
| ai_budget_accounts | app/household/user/provider scope; period/timezone; currency; ceiling; settled/reserved exposure; version. Lock all applicable accounts in stable scope/id/period order. |
| ai_consent | household; policy_version; names of both processors; granted/revoked actor and timestamps; revision. Owner/admin only; historical versions retained minimally. |

Use configured USD budget units for provider-cost admission unless a fully versioned alternative budget currency policy is implemented. Display currency conversions never change the budget ledger. Validate actual provider price classes and conservative input/output/caching bound before enabling a model.

Admission transaction: verify actor/household/capability/consent -> claim or replay request fingerprint -> lock budget accounts -> test settled+outstanding+uncertain exposure against every ceiling -> reserve chat quota and attempt cost -> commit. Then dispatch once. Do not hold DB locks during network I/O. Finalization transaction consumes attempt settlement version, updates every reservation once, appends sanitized audit outcome and final conversation result once. On ambiguous crash, do not redispatch that same attempt automatically; retain uncertainty and use the bounded recovery policy.

All unresolved possibly dispatched costs remain reserved and count conservatively against current admission capacity until reconciled, including after process restarts and budget period rollover. Retain original billing period identity; carry-forward admission exposure is not a second invoiced charge. Operator resolution records reason/evidence and cannot silently erase cost.

### Resolved app quota, local mode and audit policy

- One useful final external OR local answer consumes one app chat unit per logical request.
- A permitted local-only request reserves the same app chat unit/request identity without a paid-attempt reservation. It still requires active household AI consent and current actor visibility. Missing/revoked household consent blocks chat; outdated processor disclosure blocks external attempts until renewed. A local answer must never bypass a denied app chat quota. Monetary holds from any earlier attempted provider remain intact.
- Validation/authorization/consent rejection before admission consumes none.
- Terminal unavailable/cancelled request without a useful final result refunds the reserved app chat unit at most once. Known/unknown provider monetary charges remain separately accounted.
- Replay returns the existing state/result and neither refunds nor charges twice. Request throttles and abuse controls apply even to refunded failures.
- Quota headers, response remainingQueries and documented period must agree; distinguish per-minute transport throttles from daily chat allowance. Provenance dataWindow must reflect the actual tool query range. Local-only answers have zero actual provider tokens when no call was attempted; any prompt estimate is a separate field, never fabricated usage. Possibly dispatched attempts remain usage_unknown until resolved.
- A missing key or failed call is audited with sanitized status/provenance; do not suppress all ai_query/operational evidence merely because no answer exists. Never persist an empty assistant success message.
- Local degraded mode may reuse only authorized deterministic tool results. It cannot turn a DB/FX/privacy failure into a reassuring financial answer.
- App/household quota or global budget denial is final for paid work. No alternate provider bypasses it. Billing-cap failover is disabled by default.
- Consent is required even for paid analysis of typed text/history. Owner/admin revocation stops new attempts; pending form controls and member crafted writes never confer consent authority.

### Required new/modified file map

Existing: server/modules/ai/ai.service.ts, ai.gemini.ts, ai.fallback.ts, ai.controller.ts, ai.tracking.ts, ai.types.ts, ai.validation.ts, ai.conversation.repository.ts and client AI components.

Proposed new files:
- server/modules/ai/ai.provider.types.ts — canonical contracts.
- server/modules/ai/ai.claude.ts — direct Anthropic adapter.
- server/modules/ai/ai.provider-orchestrator.ts — bounded stage transitions.
- server/modules/ai/ai.admission.repository.ts — durable atomic budgets/claims.
- server/modules/ai/__tests__/completion-r17.realdb.integration.test.ts — cross-instance/replay/role/unknown-charge tests.
- Versioned Drizzle migration generated at implementation time; do not guess the next migration number.

Preserve or adapt existing tests for consent, sanitizer, history persistence, quota, provider fallback and evaluation. Do not infer conversation persistence is missing from stale CLAUDE.md comments: inspect current ai.conversation.repository.ts and its real-DB tests first, then repair only demonstrated gaps.

### Evaluation and evidence

Ordinary CI uses deterministic transports and a synthetic evaluation set covering financial interpretation, authorized tool selection, refusal, missing data and failure modes. It must not accidentally call paid APIs. OI-02 supplies keys/model IDs/caps and an explicit small budget before separate controlled staging smoke.

Record three independent scenarios: Claude success; forced eligible Claude transport failure followed by Gemini success; both external providers failing with an honest local result or unavailable state. Assert analysis and answer provider separately, maximum 3 paid calls, no hidden SDK retry, same-request replay, cancellation/late result, policy revocation between stages, quota race and retained unknown cost. Never use used_gemini=true as the sole success oracle for the new product.

### Required Thandi subrequirements and funding model

AI-01–AI-16 are mandatory acceptance checkpoints inside OPS-012/R17, not16 additional defect-count rows. Mark each checkpoint in the R17 evidence before closing OPS-012.

| ID | Contract | Proof |
|---|---|---|
| AI-01 | Canonical two-stage adapter/tool/history schemas; deterministic authorized tools | Both adapters preserve the same allowlist and validated results |
| AI-02 | Claude primary with configured supported model | Healthy analysis/answer uses Claude and no Gemini |
| AI-03 | Eligible stage-aware Gemini fallback, stay on Gemini for remainder | Analysis failure and answer failure tested separately; no unnecessary tool rerun |
| AI-04 | Useful local mode/no-key operation; honest unavailable when nothing useful | Active consent/quota, correct local label/audit, no invented total |
| AI-05 | Versioned Anthropic+Google household consent | Owner/admin grant/renew/revoke; every other crafted management write denied |
| AI-06 | Current role/membership/consent checked before each outbound stage | Revocation/downgrade between stages stops new transmission |
| AI-07 | Durable logical request and one final exchange | Concurrent replay one admission/result; changed fingerprint409 |
| AI-08 | Atomic app/household/user/provider budgets | Separate last-unit races for every ceiling; all reservations considered |
| AI-09 | Known settlement vs unknown possibly dispatched cost | Crash/timeout retains liability through restart/period rollover |
| AI-10 | Credit availability independent of price and authorized budget | Expiry/external consumption/reconciliation do not create free budget |
| AI-11 | Chat-quota policy independent of provider charges | Useful external/local answer consumes1; terminal no-result refund at most once |
| AI-12 | Finite deadline/call budget, cancellation and late replies | Initial30s/3calls, SDK retries0, no late second answer |
| AI-13 | Failure taxonomy and cap/safety non-bypass | No alternate provider after safety/auth/data/global-cap denial |
| AI-14 | Truthful provenance, headers, health and sanitized audit | Analysis/answer providers separate; actual vs estimated/unknown usage distinct |
| AI-15 | Portable20–30prompt deterministic evaluation pack | Independent tools/amounts/privacy/refusal cases; mocked CI |
| AI-16 | Authorized staging smoke and recovery | Claude, forced eligible Gemini, both-fail local/unavailable at recorded model/config/SHA |

**Prices and credits:** Record token classes and dated configured prices from the applicable provider tariff; a credit-funded call still has usage cost. Track provider funding availability separately with currency, available amount, observed-at time, expiry/conditions, external-consumption adjustment and reconciliation evidence. Do not equate the starting credit balance with a recurring monthly spending cap.

For a credit-limited account, admissible paid exposure is bounded by every configured scope ceiling AND conservatively reconciled unexpired funding availability less outstanding/unknown attempts. Credit refresh must account for calls made outside this app. Define a maximum balance-age policy before paid enablement; an untrustworthy/stale funding balance fails paid admission closed for that policy, rather than authorizing all reported credit. Operator funding refresh cannot release unknown attempt liabilities without evidence. Top-up or expiry changes funding, not token price from zero.

**Consent/no-key behavior:** A consented request with no usable external key may use permitted local logic under the same app quota. Without active household AI consent, do not create a conversation/ai_query success or call providers; retain only permitted minimized security/operational rejection evidence. Outdated processor disclosure blocks external calls; it does not fabricate renewed consent. No-key does not guarantee a useful answer: if validated local logic cannot answer, return a truthful unavailable/incomplete state.

**Initial deterministic reservation example (synthetic USD units, not model pricing):** ceiling0.10; settled0.04; uncertain Claude hold0.03; Gemini maximum reservation0.04 ->deny paid fallback because exposure would be0.11. A0.02 Gemini reservation fits at0.09 if all other limits/consent permit. An identical timeout event cannot release the0.03 hold; an identical replay cannot reserve a second chat unit.

**Adapter boundaries:** Use `ai.providers.ts` only for provider registry/factory/configuration if needed. Put stage orchestration in the proposed `ai.provider-orchestrator.ts`, and durable admission in `ai.admission.repository.ts`. Do not implement two competing orchestrators because older drafts named both files.


<a id="remaining"></a>
## 4. Canonical remaining-work register

All101 rows below are required and OPEN at authoring. Counts are generated from these rows:18P0,71P1,12P2. Only this register supplies the closure count; old source registers use different grouping and must not be added together. Every packet's primary/supporting obligations and all relevant J/AI subrequirements apply even when a row has a short acceptance description. Owner and reviewer are UNASSIGNED until work is claimed. Status changes require evidence in docs/reviews/completion-v2-evidence/Rxx/RESULT.md.

Source IDs and evidence confidence are preserved below. The source-report-qualified crosswalk in section9 maps Claude's detailed findings; 62 original Codex IDs remain unchanged. “Source-confirmed” is not promoted to runtime proof by consolidation. Detailed query/route/money contracts in sections2–3 and5 are mandatory acceptance extensions to each row.

### R00 — Reproducible baseline, runtime and dependencies

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| DEP-01 | P1 | OPEN | **production dependency security gate is stale** — Fresh dependency assessment and targeted fixes pass compatibility and release security gate; no blind major upgrade. | Fresh npm production audit + advisory (Codex baseline); Codex:DEP-01;Claude:F-DEP-01 |
| DEP-02 | P1 | OPEN | **runtime target requires refresh** — Supported runtime selected and pinned consistently across CI/local/deployment; implementation-time lifecycle verified. | Current manifest/CI + official lifecycle (Codex baseline); Codex:DEP-02;Claude:CI runtime parity caveat;cross-comparison section 4 |
| NEW-08 | P1 | OPEN | **Ordinary navigation and auth hit duplicated or broad limiters** — Normal shared-IP onboarding passes; deliberate brute force throttles; Redis and multi-instance rate counts correct. Uniform lockout responses avoid account enumeration.; supporting packets: R02;R19 | Claude browser+HTTP; Claude:F-SEC-04b;F-SEC-04c;SES-05;SEC-08;SEC-09;domain-security-privacy.md:SES-05;domain-security-privacy.md:SEC-08;domain-security-privacy.md:SEC-09 |
| NEW-39 | P2 | OPEN | **Schema, legacy files and admin surfaces need explicit cleanup** — Name constraints safely; scoped uniqueness migration; missing-table admin path repaired; health public fields minimized; receipt paths omitted; tracked uploads preserved in approved storage before removal.; supporting packets: R15;R19 | Claude inventory/domain source/HTTP; Claude:F-DATA-01;RCP-03;SES-04;F-OPS-02 tracked files;domain-import-receipts-organization.md:RCP-03;domain-security-privacy.md:SES-04 |

### R01 — Sessions, public DTOs and credential concurrency

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| AH-01 | P0 | OPEN | **revocation does not invalidate live cookies** — Revoked selected/all-other cookies401 including racing delayed session save; unrelated active session preserved.; supporting packets: R05 | HTTP two-cookie reproduction + source (Codex baseline); Codex:AH-01;Claude:SES-01;SES-02;domain-security-privacy.md:SES-01;domain-settings-notifications-ai.md:DEL-01 |
| AH-02 | P1 | OPEN | **ordinary user/profile responses expose authentication material** — Public auth/member/profile DTO key allowlists omit credential and inappropriate sensitive sentinel fields at real HTTP boundary. | HTTP verification-hash disclosure; populated MFA variants source only (Codex baseline); Codex:AH-02;Claude:F-AUTH-02;domain-settings-notifications-ai.md:SET-03 |
| AH-10 | P1 | OPEN | **“one-time” MFA consumption is not atomic** — Concurrent same code one winner; concurrent two distinct backup codes both remain consumed; expiry/replay fail.; supporting packets: R05 | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:AH-10;Claude:adopted or no independent counterpart |
| AH-12 | P1 | OPEN | **password changes can downgrade the registration/reset policy** — Register/reset/change share password validation and history policy; attempted downgrade rejected.; supporting packets: R06 | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:AH-12;Claude:adopted or no independent counterpart |

### R02 — Registration, verification and recovery

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| AH-03 | P1 | OPEN | **registration verification emails open an unregistered route** — Every emitted verification URL resolves to actual page and successfully consumes the raw mail token. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:AH-03;Claude:F-AUTH-01 |
| AH-04 | P1 | OPEN | **registration grants full access before verification** — Pending-verification cookie can recover/verify/logout but every financial and household route denies access. | HTTP + persisted unverified flag (Codex baseline); Codex:AH-04;Claude:F-AUTH-03 |
| UX-01 | P1 | OPEN | **first-run and anonymous data fetching produces misleading error cascades** — First-run unauthenticated/household-free UI shows correct next action without unrelated query error cascade.; supporting packets: R18 | Manual browser observation; causal repair tracing pending (Codex baseline); Codex:UX-01;Claude:F-UX-01;F-ONB-01 |
| NEW-07 | P1 | OPEN | **Fresh-browser verification fails CSRF** — Exact verification link works without registering cookie with all other mutation CSRF guards intact. | Claude fresh-cookie HTTP; Claude:F-AUTH-04;settings-domain SEC-01;domain-settings-notifications-ai.md:SEC-01 |

### R03 — Membership, ownership and Professional lifecycle

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| AH-05 | P1 | OPEN | **household collaboration is disconnected at several live boundaries** — Add-member through recipient mail acceptance works; names/role/leave/transfer controls persist real state. | HTTP missing endpoint; other variants source (Codex baseline); Codex:AH-05;Claude:F-HH-01;F-HH-03;SEC-02;domain-security-privacy.md:SEC-02;F-CLIENT-02 |
| AH-06 | P1 | OPEN | **invite acceptance lacks recipient binding and cross-household serialization** — Verified intended recipient only; concurrent two-household accepts/create yield one membership and one conflict. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:AH-06;Claude:SEC-01;domain-security-privacy.md:SEC-01 |
| AH-13 | P2 | OPEN | **visible collaboration controls make unsupported promises** — Professional and named shared-view controls work; actual memberships drive UI; fictional paid-plan claims removed.; supporting packets: R05 | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:AH-13;Claude:F-HH-02;ENH-13 |
| NEW-12 | P0 | OPEN | **Ownership operations can orphan household or create competing owners** — Self-transfer400; exactly one owner after any successful transition; competing transfers/role writes serialize. | Claude HTTP+DB; source cross-check; Claude:SEC-06;SEC-07;domain-security-privacy.md:SEC-06;domain-security-privacy.md:SEC-07 |

### R04 — Complete visibility and capability enforcement

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| FIN-01 | P0 | OPEN | **private financial data bypasses ordinary account and transaction visibility** — All indirect readers/writers and export counts exclude unauthorized private account/transaction data; do not rely on one visibility flag. | HTTP goal leak with positive/negative controls; other variants source (Codex baseline); Codex:FIN-01;Claude:PRIV-01..05;ISO-01;RC-01;PRIV-07;domain-security-privacy.md:PRIV-01;domain-security-privacy.md:PRIV-04;domain-security-privacy.md:PRIV-05;domain-security-privacy.md:PRIV-07 |
| OPS-005 | P0 | OPEN | **Weekly recap can disclose another member's private recurring bills** — Recipient recap contains no other member private recurring name/amount/id across widget/email/push.; supporting packets: R16 | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:OPS-005;Claude:PRIV-05;domain-security-privacy.md:PRIV-03 |
| ORG-001 | P1 | OPEN | **Professional role falls through organization write checks** — Explicit Professional read-only matrix enforced and unknown role denied at every capability boundary. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:ORG-001;Claude:cross-comparison section 4 |
| ORG-002 | P0 | OPEN | **Tag transaction lists omit private-account visibility** — Tag lists/counts exclude transactions on private accounts as well as transaction-private rows. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Claude HTTP confirmation; Codex:ORG-002;Claude:PRIV-02;domain-security-privacy.md:PRIV-02 |
| ORG-003 | P0 | OPEN | **Rule actions can reference entities outside the household** — Foreign category/tag/member/goal/merchant IDs fail before writes at authoring and execution; legacy rules quarantined.; supporting packets: R11 | Claude 14 October HTTP+DB re-verification confirms Codex source finding; not re-run during consolidation; Codex:ORG-003;Claude:rules invalid-action observations;RUL-03;domain-import-receipts-organization.md:RUL-03 |
| AH-09 | P1 | OPEN | **view-only members can mutate shared household preferences** — View-only/member/Professional shared policy writes403, unchanged household row; personal preferences remain writable by their owner.; supporting packets: R05 | Claude 14 October HTTP+DB re-verification confirms Codex source finding; not re-run during consolidation; Codex:AH-09;Claude:F-SEC-01;SET-02 |
| NEW-01 | P0 | OPEN | **Cross-household goal activity exposure** — Foreign goal activity returns404 with no metadata; same-household private activity excludes hidden amounts. | Claude HTTP; skeptic repeat; source cross-check; Claude:ISO-01;domain-security-privacy.md:ISO-01 |
| NEW-33 | P2 | OPEN | **Malformed identifiers, foreign paths and detection endpoints mishandle errors** — Malformed UUID400, invisible object404 without leak; unknown revoke404; recurring detect works or bounded useful error. Reject unsupported far-future dates with documented bounds. Unknown /api paths return JSON404 before SPA fallback; unsupported version aliases are explicit.; supporting packets: R14;R18 | Claude domain HTTP/source; Claude:ISO-02;ISO-03;VAL-02;VAL-03;SES-03;recurring detect;VAL-04;domain-security-privacy.md:SEC-03;domain-security-privacy.md:PRIV-06;domain-security-privacy.md:ISO-02;domain-security-privacy.md:ISO-03;domain-security-privacy.md:ISO-04;domain-security-privacy.md:SES-03;domain-security-privacy.md:VAL-02;domain-security-privacy.md:VAL-03;domain-security-privacy.md:VAL-04;F-SEC-03 |

### R05 — Persistent settings and shared views

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| AH-07 | P1 | OPEN | **profile saves silently discard offered data** — Each offered profile field including null clearing persists UI->API->DB->reload; unwanted sensitive fields never broadly disclosed. | HTTP save/read-back; source (Codex baseline); Codex:AH-07;Claude:SET-01;domain-settings-notifications-ai.md:SET-01 |
| NEW-11 | P1 | OPEN | **Default shared filter hides first owned account** — First account appears immediately under All; saved per-user filters restored; empty states distinguish filtering.; supporting packets: R18 | Claude browser; Claude:F-ACC-01 |
| NEW-16 | P1 | OPEN | **Budget rollover preference cannot be persisted** — Owner enables rollover; preference read-back persists; next period receives450 exactly once.; supporting packets: R10;R14 | Claude HTTP+DB; Claude:BGR-02;domain-budgets-goals-recurring.md:BGR-02 |
| NEW-26 | P1 | OPEN | **Personal preferences do not persist separately** — User preferences update own record only; household policy owner/admin; changing currency with history409. Partial notification update preserves omitted threshold; explicit null clears; type is allowlisted. | Claude HTTP+DB; Claude:SET-02;SET-05;domain-settings-notifications-ai.md:SET-02;domain-settings-notifications-ai.md:SET-04;domain-settings-notifications-ai.md:SET-05 |

### R06 — MFA management and security policy

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| AH-11 | P1 | OPEN | **MFA management and policy are unfinished** — Enroll/login/backup/regenerate/recover/disable UI works; mandatory policy constrains existing sessions with currency-aware step-up. Enrollment also requires step-up and completed factor challenge before enabling MFA or issuing active recovery codes. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:AH-11;Claude:F-SEC-05;domain-settings-notifications-ai.md:SEC-03;F-CLIENT-02 |

### R07 — Self-service export, leave and erasure

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| AH-08 | P1 | OPEN | **account exit and full portability are unfinished** — Self-service authorized export and all three erasure states complete with replay-safe cleanup and preserved legitimate shared history. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:AH-08;Claude:DATA-01;DEL-01;DEL-02;domain-settings-notifications-ai.md:DATA-01;domain-settings-notifications-ai.md:DEL-02;F-SEC-02;F-CLIENT-02 |

### R08 — Ledger invariants across every writer

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| FIN-05 | P1 | OPEN | **ledger producers lose currency, and summary DTOs label converted totals as ZMW** — Every writer stores proven account currency; summaries report actual converted currency; ambiguous legacy nulls quarantined.; supporting packets: R10;R12 | Import database null currency + source; other variants source (Codex baseline); Codex:FIN-05;Claude:import domain X-01;domain-import-receipts-organization.md:X-01 |
| FIN-08 | P1 | OPEN | **editing a split transaction amount leaves budget/report child totals stale** — Parent100 splits60+40; editing parent requires valid replacement allocations atomically; readers never retain stale sum. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:FIN-08;Claude:RC-05 |
| FIN-13 | P1 | OPEN | **account edits can reinterpret existing money without ledger reconciliation** — Account denomination/type/opening balance edits with activity409 unless explicit reconciled adjustment workflow is used. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:FIN-13;Claude:SET-05 |
| FIN-17 | P1 | OPEN | **transaction summary remains stale after successful financial writes** — Both server cache families/client keys update after commit without waiting TTL; cross-member reads revalidate; dated-flow FX used.; supporting packets: R12 | Manual browser + source cache path (Codex baseline); Codex:FIN-17;Claude:F-TXN-01;RC-06;RC-08;domain-reports-consistency.md:RC-06;F-UX-02 |
| ORG-005 | P1 | OPEN | **Rule split allocations can exceed the parent transaction amount** — Percent60+60 or money allocation exceeding parent rejected; normal split sums exactly.; supporting packets: R11 | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:ORG-005;Claude:adopted or no independent counterpart |
| FIN-16 | P1 | OPEN | **transaction UPDATE audit is not atomic despite its documentation** — Transaction update and its audit/outbox commit or roll back together; no success without mandatory audit. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:FIN-16;Claude:RC-13;server inventory F4 |
| NEW-05 | P0 | OPEN | **Card purchase reduces debt instead of increasing it** — Debt500 plus purchase45.50 becomes545.50; net worth falls45.50; migration reports legacy uncertainty. | Claude HTTP+DB; Claude:RC-03;domain-reports-consistency.md:RC-03 |
| NEW-28 | P1 | OPEN | **Shared owner selection ignored on transaction creation** — Shared null owner persists on shared account; private ownership cannot be broadened through selector.; supporting packets: R05 | Claude browser+DB; Claude:F-TXN-03 |
| NEW-32 | P1 | OPEN | **Financial writers/exports omit or duplicate audit records** — One audit per actual action in same transaction/outbox; bulk audit valid UUID plus batch metadata; exports tracked. Budget transfer to self rejected without transfer audit; rule edits and SIP creation audited.; supporting packets: R07 | Claude HTTP/DB/source; Claude:RC-13;server inventory F4;BGR-04;F-ACC-02;INV-09;RUL-04;domain-budgets-goals-recurring.md:BGR-04;domain-budgets-goals-recurring.md:BGR-08;domain-import-receipts-organization.md:RUL-04;domain-import-receipts-organization.md:X-02;domain-investments-grz.md:INV-09;domain-reports-consistency.md:RC-13 |
| NEW-35 | P2 | OPEN | **Money DTOs and precision inconsistent in peripheral views** — Decimal/Money through calculations; API amounts decimal strings with currency; display conversion never used for ledger math. Fees persisted in net proceeds/cost and reconciled to lot basis. CSV money values are fixed currency-scale decimal strings.; supporting packets: R13;R12 | Claude source/domain; focused acceptance pending; Claude:GRZ float/rate/fees notes;goal and portfolio DTO notes;INV-05;domain-budgets-goals-recurring.md:GOAL-02;domain-investments-grz.md:INV-05;domain-reports-consistency.md:RC-15 |

### R09 — One correct import/export workflow

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| FIN-02 | P0 | OPEN | **replaying an overwrite import deletes the data it previously imported** — Overwrite same file repeatedly leaves original intended live rows and exact balance; failure rolls back entire replacement. | HTTP + direct database read-back (Codex baseline); Codex:FIN-02;Claude:IMP-01;domain-import-receipts-organization.md:IMP-01 |
| FIN-03 | P0 | OPEN | **CSV overwrite deletes a single leg of an account transfer** — Account-level overwrite intersects transfer -> explicit preview conflict or reviewed pair-safe operation; never one live leg. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:FIN-03;Claude:IMP-01 cluster;cross-comparison section 4 |
| FIN-04 | P1 | OPEN | **the account-detail import path cannot import any row and its repair must address sign/balance semantics** — Valid account-detail CSV imports1 with correct UUID/sign/once-only balance; exported values roundtrip without double charge. | HTTP skipped valid row + source cause; latent variants source (Codex baseline); Codex:FIN-04;Claude:adopted or no independent counterpart |
| FIN-15 | P1 | OPEN | **CSV accepts nonexistent dates and silently chooses US ordering for ambiguous dates** — Feb30 rejected; ambiguous slash date requires selected format; date-only roundtrip unchanged. | Executed real parser pure function (Codex baseline); Codex:FIN-15;Claude:IMP-03;IMP-04;domain-import-receipts-organization.md:IMP-03;domain-import-receipts-organization.md:IMP-04 |
| NEW-17 | P1 | OPEN | **Import dedupe loses legitimate repeated purchases and metadata** — Two identical purchases in one batch retained; exact batch replay idempotent; Notes/mapping/history and row errors preserved. | Claude domain HTTP/DB/source; variant-specific; Claude:IMP-02;IMP-05;IMP-06;IMP-07;domain-import-receipts-organization.md:IMP-02;domain-import-receipts-organization.md:IMP-05;domain-import-receipts-organization.md:IMP-06;domain-import-receipts-organization.md:IMP-07 |

### R10 — Budgets and reversible goals

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| FIN-06 | P0 | OPEN | **primary budget progress sums different currencies without conversion** — ZMW budget includes USD50 at approved dated FX, never K50 by relabeling; missing rate explicit. Explicitly classified refunds reduce their original expense category; generic income is not silently assumed to be a refund. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Claude domain runtime confirmation; Codex:FIN-06;Claude:BGR-01;domain-budgets-goals-recurring.md:BGR-01;domain-budgets-goals-recurring.md:BGR-07 |
| FIN-07 | P1 | OPEN | **“historical averages” writes the entire multi-month total as one monthly budget** — Three months totaling550 yields183.33 monthly suggestion; zero months valid; future months excluded; manual budgets preserved without confirmation. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Claude domain runtime confirmation; Codex:FIN-07;Claude:BGR-03;domain-budgets-goals-recurring.md:BGR-03 |
| FIN-09 | P1 | OPEN | **goal transaction links do not preserve progress across their full lifecycle** — Link/edit/delete/unlink/contribution/assigned account modes reconcile exact stored progress and inverse correction. Minimal partial assignment defaults must be valid and distinct from automatic full-balance mode. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:FIN-09;Claude:GOAL-01;PRIV-04;domain-budgets-goals-recurring.md:GOAL-03 |
| NEW-29 | P1 | OPEN | **Goal contribution errors cannot be reversed safely** — Invalid/unbounded input rejected; deliberate overfunding explicitly confirmed; correction reverses exact contribution without arbitrary clamping. | Claude domain HTTP; Claude:GOAL-01;domain-budgets-goals-recurring.md:GOAL-01 |

### R11 — Rules, tags, merchants and saved organization

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| ORG-004 | P1 | OPEN | **Rule dry-run performs database writes** — Every rule action dry-run leaves DB snapshots unchanged and faithfully lists tag/alias/split effects. | Claude 14 October HTTP+DB re-verification confirms Codex source finding; not re-run during consolidation; Codex:ORG-004;Claude:rules set_category dry-run probe;RUL-05;domain-import-receipts-organization.md:RUL-05 |
| ORG-006 | P1 | OPEN | **Reachable merchant controls have no corresponding server routes** — All client merchant detail/alias/logo/analytics/transaction/test-rule controls have authorized reachable handlers and persisted outcomes.; supporting packets: R15 | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:ORG-006;Claude:ORG-02;F-CLIENT-01;RUL-01;domain-import-receipts-organization.md:RUL-01;domain-import-receipts-organization.md:ORG-02 |
| ORG-007 | P1 | OPEN | **Merchant deletion options disagree with server behavior** — Delete/archive/reassign options match documented UI/server behavior with referenced transactions preserved correctly. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:ORG-007;Claude:adopted or no independent counterpart |
| ORG-008 | P2 | OPEN | **Merchant undo adjusts counts using the original snapshot, not rows actually restored** — Undo updates links/counters from rows actually restored after intervening changes, not original snapshot size. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:ORG-008;Claude:organization stale usage counts |
| ORG-009 | P2 | OPEN | **Repeating tag removal incorrectly decrements usage count** — Repeated tag removal changes count once; counts equal actual links after concurrent mutations. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:ORG-009;Claude:organization stale usage counts;domain-import-receipts-organization.md:ORG-04 |
| ORG-010 | P2 | OPEN | **Saved default preset is stored but never applied on entry** — Saved default preset applies on entry and survives reload; per-user reset is functional. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:ORG-010;Claude:adopted or no independent counterpart;F-CLIENT-02 |
| NEW-09 | P1 | OPEN | **Category picker has no usable categories** — Select real seeded expense category in UI, submit and verify category_id in DB/reports.; supporting packets: R18 | Claude browser+source; Claude:F-TXN-02 |
| NEW-19 | P1 | OPEN | **Tag merge fails UUID/text contract** — Merge200; links/counts correct; rollback on fault; no foreign household target accepted. | Claude HTTP; Claude:organization ORG-01;domain-import-receipts-organization.md:ORG-01 |
| NEW-27 | P2 | OPEN | **First household lacks category setup guidance** — Default categories seeded once or explicit setup offered before dependent entry; retry does not duplicate.; supporting packets: R18 | Claude DB/browser; Claude:F-ONB-01;ENH-01 repair subset |
| NEW-36 | P2 | OPEN | **Archive filters and normalization do not match UI promises** — Archive filters respected; names normalized per household; invalid rule actions rejected; counts and ordering match persisted rows. | Claude domain HTTP/source; exact variants in domain report; Claude:includeArchived note;CAT-01;CAT-02;organization ORG-03;ORG-04;RUL-02;RUL-06;domain-import-receipts-organization.md:RUL-02;domain-import-receipts-organization.md:RUL-06;domain-import-receipts-organization.md:ORG-03;domain-import-receipts-organization.md:CAT-01;domain-import-receipts-organization.md:CAT-02 |

### R12 — FX ownership and reconciled reports

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| FIN-18 | P1 | OPEN | **Annual Dashboard monthly trends misparse the API's month label and lose grouped values** — API/chart date contract explicit; monthly/quarter grouping and all series retain independently expected values. | Manual browser + source DTO path (Codex baseline); Codex:FIN-18;Claude:F-REP-01 |
| NEW-02 | P0 | OPEN | **Ratios and debt skip FX and visibility** — USD75 at26.50 contributes1987.50; private balances excluded; missing pair returns explicit incomplete/error.; supporting packets: R04 | Claude HTTP and independent arithmetic; Claude:RC-01;domain-reports-consistency.md:RC-01 |
| NEW-06 | P1 | OPEN | **Card purchase missing from expense and savings definitions** — Card purchase counts as expense once; debt principal repayment is transfer; income-expenses equals cashflow savings. | Claude HTTP+source; Claude:RC-04;domain-reports-consistency.md:RC-04 |
| NEW-13 | P0 | OPEN | **Global FX and securities writable across households** — Member cannot write global source; household override never changes another household's valuations.; supporting packets: R04 | Claude HTTP+DB; Claude:RC-02;INV-06;domain-investments-grz.md:INV-06;domain-reports-consistency.md:RC-02 |
| NEW-14 | P1 | OPEN | **Split rows omitted from reports and exports** — Parent100 with children60+40 yields100 in all readers and reconstructable CSV, never0 or200.; supporting packets: R09 | Claude HTTP; Claude:RC-05;domain-reports-consistency.md:RC-05 |
| NEW-15 | P1 | OPEN | **Clock and local-period boundaries disagree** — Date-only stays entered day; event instant renders same across views; UTC server/Lusaka month and tax-year boundary correct. Goal forecasts use calendar months/local today, completed remaining time zero, and recurring due date is household-local.; supporting packets: R18 | Claude DB/browser; production parity pending; Claude:F-DATE-01;F-DATE-01b;F-DATE-01c;RC-08;security SEC-04;domain-budgets-goals-recurring.md:GOAL-04;domain-budgets-goals-recurring.md:REC-05;domain-import-receipts-organization.md:X-03;domain-reports-consistency.md:RC-08;domain-security-privacy.md:SEC-04;domain-settings-notifications-ai.md:AI-04 |
| NEW-34 | P1 | OPEN | **Secondary report totals, averages and history not reconciled** — Missing FX explicit; penny-level totals foot; Unassigned bucket present; elapsed-month mean; snapshot/history completeness shown. | Claude domain HTTP/source; Claude:RC-10;RC-11;RC-12;RC-14;F-CF-01;domain-reports-consistency.md:RC-10;domain-reports-consistency.md:RC-11;domain-reports-consistency.md:RC-12;domain-reports-consistency.md:RC-14 |

### R13 — Investment, pension and GRZ lifecycle

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| FIN-10 | P1 | OPEN | **buy/sell updates quantity but leaves the portfolio's cost basis unchanged** — Two buys at same price update remaining cost basis and produce zero invented gain; partial sale updates FIFO remainder. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Claude domain runtime confirmation; Codex:FIN-10;Claude:INV-01;domain-investments-grz.md:INV-01 |
| FIN-11 | P1 | OPEN | **automated investment purchases cannot complete the later sell journey** — Automated/opening purchase produces valid lots or reviewed opening provenance; later sell works and consumes correct basis.; supporting packets: R14 | Source-confirmed; focused runtime acceptance pending (Codex baseline); Claude domain runtime confirmation; Codex:FIN-11;Claude:INV-03;domain-investments-grz.md:INV-03 |
| FIN-12 | P1 | OPEN | **investment schedules miss overdue executions and drift past month-end** — Investment overdue item runs under catch-up once;31st anchor returns after short month; paused/end-date items respected.; supporting packets: R14 | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:FIN-12;Claude:INV-10;REC-02;domain-investments-grz.md:INV-10 |
| FIN-14 | P1 | OPEN | **missing portfolio FX returns a successful but understated net worth** — Missing holding valuation/FX is explicit incomplete/error; no successful understated total or dropped component.; supporting packets: R12 | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:FIN-14;Claude:RC-07 |
| NEW-03 | P0 | OPEN | **GRZ principal incorrectly classified as income** — Settlement retires asset and credits/link-matches cash once; principal never ordinary income; no duplicated acquisition debit.; supporting packets: R08 | Claude HTTP+DB; Claude:GRZ-01;domain-investments-grz.md:GRZ-01;domain-investments-grz.md:GRZ-03 |
| NEW-04 | P0 | OPEN | **Disposed bonds still allow future payments** — Sold/matured bond rejects stale scheduled payment with409; no new cash row; settlement date/destination validated. | Claude HTTP+DB; Claude:GRZ-02;GRZ-04;domain-investments-grz.md:GRZ-02;domain-investments-grz.md:GRZ-04 |
| NEW-20 | P1 | OPEN | **Negative sale creates phantom holding quantity** — Sell quantity strictly positive and within locked holding; invalid input400; no lot or balance change. | Claude domain HTTP/DB; Claude:INV-02;domain-investments-grz.md:INV-02 |
| NEW-21 | P1 | OPEN | **Investment stored base-currency amounts omit posted FX** — 180USD at20 records3600ZMW with rate/date provenance; missing rate fails closed.; supporting packets: R12 | Claude domain HTTP/DB; Claude:INV-04;domain-investments-grz.md:INV-04 |
| NEW-22 | P1 | OPEN | **Tax reporting omits withholding/income or duplicates year boundary** — Approved-rate coupon gross/withholding/net reconcile to report/export; Dec31 counted in one declared tax year.; supporting packets: R12 | Claude domain HTTP/DB; Claude:INV-07;INV-08;domain-investments-grz.md:INV-07;domain-investments-grz.md:INV-08 |
| NEW-23 | P1 | OPEN | **GRZ validation and zero-interest maturity fail** — Negative face/rate14/invalid dates rejected; zero-interest maturity succeeds; day-count/fees/conventions versioned; SQL not returned. Persisted precision must reproduce coupon schedule; calculator and stored instrument share day-count and tenor/date validation. | Claude domain HTTP/DB/source; Claude:GRZ-05;GRZ-06;GRZ convention notes;domain-investments-grz.md:GRZ-05;domain-investments-grz.md:GRZ-06;domain-investments-grz.md:GRZ-07;domain-investments-grz.md:GRZ-08;domain-investments-grz.md:GRZ-09 |
| NEW-24 | P1 | OPEN | **Pension totals and contribution lifecycle lack validation/audit** — Employee plus employer equals total, positive bounds, correction/audit and cash effect explicit. Contribution update and audit are atomic under lock, including concurrent updates.; supporting packets: R08 | Claude domain HTTP/DB; Claude:PEN-01;INV-10 pension;domain-investments-grz.md:PEN-01;domain-investments-grz.md:PEN-02 |
| NEW-25 | P1 | OPEN | **GRZ, tax and pension UI inaccessible without equity holdings** — Bond-only and empty-equity user reaches each tab and real tax link; no vacuous fixture skip.; supporting packets: R18 | Claude browser; Claude:F-INV-01;F-CLIENT-02 |

### R14 — Durable recurring and scheduled jobs

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| OPS-003 | P0 | OPEN | **Automatic financial processing is not fully wired or operationally evidenced** — Each registry job has a deployed trigger and observed due execution; dormant outbox/receipt worker promises completed. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:OPS-003;Claude:F-OPS-01;F-OPS-05 |
| OPS-013 | P1 | OPEN | **Coordination uses expiring/evictable Redis keys without durable run identity** — Two workers/restart/lease expiry cannot duplicate due financial effects; DB identity and fencing survive cache eviction.; supporting packets: R19 | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:OPS-013;Claude:Redis allkeys-lru inventory note |
| NEW-10 | P1 | OPEN | **Recurring UI omits required payload fields** — Frequency and due date submitted; valid rule201 and scheduled effect; validation shown inline.; supporting packets: R18 | Claude browser/network; Claude:F-REC-01;REC-01;domain-budgets-goals-recurring.md:REC-01 |
| NEW-30 | P1 | OPEN | **Recurring anchor, catch-up and future execution inconsistent** — Monthly anchor retained after short month; bounded overdue runs keyed by period; member cannot advance clock. | Claude domain HTTP/source; Claude:REC-02;REC-03;REC-04;domain-budgets-goals-recurring.md:REC-02;domain-budgets-goals-recurring.md:REC-03;domain-budgets-goals-recurring.md:REC-04 |

### R15 — Durable receipts and OCR

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| OPS-001 | P1 | OPEN | **Uploaded files have no declared durable deployment storage** — Uploaded objects survive restart/redeploy and backup restore; manifest proves legacy migration without loss.; supporting packets: R19 | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:OPS-001;Claude:F-OPS-02 |
| OPS-004 | P1 | OPEN | **Receipt OCR conflicts with production Content Security Policy** — OCR upload/worker/recognition works under actual production CSP with pinned assets. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:OPS-004;Claude:adopted or no independent counterpart |
| NEW-18 | P0 | OPEN | **Receipt conversion duplicates or reverses ledger effect** — Concurrent/replayed conversion yields one positive expense; negative or zero request rejected before mutation.; supporting packets: R08 | Claude HTTP+DB; Claude:RCP-01;RCP-02;domain-import-receipts-organization.md:RCP-01;domain-import-receipts-organization.md:RCP-02 |

### R16 — Notifications, push and weekly recap

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| OPS-008 | P0 | OPEN | **Push subscription accepts an arbitrary outbound HTTPS destination** — Unknown/private/loopback push destination rejected before dispatch; known allowed service succeeds through controlled test. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:OPS-008;Claude:settings domain push observation;cross-comparison section 4 |
| OPS-006 | P1 | OPEN | **Recap can publish false zero values and incorrect currency labels** — Missing FX produces incomplete state not zero; household currency rendered accurately. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:OPS-006;Claude:RC-07;SNA-REC-03;domain-reports-consistency.md:RC-07;domain-settings-notifications-ai.md:REC-03 |
| OPS-009 | P1 | OPEN | **User-controlled names are interpolated directly into notification emails** — Hostile names rendered as escaped text in every email template without executable markup injection. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:OPS-009;Claude:VAL-01;domain-security-privacy.md:VAL-01 |
| OPS-010 | P1 | OPEN | **Notification delivery status and deduplication do not reflect channel outcomes** — Per-channel success/failure/unknown/suppressed states and dedupe preserve truthful retry outcomes. Missing VAPID gives not-configured outcome; quiet-hours UI persists; cron counts reflect actual new outcomes after dedupe. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:OPS-010;Claude:adopted or no independent counterpart;domain-settings-notifications-ai.md:NOT-01;domain-settings-notifications-ai.md:NOT-02;domain-settings-notifications-ai.md:NOT-03 |
| OPS-007 | P2 | OPEN | **Saved recap content preferences do not govern generated content** — Saved includeGoals/includeRecurring controls affect generated content without resetting unrelated settings. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:OPS-007;Claude:SNA-REC-01;recap settings observations |
| NEW-31 | P1 | OPEN | **Recap period snapshots/settings overwrite one another** — Seven-day interval; independent settings PATCH; historical net worth snapshot remains historical. Recap feedback persists queryable structured record with replay handling.; supporting packets: R05 | Claude domain HTTP/DB/source; Claude:SNA-REC-01;SNA-REC-04;RC-09;domain-reports-consistency.md:RC-09;domain-settings-notifications-ai.md:REC-01;domain-settings-notifications-ai.md:REC-02;domain-settings-notifications-ai.md:REC-04;domain-settings-notifications-ai.md:REC-05 |
| NEW-38 | P2 | OPEN | **Security notices and notification noise inconsistent** — Credential changes generate sanitized security event and notice; routine login notifications respect preferences; live session timestamps truthful.; supporting packets: R01 | Claude settings/security domain; Claude:SNA-SEC-02;login-noise note;SES-02;domain-security-privacy.md:SES-02;domain-settings-notifications-ai.md:SEC-02 |

### R17 — Thandi Claude primary and Gemini fallback

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| OPS-012 | P1 | OPEN | **AI privacy/cost controls need precise boundaries before provider enablement** — Complete section 3: both consent and spend controls; correct provenance; Claude->eligible Gemini->local; no evasion of limits. Quota policy headers match allowance; dataWindow reflects actual query; local prompt estimates are not provider token usage. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:OPS-012;Claude:F-AI-01;AI-01;domain-settings-notifications-ai.md:AI-01;domain-settings-notifications-ai.md:AI-02;domain-settings-notifications-ai.md:AI-03 |

### R18 — Complete UX, accessibility and date display

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| UX-02 | P1 | OPEN | **small-screen layout prevents core transaction use** — Core flows usable at320px and200%zoom on recorded devices; navigation never covers inaccessible content. | Manual viewport observation; formal audit pending (Codex baseline); Codex:UX-02;Claude:F-MOB-01 |
| NEW-37 | P2 | OPEN | **Visible controls, attribution and validation remain inert or misleading** — Transfer direction clear; wizard announces error; copy/reset/radio/navigation works; greetings accurate; accessibility checks complete. Session/history response envelopes match canonical success/data contract. Authorized delete/archive/correction UI exists for individual transactions, budgets, goals and holdings under their lifecycle guards; filter presets can be created and deleted.; supporting packets: R05 | Claude browser/source; Claude:F-TXN-04;F-GOAL-UX-01;P3 UI list;ENH-04;ENH-11 repair subset;ENH-13;domain-settings-notifications-ai.md:SEC-04;F-CLIENT-02 |

### R19 — Deployable operations, storage and recovery

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| OPS-002 | P1 | OPEN | **Release health can stay green while required Redis is unavailable** — Configured required Redis outage gives bounded unhealthy response, not cache-stats success. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:OPS-002;Claude:F-OPS-03 |
| OPS-014 | P1 | OPEN | **Job outcomes and errors are lost by the structured logger** — Structured log retains sanitized request/job/provider/error context and produces actionable failures. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:OPS-014;Claude:F-OPS-04 |
| OPS-015 | P1 | OPEN | **Database certificate verification remains an unfinished release gate** — Valid CA verified; invalid certificate rejected; staging/production explicitly configured. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:OPS-015;Claude:F-OPS-06 |
| QA-02 | P1 | OPEN | **operational evidence is incomplete** — Exact-candidate staging/provider/job/load/restore/rollback/device/UAT evidence exists; missing proofs remain blockers.; supporting packets: R21 | Explicitly unverified operational evidence (Codex baseline); Codex:QA-02;Claude:F-OPS-07;EVIDENCE section 5 |

### R20 — Trustworthy automated and runtime verification

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| OPS-011 | P1 | OPEN | **Local browser suites can mutate the wrong environment and bypass production protections** — Root/server/browser commands refuse real/unknown target and arbitrary reused server; protected runtime uses actual defenses. | Source-confirmed; focused runtime acceptance pending (Codex baseline); Codex:OPS-011;Claude:F-TEST-01 |
| QA-01 | P1 | OPEN | **green browser tests do not establish completed business journeys** — Every required browser test submits, asserts persisted result and fails for absent required controls; no vacuous conditional pass. | Fresh suite results + test source (Codex baseline); Codex:QA-01;Claude:Playwright environment block;cross-comparison section 4;F-E2E-01 |

### R21 — Integrated acceptance and controlled release

| ID | Priority | Status | Required work / closure acceptance | Evidence and source IDs |
|---|---|---|---|---|
| — | Gate | NOT_STARTED | Cross-cutting packet; all packet requirements still mandatory | Primary closure groups are owned by supported packets |



<a id="delivery"></a>
## 5. Delivery sequence and detailed implementation packets

### Estimate and dependencies

**22 packets, 88–145 focused developer-days (approximately 6 engineering hours/day).** Add 20% once:105.6–174 days, rounded up **106–174**, about 22–35 five-day working weeks. This is a newly reconciled planning estimate, not a measured quote or a promised date. It includes the newly discovered financial/UI paths, full settings/roles, durable AI admission and meaningful verification. Do not add the two audit estimates together.

R21 includes integration/UAT engineering effort; the14-day soak is elapsed time with monitoring and may overlap no-change review, not14 extra developer-days. External decisions, provider access, migration reconciliation and staffing can extend elapsed duration. Do not linearly halve estimates for two developers: shared schema/financial/authorization contracts serialize work. Reforecast after G1/G2 using completed packet throughput.

| Packet | Focus | Days | Dependencies |
|---|---|---|---|
| R00 | Reproducible baseline, runtime and dependencies | 2–4 | none |
| R01 | Sessions, public DTOs and credential concurrency | 3–5 | R00 |
| R02 | Registration, verification and recovery | 3–5 | R01 |
| R03 | Membership, ownership and Professional lifecycle | 4–7 | R02, R04 |
| R04 | Complete visibility and capability enforcement | 4–7 | R01 |
| R05 | Persistent settings and shared views | 4–7 | R03, R04 |
| R06 | MFA management and security policy | 2–4 | R01, R02, R05 |
| R07 | Self-service export, leave and erasure | 5–8 | R01, R03, R04, R05, R19 |
| R08 | Ledger invariants across every writer | 6–9 | R04 |
| R09 | One correct import/export workflow | 4–6 | R08 |
| R10 | Budgets and reversible goals | 4–7 | R08, R12 |
| R11 | Rules, tags, merchants and saved organization | 4–7 | R04, R08 |
| R12 | FX ownership and reconciled reports | 5–8 | R04, R08 |
| R13 | Investment, pension and GRZ lifecycle | 7–11 | R08, R12, R14 |
| R14 | Durable recurring and scheduled jobs | 4–6 | R08, R19 |
| R15 | Durable receipts and OCR | 3–5 | R08, R14, R19 |
| R16 | Notifications, push and weekly recap | 3–5 | R04, R12, R14, R19 |
| R17 | Thandi Claude primary and Gemini fallback | 5–8 | R04, R05, R12, R19 |
| R18 | Complete UX, accessibility and date display | 4–6 | R02, R03, R05 |
| R19 | Deployable operations, storage and recovery | 4–7 | R00 |
| R20 | Trustworthy automated and runtime verification | 3–5 | R00 |
| R21 | Integrated acceptance and controlled release | 5–8 | R01, R02, R03, R04, R05, R06, R07, R08, R09, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20 |

The table states prerequisite responsibility. Safe isolated tests/design can begin earlier, but dependent production behavior cannot be declared closed before its required contracts are verified. **An R19 dependency means its verified environment/storage foundation milestone**, not completion of the later integrated restore/job drill: record R19-FOUNDATION separately in its evidence. R14 can build and prove the scheduler on that foundation; R19 and R21 then record the combined operational proof. This avoids a circular wait between provisioning and scheduled-job evidence. R20 likewise delivers target protection and honest fixtures early, then final harness coverage before R21. Do not allow the UI sequence to delay R04 privacy fixes.

### Gates and order

| Gate | Required result | Packets/conditions |
|---|---|---|
| G0 Baseline and protected test targets | Supported runtime plan, isolated DB/server guard, honest browser harness, named environment inputs | R00/R20 foundations; R19 staging bootstrap |
| G1 Identity and privacy | Actual revocation, fresh-device verification, role/private/reference denial, member lifecycle | R01–R04; R11 reference/purity slices may land early |
| G2 Money | Exact asset/liability, pair-safe imports, report FX/splits, reversible budget/goal state | R08–R12; affected R14 jobs |
| G3 Complete workflows | Settings/MFA/exit, investments, jobs, receipts, notifications and shared views all functional | R05–R07/R13–R16; deployed R19 foundations |
| G4 AI and usable product | Claude/Gemini/local paths, consent/budget concurrency, phone/accessibility, no inert offered controls | R17/R18 |
| G5 Release candidate | All 101 required register items closed or evidence-refuted, J01–J16, restore/rollback,14-day soak and owner UAT | R19–R21; no unresolved OI dependency for enabled feature |
| G6 Controlled release | Authorized deployment, exact SHA smoke, first real due jobs and72h observation | Separate OI-06 authorization; no scope reduction |

A minimal invited pilot is a rollout stage after applicable full-product gates, not an alternate completion definition. Any discovered defect gets an ID, packet, severity, evidence and acceptance condition before repricing. No new feature is inferred from a source report's suggestion.

### Shared implementation loop for every slice

Each packet contains three implementation slices. Split each into a reviewable commit with these actions, usually small test/code iterations rather than one giant patch:

1. Claim ownership and record baseline/dirty files/dependencies. Read the exact source finding and current call path.
2. Write a failing behavioral regression using the independent oracle listed below. Exercise actual HTTP/persistence for permission/money defects; do not calculate expected values using the production helper.
3. Run the single regression and capture the expected assertion failure. Environment errors are BLOCKED, not a valid red test.
4. Implement the smallest cohesive service/controller/client change; validate at boundaries, transact financial effects, preserve compatibility. Add migration only with explicit schema mapping/backfill proof.
5. Run the focused test to green, then affected adjacent tests and static checks. Test failure, retry, unauthorized and concurrency branches; avoid tests that only mirror implementation.
6. Run the matching protected runtime journey (HTTP/browser/DB/files) on the isolated target and later staging. Save evidence with SHA/config/target and expected-versus-observed values.
7. Review changed code, migration and error paths with an authorized reviewer; resolve findings. If committing is part of the implementation instruction, stage explicit paths and use the suggested packet message; never commit unrelated files or secrets.
8. Update register status honestly. Record incomplete runtime evidence and next action in HANDOFF; do not mark CLOSED from local green alone.

### Commands and target safety

Run from repository root unless noted. These commands are instructions for future authorized implementation; none was run as remediation by this documentation task.

```powershell
git status --short
git rev-parse HEAD
npm run check
npm run test:server:run -- modules/auth/__tests__/completion-r01.realdb.integration.test.ts
npm run test:run -- client/src/pages/settings
npm run build
npm run check:bundle
npm run deploy:verify
```

The focused server example works through the existing script's `cd server && vitest run`; use each packet's relative server test path below. Full suites when integrating a candidate: `npm run test:server:run`, `npm run test:run`, and the guarded Playwright profile. Server Vitest forces NODE_ENV=test: it **cannot** establish production CSRF/CSP/rate behavior.

Before any DB suite, provision a dedicated database such as `pfa_completion_r08_<run>_test`, bind explicit TEST_DATABASE_URL through the secure environment, and verify its resolved database name/host against the approved target manifest without printing secrets. R00/R20 must add a refusal before mutating a real/unknown DB, including root test commands. The real `finance_app` is excluded. Never rely solely on a name substring or ambient .env. No paid provider/email/push calls in ordinary tests.

R20 creates a **proposed** `playwright.production.config.ts` and guarded launch script that use an explicitly owned HTTPS production-mode server, synthetic DB, fixed run marker and sink/mock providers. Future command: `npx playwright test --config playwright.production.config.ts e2e/completion-r21.spec.ts --project=chromium`. It must not reuse arbitrary localhost:5000. Install the matching browser only when needed for authorized implementation. Run migration commands only with the explicit isolated/staging target; never db:push against production.

### Behavioral test examples

These are intended assertions, not pre-existing test helpers or application patches. Implement fixture/API helpers in the proposed tests using current repository patterns.

```text
Given asset cash1000, post income200 and expense125.50
Assert stored balance = "1074.50"
Transfer100 to empty asset -> balances "974.50" and "100.00"
Replay same operation -> unchanged rows, balances and effect count
Given credit debt500, post purchase45.50
Assert debt = "545.50"; expense = "45.50"; net worth decreases45.50

Given owner private transaction marker SECRET and shared goal link
Member reads goal activity/tag list/recurring/AI/export
Assert no SECRET, private ID, hidden amount or hidden row count
Outsider goal activity ->404; denied mutation leaves DB hash unchanged

Given one budget unit and two simultaneous AI requests on different instances
Release both at a barrier
Assert one paid attempt claimed; total settled plus reserved never over limit
Simulate provider timeout after dispatch -> reservation stays held after restart
Gemini cannot dispatch unless its own reservation fits remaining budget
```

### Detailed packet instructions

<a id="r00"></a>
#### R00 — Reproducible baseline, runtime and dependencies

**Owners:** `r00_runtime_resume` (Sol high, runtime/dependencies/limiters) and `r00_targets_resume` (Sol xhigh, protected test targets); integrator Astra. **Reviewer:** `r00_final_review` (separate Sol xhigh agent). Assigned 15 October 2026; local foundation accepted, full packet remains OPEN; see `docs/reviews/completion-v2-evidence/CAMPAIGN.md`. **Effort:** 2–4 days. **Completion dependencies:** none.
**Primary register rows:** DEP-01, DEP-02, NEW-08, NEW-39. **Supporting:** none.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `package.json`
- Modify as needed: `.github/workflows/ci.yml`
- Modify as needed: `render.yaml`
- Modify as needed: `server/testing/test-database.ts`
- Modify as needed: `scripts/setup-test-db.mjs`
- Proposed test: `server/testing/__tests__/completion-r00.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R00.1:** Inventory deployment/runtime/schema identities and pin a currently supported Node/DB combination across local, CI and staging.
2. **R00.2:** Remediate advisories with targeted upgrades and compatibility tests; do not use an unreviewed major audit fix.
3. **R00.3:** Introduce explicit disposable target/run-marker validation for all test entrypoints; use versioned migrations, never production db:push.

**Data/migration contract:** No business-data backfill; compatibility migration only if dependency changes demand one.

**Independent acceptance oracle:** Clean bootstrap and migration; wrong database or server target refused before writes; current dependency report has no unexplained release-blocking item.

**Focused verification:** `npm run test:server:run -- testing/__tests__/completion-r00.test.ts`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R00/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r00): reproducible baseline, runtime and dependencies`.

**Concrete repair contract:** Capture current Node, PostgreSQL, Redis, migration and dependency identities. Re-run the production dependency audit at implementation time; historical advisory counts are not an upgrade list. Pin the selected supported Node version across package engines, CI and deployment and test native/OCR dependencies. Mount the general limiter once, preserve distinct expensive/upload/auth limits, and stop charging /me and logout against the login-attempt quota. Proposed load-test fixture:600 requests per authenticated user per60 seconds;200 permitted ordinary requests in one controlled window, then a separate exhaustion scenario. Ratify the production limit from measured traffic and threat tests; do not raise limits just to pass navigation.

**Additional acceptance:** One normal login and dashboard/accounts/reports navigation causes no unintended429. Deliberate brute force remains throttled across shared IPs and instances. Runtime/environment mismatch fails before database mutation. Verify native dependency compatibility, not only TypeScript compilation.

<a id="r01"></a>
#### R01 — Sessions, public DTOs and credential concurrency

**Owner:** `r00_targets_resume` (Sol xhigh, dedicated R01 worktree). **Reviewer:** `r00_final_review` (separate Sol xhigh). Assigned 15 October 2026 after local R00 foundation acceptance; canonical rows remain OPEN. **Effort:** 3–5 days. **Completion dependencies:** R00.
**Primary register rows:** AH-01, AH-02, AH-10, AH-12. **Supporting:** NEW-38.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/services/session-revocation.ts`
- Modify as needed: `server/routes/security.sessions.ts`
- Modify as needed: `server/modules/auth/auth.session.service.ts`
- Modify as needed: `server/modules/auth/auth.mfa.service.ts`
- Modify as needed: `server/modules/settings/settings.account-deletion.service.ts`
- Proposed test: `server/modules/auth/__tests__/completion-r01.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R01.1:** Add two-cookie revocation and public DTO sentinel tests before changing endpoints.
2. **R01.2:** Revoke session store and tracking state consistently; bind step-up to session; prevent delayed session save from resurrecting a revoked identity.
3. **R01.3:** Allowlist DTOs; atomically consume codes under a user lock/conditional update; enforce one password policy and redact credential material.

**Data/migration contract:** If needed add monotonic user/session revocation generation with rolling compatibility; avoid deleting unrelated sessions.

**Independent acceptance oracle:** Revoked cookie 401; two concurrent redemptions yield one winner; different backup-code races cannot restore a consumed code; no credential sentinel in any public DTO.

**Focused verification:** `npm run test:server:run -- modules/auth/__tests__/completion-r01.realdb.integration.test.ts`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R01/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r01): sessions, public dtos and credential concurrency`.

**Concrete repair contract:** Explicit DTO allowlists differ by purpose: general auth/member responses exclude credential material and unnecessary sensitive profile fields; the authenticated own-profile endpoint may expose approved profile fields. Route selected-device revocation through a durable session-identity revocation check; user-wide generation is for revoke-all/reset/deletion. A late session-store save cannot recreate access, and revoking device B must preserve device A. Declare any new revocation/generation column, tombstone/index and session payload migration; do not label new state as “no data change.”

Consume a one-time code or recovery code with a conditional update/row lock inside one transaction. Two submissions of one code have one winner; concurrent different valid recovery codes remain consumed independently. Use one password policy for registration/change/reset. Queue sanitized security events and email/password-change notices atomically with the change through the outbox.

**Additional acceptance:** Two authenticated browser jars, targeted revoke, revoke-all, reset and erasure; delayed session save after each revoke; exact DTO key-set checks at every auth/profile/member response.

<a id="r02"></a>
#### R02 — Registration, verification and recovery

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 3–5 days. **Completion dependencies:** R01.
**Primary register rows:** AH-03, AH-04, UX-01, NEW-07. **Supporting:** NEW-08.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/modules/auth/auth.email.service.ts`
- Modify as needed: `server/modules/auth/auth.controller.ts`
- Modify as needed: `server/modules/auth/auth.routes.ts`
- Modify as needed: `server/routes/security.email.ts`
- Modify as needed: `client/src/App.tsx`
- Proposed test: `server/modules/auth/__tests__/completion-r02.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R02.1:** Create a captured-mail fresh-browser test with real CSRF and limiters, not fixture verification SQL.
2. **R02.2:** Use canonical real client links; permit token-authenticated verification only under the narrow exemption/anti-replay contract in section 2.
3. **R02.3:** Make pending-verification a restricted state with resend/recovery/logout; gate household queries; scope auth throttles to operation and identity without enumeration.

**Data/migration contract:** Token expiry/consumption must be conditional and atomic; no raw token persistence or logging.

**Independent acceptance oracle:** Register in A, verify exact mail link in B, login; replay/expiry invalid; pending user cannot access finance; reset revokes sessions; ordinary navigation avoids 429.

**Focused verification:** `npm run test:server:run -- modules/auth/__tests__/completion-r02.realdb.integration.test.ts`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R02/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r02): registration, verification and recovery`.

**Concrete repair contract:** Generate verification and reset links against configured public origins and registered client routes. Preserve a redirect for already-issued obsolete verification URLs. Capture the raw token from a synthetic SMTP message; storage contains its hash, which must not be submitted as the raw token. Fresh-browser token-only verification may have a narrowly scoped CSRF exemption only under the identity contract; resend takes an email, not a verification token. Keep cookie-authorized resend protected or define a separate throttled, non-enumerating public action with explicit origin policy.

Pending registration sessions may inspect status, verify/resend/recover/logout; they cannot access household/financial routes. Gate household queries before membership and seed categories atomically/idempotently on household creation.

**Additional acceptance:** Browser A registers, browser B verifies using captured mail, then login succeeds. Wrong/expired/used token, mail failure, resend throttling and anonymous first-run states are covered; zero household-error toast cascade.

<a id="r03"></a>
#### R03 — Membership, ownership and Professional lifecycle

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 4–7 days. **Completion dependencies:** R02, R04.
**Primary register rows:** AH-05, AH-06, AH-13, NEW-12. **Supporting:** none.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/modules/household/invitations.controller.ts`
- Modify as needed: `server/modules/household/members.controller.ts`
- Modify as needed: `server/repositories/HouseholdRepository.ts`
- Modify as needed: `server/modules/household/household.validation.ts`
- Modify as needed: `client/src/pages/settings/sections/MembersSection/index.tsx`
- Proposed test: `server/modules/household/__tests__/completion-r03.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R03.1:** Wire invitation create/list/resend/revoke/accept with safe login continuation and flat member DTOs.
2. **R03.2:** Serialize membership create/accept/leave/transfer around household and actor locks; reject self-transfer and role-based owner creation; enforce exactly one owner.
3. **R03.3:** Support Professional as shared-data read-only under section 2; implement leave/removal and state-based entitlement/shared-view UI instead of fake billing copy.

**Data/migration contract:** Preflight duplicate memberships/owners; produce repair report; add constrained uniqueness only after approved repair, never choose an owner silently.

**Independent acceptance oracle:** Two-browser invited recipient joins; wrong verified email denied; concurrent different-household accepts leave one membership; ownership always one; removal immediately revokes household access.

**Focused verification:** `npm run test:server:run -- modules/household/__tests__/completion-r03.realdb.integration.test.ts`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R03/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r03): membership, ownership and professional lifecycle`.

**Concrete repair contract:** Wire invitation creation/list/resend/revoke and the emailed invite route through login/registration/verification to acceptance. Align flat member DTOs with the actual UI. Serialize household creation versus invitation acceptance on the user, and serialize ownership transitions on the household. Recheck verified recipient, expiry, revocation, single use and active membership inside the same transaction.

Implement the offered Professional role under the capability matrix. Owner transfer rejects self-transfer, transfers to an existing eligible member, and demotes/promotes atomically; ordinary role-change cannot create/remove an owner. A unique index enforces at-most-one owner, while transactional lifecycle rules enforce at-least-one for an active household. Final-owner leave requires completed transfer or explicit household deletion.

**Additional acceptance:** Wrong invited address denied; two simultaneous accepts into different households produce one membership; creation-vs-accept race covered; genuine member name shown; removal/downgrade effective on next request.

<a id="r04"></a>
#### R04 — Complete visibility and capability enforcement

**Owner:** `r00_targets_resume` (Sol xhigh, dedicated R04 worktree), first bounded capability/context/household-policy slice assigned 15 October 2026 after verified local R01 contracts; later visibility slices remain separately scoped. **Reviewer:** `r00_final_review` (separate Sol xhigh). Full R01 production journeys and all canonical closure rows remain OPEN; see CAMPAIGN.md for exact prerequisite evidence and ownership. **Effort:** 4–7 days. **Completion dependencies:** R01.
**Primary register rows:** FIN-01, OPS-005, ORG-001, ORG-002, ORG-003, AH-09, NEW-01, NEW-33. **Supporting:** NEW-02, NEW-13.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/middleware/validateEntity.ts`
- Modify as needed: `server/middleware/householdGuard.ts`
- Modify as needed: `server/modules/goals/goals.controller.ts`
- Modify as needed: `server/services/GoalActivityLogService.ts`
- Modify as needed: `server/modules/goals/goals.extra.controller.ts`
- Modify as needed: `server/services/TransactionGoalLinkService.ts`
- Modify as needed: `server/repositories/RecurringRepository.ts`
- Modify as needed: `server/repositories/TagRepository.ts`
- Modify as needed: `server/repositories/RecurringQueryRepository.ts`
- Proposed test: `server/modules/goals/__tests__/completion-r04.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R04.1:** Implement explicit capability predicates and fail closed for unknown roles; enumerate every route with actor identity.
2. **R04.2:** Apply account AND transaction privacy to direct, relational, activity, count, report, export, AI and job inputs; do not trust a copied is_private flag alone.
3. **R04.3:** Revalidate entity references on reads and writes; separate personal preference endpoints from owner/admin household policy; protect private recurring and goal link mutations.

**Data/migration contract:** Review legacy ownership/privacy conflicts and quarantine ambiguous rows; default exclusion; no automatic broadened disclosure.

**Independent acceptance oracle:** Owner/member/viewer/Professional/outsider cross-product: no hidden markers or amounts, no unauthorized DB mutation; foreign goal activity 404; view-only shared preference write 403.

**Focused verification:** `npm run test:server:run -- modules/goals/__tests__/completion-r04.realdb.integration.test.ts`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R04/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r04): complete visibility and capability enforcement`.

**Reproduced call sites to inspect first:** `server/modules/goals/goals.controller.ts`, `server/modules/goals/goals.extra.controller.ts`, `server/services/TransactionGoalLinkService.ts`, `server/repositories/TagRepository.ts`, `server/repositories/RecurringRepository.ts`, then their query delegates. Extend this to account export, investment transactions/valuation, weekly recap and AI tools.

**Concrete repair contract:** Membership AND operation capability AND containing-account visibility AND transaction visibility are separate requirements. Test mismatched account/transaction owners and a private account with an explicitly public transaction flag. Do not copy account privacy into a transaction on create or in a backfill. Related counts and export record counts obey the same predicate. Unknown-role tests inject at a controlled boundary seam rather than persisting a value forbidden by the database enum.

**Additional acceptance:** Every tested denied mutation leaves a DB snapshot unchanged. Include a positive authorized control for every route. Professional/view_only may manage personal settings and request personal privacy export, but cannot create financial export jobs; do not blanket-deny all POST/PUT operations merely because the role is read-only for money.

<a id="r05"></a>
#### R05 — Persistent settings and shared views

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 4–7 days. **Completion dependencies:** R03, R04.
**Primary register rows:** AH-07, NEW-11, NEW-16, NEW-26. **Supporting:** AH-01, AH-09, AH-10, AH-13, NEW-28, NEW-31, NEW-37.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/modules/settings/settings.routes.ts`
- Modify as needed: `server/modules/settings/settings.controller.ts`
- Modify as needed: `server/modules/settings/settings.validation.ts`
- Modify as needed: `server/routes/settings.report-widgets.ts`
- Modify as needed: `client/src/pages/settings/SettingsLayout.tsx`
- Proposed test: `server/modules/settings/__tests__/completion-r05.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R05.1:** Build UI/API/storage field inventory, including null clearing, independent recap/widget settings and per-user preferences.
2. **R05.2:** Implement named saved shared views as filters over already authorized data; support Mine/Shared/All defaults, reset defaults and truthful member/role state.
3. **R05.3:** Freeze household currency after financial activity; add explicit conflict response; remove fictitious commercial claims without removing advertised settings functionality.

**Data/migration contract:** Add versioned per-user preferences/view configuration if existing schema cannot express it; minimize sensitive fields and await OI-04 retention parameters before real-user rollout.

**Independent acceptance oracle:** Each offered field saves, reads back and survives reload; clearing works; another user's preferences untouched; shared views never grant access; currency change with history 409.

**Focused verification:** `npm run test:server:run -- modules/settings/__tests__/completion-r05.realdb.integration.test.ts`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R05/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r05): persistent settings and shared views`.

**Concrete repair contract:** Map every displayed profile field to a typed approved writer/reader, null-clearing semantics and its retention/minimization decision. Separate personal preferences from household policy. Notification preference partial updates preserve omitted thresholds, explicit null clears, and notificationType is an allowlisted enum. Widget changes must not overwrite recap settings; recap day is not first-day-of-week.

Implement named household shared views with name, validated filter payload, household scope, creator/updater and version. Owner/admin manage; every authorized member can apply; filters only narrow existing visibility. A shared view grants no extra data access. Preserve personal Shared/Mine/All selections separately. Remove fictional premium claims, not functioning scope.

**Additional acceptance:** Save every form, reload from server and verify DB. Test member personal preference200/household policy403, stale-version409, threshold250.50 surviving a partial emailEnabled change, and no private-data disclosure through saved views. Household currency changes with existing financial history require an explicit supported reconciliation policy, otherwise409.

<a id="r06"></a>
#### R06 — MFA management and security policy

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 2–4 days. **Completion dependencies:** R01, R02, R05.
**Primary register rows:** AH-11. **Supporting:** AH-12.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/routes/security.mfa.ts`
- Modify as needed: `server/routes/security.mfa.login.ts`
- Modify as needed: `server/routes/security.mfa.stepup.ts`
- Modify as needed: `server/modules/auth/auth.mfa-policy.ts`
- Modify as needed: `client/src/pages/settings/sections/SecuritySection/index.tsx`
- Proposed test: `server/modules/auth/__tests__/completion-r06.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R06.1:** Add enroll/verify/backup/regenerate/disable UI and recovery behavior using existing endpoints.
2. **R06.2:** Enforce household mandatory-MFA policy against existing sessions using policy version; expose restricted enrollment state rather than lockout loops.
3. **R06.3:** Require recent step-up for sensitive management; normalize any high-value threshold in household currency; retain existing financial step-up until a configured replacement is proved.

**Data/migration contract:** Store policy version/enrollment state additively if needed; hash recovery material and show raw backup codes only at generation.

**Independent acceptance oracle:** Enable then login with code; backup reuse fails; regeneration invalidates old codes; policy change restricts old session; provider outage yields safe recovery state.

**Focused verification:** `npm run test:server:run -- modules/auth/__tests__/completion-r06.realdb.integration.test.ts`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R06/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r06): mfa management and security policy`.

**Concrete repair contract:** MFA enrollment has pending challenge then verified active states. Recent step-up plus possession proof is required before mfaEnabled or active recovery codes appear; challenge creation alone is insufficient. Show recovery codes once after activation; regeneration invalidates previous codes atomically. Factor replacement preserves a viable recovery path. Disable requires appropriate step-up and audit.

When policy is mandatory, noncompliant existing sessions are restricted to enrollment/recovery immediately under policy-version checks; do not silently permit financial operations for an invented24-hour grace period. Preserve current verified financial step-up policy until a replacement threshold is explicitly configured.5,000 and24hours from historical drafts are not production defaults.

**Additional acceptance:** Pending enrollment cannot use recovery codes; failed proof leaves disabled state; code replay and concurrent regeneration covered; mandatory owner/admin enrollment enforced on API and UI; missing FX cannot bypass configured step-up.

<a id="r07"></a>
#### R07 — Self-service export, leave and erasure

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 5–8 days. **Completion dependencies:** R01, R03, R04, R05, R19.
**Primary register rows:** AH-08. **Supporting:** NEW-32.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/modules/settings/settings.account.controller.ts`
- Modify as needed: `server/modules/settings/settings.account-deletion.service.ts`
- Modify as needed: `server/modules/settings/settings.account-deletion.files.ts`
- Modify as needed: `server/modules/reports/reports.export.service.ts`
- Modify as needed: `shared/schema.ts`
- Proposed test: `server/modules/settings/__tests__/completion-r07.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R07.1:** Implement durable export jobs with authorized manifests/download/expiry and a discoverable self-service UI.
2. **R07.2:** Define deletion state machine for household-free, last-owner and shared-member cases; revoke identity first, then delete/pseudonymize rows and files with retries.
3. **R07.3:** Retain other members' legitimate shared financial history with pseudonymous attribution; enforce deletion markers on backup restoration; complete security notices without sensitive payloads.

**Data/migration contract:** Add durable export/erasure job state and manifests; retention/legal holds supplied via OI-04; never infer a statutory retention duration.

**Independent acceptance oracle:** Export visible-only row counts and money reconcile; interrupted/retried erasure completes; stale cookies/tokens/files fail; remaining household audit survives; restoring backup reapplies erasures.

**Focused verification:** `npm run test:server:run -- modules/settings/__tests__/completion-r07.realdb.integration.test.ts`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R07/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r07): self-service export, leave and erasure`.

**Concrete repair contract:** Preserve the existing /api/settings/account/export and /api/settings/account/delete entrypoints and extend them to durable jobs; do not introduce an unrelated /privacy/export route without a compatibility decision. Export the actor's approved subject/visible data, minimize secret fields, and include a versioned manifest, scoped counts, hash and expiry. Download rechecks current membership/visibility.

Erasure states cover no household, shared member, transferring final owner and sole owner deleting the household. Revoke identity before purge; prevent new writes while deleting; retain required shared records with pseudonymous attribution and approved retention. File cleanup is retryable. Backup restoration must replay erasure markers before serving traffic.

**Additional acceptance:** Request/status/download/expiry through the UI; revoked member cannot retrieve a previously generated archive. Retry after partial file deletion; other members' data preserved; stale cookies/tokens/download URLs denied; audit does not retain unnecessary erased identifiers. No claim of legal compliance without OI-04.

<a id="r08"></a>
#### R08 — Ledger invariants across every writer

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 6–9 days. **Completion dependencies:** R04.
**Primary register rows:** FIN-05, FIN-08, FIN-13, FIN-17, ORG-005, FIN-16, NEW-05, NEW-28, NEW-32, NEW-35. **Supporting:** NEW-03, NEW-18, NEW-24.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/services/transaction/create.ts`
- Modify as needed: `server/services/transaction/service.ts`
- Modify as needed: `server/services/transaction/delete.ts`
- Modify as needed: `server/repositories/TransactionRepository.ts`
- Modify as needed: `server/services/TransferService.ts`
- Modify as needed: `server/services/account/AccountCoreService.ts`
- Proposed test: `server/modules/transactions/__tests__/completion-r08.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R08.1:** Write independent asset/liability/create/edit/delete/split/transfer oracles with concurrent writers.
2. **R08.2:** Centralize signed account effects, immutable source currency, allocation validation and ordered locks; all producers use one transaction executor for financial effects and audit/outbox.
3. **R08.3:** Freeze denomination/type/opening balance after activity except an explicit reconciled adjustment; make retries idempotent and invalidate cache dependencies after commit.

**Data/migration contract:** Backfill null currencies only with proven denomination history; produce review list for ambiguous rows. Preserve original values and migration provenance; never blindly recompute all balances.

**Independent acceptance oracle:** Asset 1000+200-125.50=1074.50; card debt 500+45.50=545.50; transfer has two legs; split100=60+40; edit/delete reverses dependent effects without drift.

**Focused verification:** `npm run test:server:run -- modules/transactions/__tests__/completion-r08.realdb.integration.test.ts`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R08/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r08): ledger invariants across every writer`.

**Concrete repair contract:** Apply the same posting contract to manual, recurring, import, receipt, rule, investment and GRZ writers. Derive currency from the locked account; reject mismatches; migrate null currency only from unambiguous historical denomination. Source currency, account economic class and opening balance cannot be casually changed beneath posted history.

Use ordered account/entity locks, idempotent operation identity, version/conflict checks and one transaction executor. Update splits, goal links, balances, audit and outbox atomically. Revalidate parent edits and require valid replacement splits; failure halfway rolls everything back. Liability balance is positive debt: a45.50 purchase on500 debt yields545.50, never454.50.

**Additional acceptance:** Throw during audit insertion and observe no partial financial commit. Replay after a lost response leaves one effect. Summary/list/server caches and client queries reflect committed writes immediately under revision/revalidation policy. Dates and timestamps use their distinct types; do not blindly reinterpret historical naive timestamps.

<a id="r09"></a>
#### R09 — One correct import/export workflow

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 4–6 days. **Completion dependencies:** R08.
**Primary register rows:** FIN-02, FIN-03, FIN-04, FIN-15, NEW-17. **Supporting:** NEW-14.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/services/ImportService.ts`
- Modify as needed: `server/services/account/AccountImportService.ts`
- Modify as needed: `server/services/account/AccountExportService.ts`
- Modify as needed: `server/routes/import.ts`
- Modify as needed: `shared/schema.ts`
- Proposed test: `server/modules/accounts/__tests__/completion-r09.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R09.1:** Build global and account-detail fixtures for overwrite, transfer conflicts, sign, UUID, invalid date and duplicate occurrence cases.
2. **R09.2:** Use immutable import batch/row identity and explicit preview; preserve two legitimate identical purchases; reject replacement sets that intersect transfers until a pair-safe operation is chosen.
3. **R09.3:** Commit replacement and ledger effects atomically; preserve Notes/date mapping; persist import history and per-row outcomes; reconcile exported signed values and split detail.

**Data/migration contract:** Add batch identity/row ordinal/fingerprint and mapping version where absent; never repurpose soft-deleted transaction idempotency keys as a blanket skip rule.

**Independent acceptance oracle:** Exact batch replay no new effects; overwrite repeated stable; same-day equal purchases both retained; Feb30 rejected; ambiguous slash date needs chosen format; no partial pair deletion.

**Focused verification:** `npm run test:server:run -- modules/accounts/__tests__/completion-r09.realdb.integration.test.ts`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R09/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r09): one correct import/export workflow`.

**Concrete repair contract:** One shared import engine serves both global and account-detail UI entrances. Preview includes explicit date format, account/currency, sign semantics, mapping version, Notes, duplicate candidates, transfer conflicts and balance option. Identity is scoped to account and source reference, or file/batch fingerprint plus mapping version and row ordinal/occurrence. Changed payload under the same request identity409.

Overwrite locks its affected rows/versions and accounts, previews transfer intersections and rejects until a reviewed pair-preserving resolution is chosen. Never soft-delete rows and then dedupe-skip replacements. Record data_imports/import-batch history with honest created/updated/skipped/rejected counts. Keep both advertised balance-adjustment modes with explicit expected results.

**Owner policy clarification, 31 October 2026:** History imported with balance updates off remains balance-neutral through later edits and deletions. For example, importing expense10 with this option off leaves account100, and deleting that imported expense still leaves100. Persist and reverse the actual recorded account effects; do not silently rewrite frozen opening balances or introduce an initial offset. Changing the posting mode requires the existing explicit previewed/audited reconciliation boundary. Historical baseline dates must still be supported by provenance. This clarification closes a policy question only; it supplies no implementation or acceptance evidence. See `docs/reviews/completion-v2-evidence/R08/IMPORT-LEDGER-CONTRACT-DECISION.md` for the recorded answer and future oracles.

**Additional acceptance:** Two fully identical purchases within one file both survive; exact file replay is idempotent; overlapping files require reviewed candidates; concurrent identical requests have one effect. Reject February30, retain Notes, preserve both transfer legs on rollback and overwrite, and escape spreadsheet formulas on export.

<a id="r10"></a>
#### R10 — Budgets and reversible goals

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 4–7 days. **Completion dependencies:** R08, R12.
**Primary register rows:** FIN-06, FIN-07, FIN-09, NEW-29. **Supporting:** FIN-05, NEW-16.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/repositories/BudgetSpendRepository.ts`
- Modify as needed: `server/services/budget/BudgetRecalculationService.ts`
- Modify as needed: `server/services/TransactionGoalLinkService.ts`
- Modify as needed: `server/services/GoalAccountAssignmentService.ts`
- Modify as needed: `server/modules/goals/goals.validation.ts`
- Proposed test: `server/modules/goals/__tests__/completion-r10.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R10.1:** Count authorized split/refund/posting activity with historical FX; preview historical averages and preserve manual budgets.
2. **R10.2:** Expose working rollover preference and audit batch identity; preserve period uniqueness and closing balance across retries.
3. **R10.3:** Make contributions, links, assignments and their reversals explicit; prevent double counting assigned balances plus links; distinguish progress-only records from real transfers; enforce bounded valid amounts and correction UI.

**Data/migration contract:** Record goal progress provenance and correction links; no silent clamping that prevents exact reversal; report legacy ambiguous progress for reconciliation.

**Independent acceptance oracle:** 550/3 shows183.33; 450 unspent carries once; link/unlink restores prior progress; edit/delete reverses; two concurrent contributions reconcile; no irreversible mistaken contribution.

**Focused verification:** `npm run test:server:run -- modules/goals/__tests__/completion-r10.realdb.integration.test.ts`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R10/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r10): budgets and reversible goals`.

**Concrete repair contract:** Budget spend uses authorized posted/refund/split flows and dated FX. Historical averages divide by elapsed selected periods including legitimate zero months, exclude future months, preview before overwriting manual values, and use valid UUID batch audit identity. Rollover policy is writable by authorized household managers and carries a period once. A budget cannot transfer to itself.

Keep goal manual contribution, actual cash transfer, linked allocation and account tracking distinct. Persist effective deltas/source identity so edit/delete/unlink reverses exactly. Target overfunding may be intentional and requires confirmation; available-cash limits apply only to actual cash movement. Set explicit money-format/range bounds, not arbitrary loss of valid progress. Partial assignment defaults must be internally valid; forecast dates use calendar months and completed remaining time0.

**Additional acceptance:**550 over3months ->183.33 suggestion; manual Dining500 untouched without confirmation; rollover450 once. Goal progress5 plus allocation10 ->15 then unlink ->5, even across edits/races. Invalid partial default, repeated unlink, self-budget move and missing rate tested.

<a id="r11"></a>
#### R11 — Rules, tags, merchants and saved organization

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 4–7 days. **Completion dependencies:** R04, R08.
**Primary register rows:** ORG-004, ORG-006, ORG-007, ORG-008, ORG-009, ORG-010, NEW-09, NEW-19, NEW-27, NEW-36. **Supporting:** ORG-003, ORG-005.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/services/rule/actions.ts`
- Modify as needed: `server/services/rule/service.ts`
- Modify as needed: `server/modules/rules/rules.controller.ts`
- Modify as needed: `server/repositories/TagRepository.ts`
- Modify as needed: `server/modules/merchants/merchants.routes.ts`
- Modify as needed: `server/modules/filter-presets/filter-presets.service.ts`
- Proposed test: `server/modules/rules/__tests__/completion-r11.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R11.1:** Separate pure rule planning from effect execution; validate references at authoring and execution and include all actions in preview.
2. **R11.2:** Repair tag merge, canonical names/counts, repeated removal; implement missing merchant detail/alias/logo/test routes and accurate archive/delete/undo behavior.
3. **R11.3:** Apply saved default presets; respect includeArchived; fix category picker contract and ownership selector; provide idempotent seeding and useful uncategorized state.

**Data/migration contract:** Preflight cross-household rules and duplicate tags before scoped uniqueness; preserve original IDs in migration map and audit actual affected rows.

**Independent acceptance oracle:** Dry-run tag/alias/split snapshots unchanged; foreign IDs rejected and legacy rules quarantined;60+60 split rejected; merge/undo preserves actual row counts; every merchant control persists.

**Focused verification:** `npm run test:server:run -- modules/rules/__tests__/completion-r11.realdb.integration.test.ts`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R11/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r11): rules, tags, merchants and saved organization`.

**Concrete repair contract:** Rule action schemas validate references on authoring and execution against actor/household visibility. Quarantine legacy foreign-reference rules with an exception report. All dry-run/preview/Test paths call a pure planner for category, owner, merchant, alias, tag and split actions; no writes to tags/counts/aliases/splits/audit-financial state. The explicit executor applies validated effects under the common mutation contract.

Complete merchant detail/analytics/transactions/alias/logo and delete/archive/merge/undo semantics. Atomic undo claims history and updates counts from actual restored rows, not stale snapshots. Tag normalization/scoped uniqueness needs reviewed dedupe before constraint creation; repeated removal cannot decrement twice. Group archive and includeArchived agree across API/UI. Implement preset create/delete/default application and rule Test rather than removing their controls.

**Additional acceptance:** Full-table hashes identical after every dry-run action; foreign category/tag/member/split IDs denied;60/60 split rejected. Undo after intervening changes has a declared conflict/result; default preset applies on navigation but does not overwrite explicit URL filters.

<a id="r12"></a>
#### R12 — FX ownership and reconciled reports

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 5–8 days. **Completion dependencies:** R04, R08.
**Primary register rows:** FIN-18, NEW-02, NEW-06, NEW-13, NEW-14, NEW-15, NEW-34. **Supporting:** FIN-05, FIN-14, FIN-17, NEW-21, NEW-22, NEW-35.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/repositories/reports/AnalyticsRatiosRepository.ts`
- Modify as needed: `server/repositories/reports/fxRateExpr.ts`
- Modify as needed: `server/repositories/reports/CashflowReportRepository.ts`
- Modify as needed: `server/repositories/reports/TransactionReportRepository.ts`
- Modify as needed: `server/services/account/AccountReportingService.ts`
- Modify as needed: `server/modules/investments/investments.fx.controller.ts`
- Proposed test: `server/modules/reports/__tests__/completion-r12.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R12.1:** Separate read-only global market data from household overrides; owner/admin edit only own override with immutable provenance.
2. **R12.2:** Unify dated-flow and as-of valuation policies, splits/card spend/refunds/Uncategorized/Unassigned, money DTOs and rounding; propagate incomplete FX explicitly.
3. **R12.3:** Repair both cache families, client invalidation, local dates/chart labels/quarter grouping and historical net-worth/recap semantics; mark snapshots without inventing history.

**Data/migration contract:** Add household-scoped FX/security override identity, precision and validity metadata; quarantine ambiguous legacy global manual rows rather than assigning them arbitrarily.

**Independent acceptance oracle:** ZMW100+USD10@20=300; USD75@26.5=1987.50; foreign rate write cannot change another household; all comparable report totals foot; immediate summary sees write; missing FX422 or explicit incomplete valuation.

**Focused verification:** `npm run test:server:run -- modules/reports/__tests__/completion-r12.realdb.integration.test.ts`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R12/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r12): fx ownership and reconciled reports`.

**Concrete repair contract:** Global FX/security reference rows are service-written; owner/admin may maintain household-local overrides with provenance and dated uniqueness, while ordinary members read only. Do not assign old global manual data to a household by guesswork. Flow rates use dates; balance valuation uses as-of rates. Missing/stale FX yields typed422 for operations requiring completeness, or complete=false with missing components for analytical views.

A common split contribution helper feeds reports, budgets, Sankey and CSV without counting the parent twice or dropping children. Card purchases are expense; repayment is not another expense. Unassigned merchants and Uncategorized are explicit buckets. Period DTOs carry periodStart independently of labels. Net-worth history requires actual historical evidence or an incomplete/snapshot-only label.

**Additional acceptance:** USD75 at26.50 ->1987.50; USD10 historical rate20 ->200 flow while later valuation26.50 ->265 asset. Another household's override cannot change either. Equal actor/filter/period definitions reconcile across dashboard/summary/cashflow/annual/CSV; twelve months remain distinct.

<a id="r13"></a>
#### R13 — Investment, pension and GRZ lifecycle

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 7–11 days. **Completion dependencies:** R08, R12, R14.
**Primary register rows:** FIN-10, FIN-11, FIN-12, FIN-14, NEW-03, NEW-04, NEW-20, NEW-21, NEW-22, NEW-23, NEW-24, NEW-25. **Supporting:** NEW-35.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/routes/grz-securities.ts`
- Modify as needed: `server/services/grz-service.ts`
- Modify as needed: `server/services/investment/processDueInvestments.ts`
- Modify as needed: `server/services/investment/processTBillMaturities.ts`
- Modify as needed: `server/modules/investments/investments.service.ts`
- Modify as needed: `client/src/pages/Investments.tsx`
- Proposed test: `server/modules/investments/__tests__/completion-r13.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R13.1:** Implement lots/basis and positive-quantity constraints for manual/automated/opening holdings; compute currency conversions and validate pension contributions.
2. **R13.2:** Preserve record-only purchase entry; implement asset-to-cash settlement linkage, disposal basis and principal-versus-income classification under section 2; block payable rows after disposal.
3. **R13.3:** Validate dates/rates/fees/zero-interest maturity; persist calculation convention and approved withholding version; reconcile tax exports and local year boundaries; expose all tabs without equity holdings.

**Data/migration contract:** Introduce settlement/provenance links and versioned policy fields where needed; migrate legacy payments via reconciliation report, never automatic duplicate credits; OI-03 blocks real tax-labelled outputs until verified.

**Independent acceptance oracle:** Two equal-price buys have no invented gain; negative sell400; sale consumes FIFO lots; sold bond pay409; principal not ordinary income; zero-interest bill matures; actual cash receipt linked once; tax counts Dec31 once.

**Focused verification:** `npm run test:server:run -- modules/investments/__tests__/completion-r13.realdb.integration.test.ts`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R13/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r13): investment, pension and grz lifecycle`.

**Concrete repair contract:** Every supported opening/manual/automated buy has auditable quantity and lot/basis provenance; sell locks holding and lots and validates positive available quantity. FIFO disposal records basis, proceeds, fees, currency/rate and gain separately. Pension total equals employee plus employer; record whether cash actually moved. SIP catch-up uses the durable scheduler.

GRZ creation remains record-only. Settlement validates state, due entitlement and an authorized compatible-currency destination; link an existing matching cash receipt or post one settlement, retire the holding, and prevent reuse by an import/manual flow. Cost basis, pre-settlement carrying value and face/proceeds are different amounts. For carrying1000 and receipt1000, net worth is unchanged; for carrying950 explain the50 valuation/realization change. Principal is not ordinary income, and gain is not a second cash receipt.

**Zambian fixed-rate bond valuation before redemption (2 November 2026).** For each visible holding, retain nominal principal, documented acquisition basis and dated ZMW market value separately. A K950 purchase and K1,000 nominal give no subsequent market value by themselves. Accept an attributable same-issue trade, price quote or custodian valuation on the valuation date. Record ISIN, source/reference, date, currency, price basis and amount units. Scale a dirty quote per K100 by nominal/100. For a clean quote add evidenced accrued interest in matching units exactly once. A dated same-issue market yield can support an explicitly labelled model value when contractual coupon dates, remaining entitlements, redemption and the applicable convention are evidenced. A reopened bond retains its issue schedule. A benchmark yield, old auction, purchase yield or custody statement listing nominal alone cannot supply today's value. If evidence is absent, show the holding as unvalued and identify incomplete net worth. Keep a historical mark dated. A what-if calculator result cannot establish a booked value. The three-day FX rule does not apply to bonds. [BoZ market practices, secondary-market pricing](https://www.boz.zm/RULES-AND-MARKET-PRACTICES-OF-THE-GRZ-SECURITIES-MARKET-REV.pdf) · [BoZ explanation of reopened bonds and accrued coupon](https://www.boz.zm/Zambanker_December_2021.pdf)

**Settlement acceptance.** Separate any coupon included in the carrying value before reconciling principal. Transfer the evidenced principal receipt to cash once, close the principal holding and reconcile separately paid coupons and fees. With K950 evidenced principal basis, K1,000 redemption and no fees, the principal gain is K50. If K950 included purchased interest or charges, separate those components before reporting gain. Demonstrate a clean quote plus interest equals the corresponding dirty quote, and a missing coupon breakdown never creates a second interest asset or income receipt. BoZ's cum-interest worked example gives K2.51 per K100 at 20% for 46 of 183 days. Use actual issue terms for stubs and entitlement dates. Real tax and settlement-policy sign-off stays under OI-03.

**Additional acceptance:** Sale/pay race has one valid outcome; sold/cancelled entitlements cannot pay; zero-interest maturity succeeds; negative quantities/rates and unsupported dates rejected. Real tax/WHT/day-count and rollover terms require OI-03;15% is synthetic only. GRZ/tax/pension tabs remain reachable without an equity holding.

<a id="r14"></a>
#### R14 — Durable recurring and scheduled jobs

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 4–6 days. **Completion dependencies:** R08, R19.
**Primary register rows:** OPS-003, OPS-013, NEW-10, NEW-30. **Supporting:** FIN-11, FIN-12, NEW-16, NEW-33.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/routes/cron.ts`
- Modify as needed: `server/services/recurring/RecurringProcessingService.ts`
- Modify as needed: `server/services/recurring/materializationKey.ts`
- Modify as needed: `server/services/investment/investmentCronKeys.ts`
- Modify as needed: `server/modules/recurring/recurring.controller.ts`
- Proposed test: `server/modules/recurring/__tests__/completion-r14.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R14.1:** Wire recurring form required fields and errors; preserve monthly anchor, timezone, end/pause and bounded catch-up semantics.
2. **R14.2:** Create registry and durable due-item identity, lease fencing, retries and run history for every financial and notification job.
3. **R14.3:** Connect declared scheduler, authenticated cron and receipt/outbox workers; repair detection endpoint; expose operator stale/failure indicators.

**Data/migration contract:** Add unique(job,household,dueIdentity), claim generation/lease/state/outcome; DB uniqueness is authority, Redis cache expiry is not.

**Independent acceptance oracle:** Aug31->Sep30->Oct31; three missed periods caught up once each; no future member-forced posting; two workers and restart yield one financial effect; scheduled staging ticks observed.

**Focused verification:** `npm run test:server:run -- modules/recurring/__tests__/completion-r14.realdb.integration.test.ts`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R14/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r14): durable recurring and scheduled jobs`.

**Concrete repair contract:** Implement PostgreSQL due-item/run identity with unique keys, claims, lease expiry/heartbeat, monotonically advancing fencing generation and checkpoints. Financial commits verify current fence inside the transaction; stale workers cannot commit after reclamation. Effect identity prevents a crash-after-commit retry from duplicating money. External send uncertainty remains a separate state.

Inventory recurring, budget rollover/alerts, goals, snapshots, FX/market, investments/GRZ, outbox, receipt matcher, recap and cleanup. Store trigger, timezone, catch-up policy, max attempts, owner and last-success/lag. Catch-up processes at most100 due items per invocation and reschedules the remainder. Monthly anchor31 ->30September ->31October. Reject unauthorized future asOfDate.

**Additional acceptance:** Two workers, expired lease, late stale commit, crash before/after effect, three missed periods, backlog>100, pause/end-date and date-boundary tests. R19 environment foundation can precede the registry; closure needs actual external scheduled triggers, not just a manually called endpoint.

<a id="r15"></a>
#### R15 — Durable receipts and OCR

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 3–5 days. **Completion dependencies:** R08, R14, R19.
**Primary register rows:** OPS-001, OPS-004, NEW-18. **Supporting:** ORG-006, NEW-39.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/modules/receipts/receipts.controller.ts`
- Modify as needed: `server/modules/receipts/receipts.service.ts`
- Modify as needed: `server/repositories/ReceiptRepository.ts`
- Modify as needed: `server/services/ReceiptService.ts`
- Modify as needed: `server/middleware/uploadsAuth.ts`
- Proposed test: `server/modules/receipts/__tests__/completion-r15.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R15.1:** Self-host/pin OCR worker assets compatible with production CSP; exercise real upload/scan/correct/match UI.
2. **R15.2:** Make receipt-to-ledger one atomic idempotent transition; reject nonpositive amount and cross-household match; retry same request returns original result.
3. **R15.3:** Move files under durable storage manifest and safe authenticated retrieval; remove server paths from DTO; support deletion/restart/restore and legacy file migration.

**Data/migration contract:** Add receipt version/idempotency and durable storage object metadata if absent; pending-file state handles DB/object failures without false success.

**Independent acceptance oracle:** Second create produces no second charge; negative amount400; corrected OCR persists; unauthorized file denied; restart and restore retain valid files; abandoned uploads cleaned safely.

**Focused verification:** `npm run test:server:run -- modules/receipts/__tests__/completion-r15.realdb.integration.test.ts`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R15/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r15): durable receipts and ocr`.

**Concrete repair contract:** Receipt files use scoped opaque storage identity and authenticated access; no absolute server paths in DTOs. Pin/self-host OCR workers/WASM or use an explicitly designed server worker compatible with production CSP. Parsed output is a proposal requiring review; validate money before posting.

Conversion locks receipt and binds request fingerprint to its transaction. Identical retry returns the existing transaction/result; conflicting retry409. The matcher links a later authorized transaction exactly once and uses R14 scheduling for final workflow closure. Delete preserves appropriate financial/audit history and retries storage cleanup safely.

**Additional acceptance:** Upload -> OCR -> correct -> match/create -> lost-response retry -> reload -> delete on desktop/phone. One ledger row under concurrent conversion; negative amount rejected; later match observed; unauthorized download404; redeploy and restore preserve file hash. Test CSP in production mode, not a development-only scan.

<a id="r16"></a>
#### R16 — Notifications, push and weekly recap

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 3–5 days. **Completion dependencies:** R04, R12, R14, R19.
**Primary register rows:** OPS-008, OPS-006, OPS-009, OPS-010, OPS-007, NEW-31, NEW-38. **Supporting:** OPS-005.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/services/NotificationService.ts`
- Modify as needed: `server/services/notification/push.ts`
- Modify as needed: `server/modules/notifications/notifications.controller.ts`
- Modify as needed: `server/modules/weekly-recap/weekly-recap.service.ts`
- Modify as needed: `server/modules/weekly-recap/weekly-recap.email.service.ts`
- Proposed test: `server/modules/notifications/__tests__/completion-r16.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R16.1:** Validate push destinations against known service origins and safe resolved addresses; enforce bounded egress without real SSRF probes.
2. **R16.2:** Implement per-channel status/idempotence/retry and preferences/quiet hours; escape templates; emit security change notices without login noise.
3. **R16.3:** Make recap viewer-aware and period-exact; honor flags/consent, correct currencies, store period snapshots and display explicit incomplete data.

**Data/migration contract:** Add unique delivery identity and outcome rows, retry scheduling and recap snapshot version; store no sensitive financial bodies in logs.

**Independent acceptance oracle:** Email failure plus push success stays distinguishable; retry does not duplicate; private recurring markers absent; seven-day period exact; historical recap never substitutes current net worth.

**Focused verification:** `npm run test:server:run -- modules/notifications/__tests__/completion-r16.realdb.integration.test.ts`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R16/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r16): notifications, push and weekly recap`.

**Concrete repair contract:** Push URL validation covers allowlisted service origin, credentials/port restrictions, DNS/IP resolution, redirect policy and bounded connection time. Test via controlled resolvers/transports. Missing VAPID returns truthful unavailable/not-configured state, not500. Escape user strings in every notification/invitation email.

Delivery has per-event/recipient/channel identity and pending/sent/failed/unknown/suppressed states. Confirmed failures may retry; unknown must reconcile or use provider idempotency, not blindly resend. Persist configurable quiet hours with timezone/cross-midnight handling. Recap uses recipient visibility,7local dates, chosen sections, correct currency and historical data; missing FX is explicit. Feedback persists structured/queryable subject identity and replay handling. Counters count actual new deliveries/records.

**Additional acceptance:** One channel succeeds and another fails -> only failed channel retry; lost acknowledgment ->unknown; deduped retry sends/counts0 new items; feedback survives reload/query; private recurring marker absent; thresholds preserved by partial updates. Quiet-hours UI is an explicitly included completion enhancement.

<a id="r17"></a>
#### R17 — Thandi Claude primary and Gemini fallback

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 5–8 days. **Completion dependencies:** R04, R05, R12, R19.
**Primary register rows:** OPS-012. **Supporting:** none.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/modules/ai/ai.service.ts`
- Modify as needed: `server/modules/ai/ai.gemini.ts`
- Modify as needed: `server/modules/ai/ai.fallback.ts`
- Modify as needed: `server/modules/ai/ai.controller.ts`
- Modify as needed: `server/modules/ai/ai.conversation.repository.ts`
- Modify as needed: `shared/schema.ts`
- Proposed test: `server/modules/ai/__tests__/completion-r17.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R17.1:** Implement canonical provider contracts, direct Claude adapter and configured Gemini adapter with truthful provenance and stage-aware orchestration.
2. **R17.2:** Version both-provider household consent and owner/admin controls; preserve authorized tools, sanitization/history privacy and deterministic calculations.
3. **R17.3:** Implement durable request/attempt/budget ledger and cancellation; use bounded eligible failover then labelled local mode; add mocks/evaluation and controlled paid smoke after OI-02.

**Data/migration contract:** New durable AI request, attempt, reservation and consent version records under schema contracts in section 3; never rely on evictable Redis counters as spending authority.

**Independent acceptance oracle:** At most3 paid attempts, one final conversation result; failure/unknown cost audited; two requests at last budget unit admit only one; revoked consent prevents fallback; forced Claude failure reaches Gemini; both fail gives labelled useful local result or unavailable.

**Focused verification:** `npm run test:server:run -- modules/ai/__tests__/completion-r17.realdb.integration.test.ts`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R17/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r17): thandi claude primary and gemini fallback`.

**Concrete repair contract:** Implement AI-01–AI-16 in section3 as mandatory subrequirements of OPS-012; no partial closure based only on a successful Claude response. Preserve existing conversations, sanitization, deterministic tools and financial query semantics. Canonical tool JSON schema maps into each provider adapter; no provider-native thinking/signature blocks cross to the other provider.

Add direct Anthropic transport, configurable Gemini transport, durable admission/reservation repository and a bounded stage orchestrator. SDK retries are zero under the initial three-call limit. Use actual usage with dated prices and independent credit/budget accounting; unknown costs remain held. Both-provider household consent and current actor capability are checked before every new outbound attempt.

**Additional acceptance:**20–30 deterministic evaluation prompts cover correct tool selection/amounts, privacy, refusal, missing data and provider failures. Mock CI never calls paid APIs. Test Claude success, eligible Claude analysis failure ->Gemini analysis/answer, Claude answer failure ->Gemini answer without rerunning tools, both-fail/no-key local outcome, cancellation, replay, last-budget race and credit expiry. Real smoke only under OI-02.

<a id="r18"></a>
#### R18 — Complete UX, accessibility and date display

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 4–6 days. **Completion dependencies:** R02, R03, R05.
**Primary register rows:** UX-02, NEW-37. **Supporting:** UX-01, NEW-09, NEW-10, NEW-11, NEW-15, NEW-25, NEW-27, NEW-33.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `client/src/App.tsx`
- Modify as needed: `client/src/pages/Investments.tsx`
- Modify as needed: `client/src/pages/settings/SettingsLayout.tsx`
- Modify as needed: `client/src/features/accounts/components/AccountFilters.tsx`
- Modify as needed: `client/src/features/recurring/components/RecurringEditModal.tsx`
- Proposed test: `e2e/completion-r18.spec.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R18.1:** Fix mobile navigation/clipping, empty/default-filter states and first-run guidance; submit every visible workflow and surface validation.
2. **R18.2:** Implement functional offered copy/reset/navigation controls and truthful greetings/transfer attribution; remove only fictional commercial claims.
3. **R18.3:** Standardize dates/locale/decimal display, keyboard/focus/labels/error announcements,320px/200%zoom and loading/error/retry/offline states.

**Data/migration contract:** Per-user display defaults migrate without overwriting existing choices; no financial changes via presentation conversion.

**Independent acceptance oracle:** Every offered control has an observable result; no unexplained first-run toast cascade; keyboard/screen-reader journeys complete; real phone and browser matrix recorded.

**Focused verification:** `npx playwright test --config playwright.production.config.ts e2e/completion-r18.spec.ts --project=chromium`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R18/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r18): complete ux, accessibility and date display`.

**Concrete repair contract:** Complete offered controls, meaningful empty/loading/error/retry states and confirmation workflows. Remove only fictional commercial claims or duplicate presentation, not required capabilities. Keep individual correction/archive/delete actions for transactions, budgets, goals and holdings under the financial lifecycle contract; no button may erase settled cash history.

Test320,360,375,390,768px widths and report layouts at1280px; navigation becomes a usable drawer with focus handling.200% zoom, reduced motion, visible focus, labelled icon buttons, associated form errors and chart data alternatives must work. First-run category/account pickers and investment tabs must not hide valid data.

**Additional acceptance:** Keyboard and screen-reader primary journeys plus real phone evidence; no clipped heading or inaccessible action; actual submit/result persistence, not screenshots alone. Axe has no unresolved critical/serious findings and manual checks cover behavior automated tools cannot prove.

<a id="r19"></a>
#### R19 — Deployable operations, storage and recovery

**Owner:** `r00_runtime_resume` (Sol high, dedicated R19 worktree). **Reviewer:** `r00_final_review` (separate Sol xhigh). Assigned 15 October 2026 for local foundation after R00 local prerequisite acceptance; full/external acceptance remains OPEN. **Effort:** 4–7 days. **Completion dependencies:** R00.
**Primary register rows:** OPS-002, OPS-014, OPS-015, QA-02. **Supporting:** OPS-001, OPS-013, NEW-08, NEW-39.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `render.yaml`
- Modify as needed: `server/db.ts`
- Modify as needed: `server/utils/logger.ts`
- Modify as needed: `server/routes/cron.ts`
- Modify as needed: `scripts/tools/check-staging-health.mjs`
- Modify as needed: `.github/workflows/ci.yml`
- Proposed test: `server/testing/__tests__/completion-r19.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R19.1:** Declare staging/prod service identities, CA-verified DB TLS, durable object storage and external scheduler; pin runtime configuration.
2. **R19.2:** Implement meaningful bounded readiness checks, redacted structured context, job/provider metrics and alert routing; run cache/DB/storage outage scenarios.
3. **R19.3:** Prepare versioned migration, backups including files, restore/rollback and incident runbooks; enforce explicit owner-configured secrets and access.

**Data/migration contract:** Durable object manifest and job/AI DB state included in backups; separate test/staging/prod; no deploy or paid service creation authorized by this document.

**Independent acceptance oracle:** Known SHA on HTTPS staging; invalid CA fails; required outage makes readiness fail; restore meets RPO24h/RTO4h target; rollback compatible with migrated data; no secret/raw finance log leakage.

**Focused verification:** `npm run test:server:run -- testing/__tests__/completion-r19.test.ts`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R19/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r19): deployable operations, storage and recovery`.

**Concrete repair contract:** Use the selected S3-compatible object-storage baseline, existing Render application/PostgreSQL/Redis design and external authenticated scheduler; actual accounts/origins remain OI-01. Establish staging early. No deployment/provisioning permission is conferred by this spec. A disk alternative requires a documented architecture amendment with equivalent multi-instance/deploy/restore proof.

Liveness reports process state; readiness probes actual DB/cache dependencies with bounded timeouts and minimized public details. Emit sanitized context/run IDs and alerts. Require verified DB TLS. Keep durable job/AI authority in PostgreSQL; a different Redis logical database alone is not evidence that cache eviction cannot affect coordination. Migrate tracked/legacy files by reviewed manifest/hash before removal.

**Additional acceptance:** Upload survives redeploy; object+DB restore meets24hRPO/4hRTO; bad CA fails; dependency failure yields readiness503 within2s; alert reaches the operator; migration from populated prior schema preserves data. Stage foundation and later cron acceptance are distinct milestones.

<a id="r20"></a>
#### R20 — Trustworthy automated and runtime verification

**Owner:** parent Astra for protected integration, serial suites and the Golden A browser prefix; separate reviewer `r00_final_review` (Sol xhigh). Local work assigned after R00 prerequisite acceptance; full packet acceptance remains OPEN. **Effort:** 3–5 days. **Completion dependencies:** R00.
**Primary register rows:** OPS-011, QA-01. **Supporting:** none.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `playwright.config.ts`
- Modify as needed: `e2e/global-setup.ts`
- Modify as needed: `server/vitest.config.ts`
- Modify as needed: `client/vitest.config.ts`
- Modify as needed: `e2e/transactions.spec.ts`
- Modify as needed: `e2e/investments.spec.ts`
- Proposed test: `server/testing/__tests__/completion-r20.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R20.1:** Guard all root/server/browser harnesses against real DB or arbitrary reused server; pin browser/runtime identities.
2. **R20.2:** Replace fill-only or conditional-empty assertions with submit/result/DB-readback and mandatory populated fixture journeys.
3. **R20.3:** Provide separate production-mode verification profile with CSRF, cookies, CSP, rates, Redis and UTC server/Lusaka actor; use synthetic data and local sinks.

**Data/migration contract:** No application data migration; fixtures generated per run with exact target identity and scoped cleanup; do not reuse private audit jars.

**Independent acceptance oracle:** Wrong target aborts; mutations actually occur in fixtures; absent required controls fail; no new skip conceals regression; standard tests and protected-runtime probes separately report results.

**Focused verification:** `npm run test:server:run -- testing/__tests__/completion-r20.test.ts`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R20/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r20): trustworthy automated and runtime verification`.

**Concrete repair contract:** Guard root/client/server/browser test entrypoints before connection or mutation: explicit target host/database allowlist, fixture/run marker and owned server. Never use finance_app or arbitrary existing localhost. Do not confuse server Vitest's forced test mode with security-header/rate/CSP verification.

Rewrite fill-only and if-control tests into mandatory submit plus independent HTTP/DB/file outcome. Empty and populated fixtures are deterministic. A deliberately disabled submit must make the relevant journey fail. Create a protected production-mode HTTPS verification profile early, with SMTP sink, synthetic data, fixed time/zone inputs and mocked providers.

**Additional acceptance:** Wrong database and foreign run marker fail before writes. Missing controls, skipped submit and unpopulated data cannot pass. Both UTC server and Lusaka household boundaries exercised. Browser build mismatch is environment-blocked, not an app failure or a passing test. Full suites run serially if the host is serving another CI job.

<a id="r21"></a>
#### R21 — Integrated acceptance and controlled release

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 5–8 days. **Completion dependencies:** R01, R02, R03, R04, R05, R06, R07, R08, R09, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20.
**Primary register rows:** Cross-cutting acceptance; closes supported rows only with their primary owner. **Supporting:** QA-02.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `e2e/auth.spec.ts`
- Modify as needed: `e2e/transactions.spec.ts`
- Modify as needed: `e2e/organization.spec.ts`
- Modify as needed: `e2e/reports.spec.ts`
- Modify as needed: `scripts/tools/check-staging-health.mjs`
- Proposed test: `e2e/completion-r21.spec.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R21.1:** Execute J01-J16 with independent financial oracles and every resolved finding's evidence at one candidate SHA.
2. **R21.2:** Run real controlled SMTP/provider/push/device checks, restore/rollback and14-day soak; collect owner UAT and explicit deployment authorization.
3. **R21.3:** Release canary, observe real scheduled runs and72h health, then expand only after gates; archive final manifests and remaining optional enhancements.

**Data/migration contract:** No new schema by default; release manifests pin code/config/schema/object and provider identities; a fix resets affected evidence and relevant soak gate.

**Independent acceptance oracle:** No required open item, no unresolved P0/P1, all offered functions pass; continuous14-day soak without P0/P1, restore/rollback/UAT evidence; production smoke and first due runs.

**Focused verification:** `npx playwright test --config playwright.production.config.ts e2e/completion-r21.spec.ts --project=chromium`. Use the shared red/green and protected-runtime loop above; complete the applicable J journey, including negative/race/retry assertions.

**Closure evidence:** `docs/reviews/completion-v2-evidence/R21/RESULT.md`, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r21): integrated acceptance and controlled release`.

**Concrete repair contract:** Execute all sixteen journeys at one recorded candidate SHA/config/schema identity. Every one of101 closure groups plus its explicit subrequirements must be CLOSED or REFUTED with bounded evidence; severity never exempts a promised capability. R19 operations and R20 harness checks are prerequisites, not work to discover at the release ceremony.

Run controlled external SMTP/AI/push checks, first due scheduled jobs, actual devices, backup restoration, compatible rollback, failed-migration recovery and load scenarios. Publish a gate report with observed/expected values and source evidence links.14-day candidate soak includes incident tracking; release-blocking fixes invalidate affected evidence and reset relevant soak. Owner UAT and OI-06 authorization precede production deployment.

**Additional acceptance:** Canary exact-SHA/config/schema smoke, first production schedules and72-hour observation pass before expansion. Refresh module status/release documentation from observed results only. “Implemented,” “merged,” “staged” and “ready for real household use” remain separate states.



<a id="acceptance"></a>
## 6. Acceptance journeys, fixtures and evidence

All journeys are NOT RUN for this master. Historical successes and reproduced failures do not establish candidate closure.

### Fixture and environment rules

Use generated synthetic users in households A/B, with owner/admin/member/view_only/Professional and an outsider; exercise an unknown role through a controlled repository/test seam if the DB enum forbids persisting it. Never weaken the real enum to make a fixture possible. Create private/shared accounts and transactions independently; include linked goals/tags/recurring, empty and populated investments, and foreign IDs. Every test run has its own target manifest, unique fixture prefix and scoped cleanup. Never reuse private audit cookies or secrets.

Use independent expected values, not the same Money/query helper as production. Local test DB plus test-mode suites establish regressions; a separate production-mode HTTPS staging run establishes CSRF/cookies/CSP/limits/deployment. Record UTC server and Africa/Lusaka actor/household timezones. Clock control belongs to isolated tests; do not change production clock.

#### Golden fixture A — posting, liability, FX and splits

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

### J01–J16: required end-to-end outcomes

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

### Packet evidence template

Create docs/reviews/completion-v2-evidence/Rxx/RESULT.md only during authorized execution. It must contain:

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

### Full candidate gates

Current static/build/client/server/bundle checks pass on the exact candidate; targeted regressions and guarded protected-runtime journeys pass; no required register row lacks evidence. Then perform real controlled SMTP, AI, push, scheduled-job, storage, device, restore and rollback checks. Complete14-day no-P0/P1 soak with incident evidence and owner UAT. Security/financial fixes invalidate affected evidence; release-blocking regression resets the relevant soak.

Post-deploy, verify source/config/schema identity, run a synthetic canary without exposing real household data, observe first due production jobs and monitor72h. Production deployment/invitation requires OI-06 authorization; writing this plan did not grant it.
### Historical fixtures to port, not blindly reuse

Claude's earlier reports contain useful larger regression fixtures. Recreate them as portable synthetic fixture builders under the proposed server/testing/fixtures/completion-fixtures.ts and e2e fixture modules, or equivalent existing locations. Inspect ignored .local scripts only as historical leads; no agent may depend on their presence or private cookies. Record every opening balance, date, rate, holding, actor and operation, then derive totals independently.

| Source family | Historical expectation to preserve after reconstructing its entire fixture |
|---|---|
| Reports consistency A4 | September expenses1564.15; October budget actual1273.75; corrected net worth41577.69; USD75 at26.50 contributes1987.50 |
| Budgets/goals A1 | Groceries650.74 of1000 ->remaining349.26 and65.07%;550 across3months ->183.33; manual Dining500 retained; rollover450 once |
| Investment/GRZ A3 | Bond face250000 and recorded coupon14078.12;10shares at310.50 with5sold FIFO; bill at face; synthetic withholding fixture |
| Privacy A5 plus outsider | Private marker amount777.77 and shared11.11 across roles; zero hidden IDs/counts/amounts in related responses |
|14October re-verification | Foreign category/tag action denied; every dry-run action leaves table snapshots identical; view-only household preference write denied |

The A4 net-worth number cannot be derived from the abbreviated opening-account list alone. These are historical expected values for their full datasets, not new independent proof. Use Golden fixture A above as the self-contained minimal oracle, and retain the larger values only after complete portable fixture reconstruction and independent calculation. Synthetic15% withholding is not a claim about tax law.


<a id="interfaces"></a>
## 7. API/data contracts and migration execution

Routes below are target contracts, not claims new endpoints already exist. Preserve existing route compatibility where inspected. Use the application's canonical response envelope; define typed request/response schemas and error outcomes before wiring client calls. Do not introduce silent version aliases or HTML200 for unsupported /api paths.

| Surface | Existing or proposed contract | Validation/identity/authorization |
|---|---|---|
| Personal preferences | Proposed GET/PUT /api/settings/user-preferences | Authenticated actor only; typed allowlist, omitted unchanged/null clears, optimistic version |
| Household preferences | Existing GET/PUT /api/settings/preferences | Active membership; owner/admin writes; explicit policy version and disjoint personal columns |
| Shared views | Proposed GET/POST /api/household/shared-views and PATCH/DELETE /:id | Membership read/apply; owner/admin writes; name1–100characters, allowlisted filters, version; no arbitrary query/SQL or privacy grants |
| Personal export | Existing POST /api/settings/account/export; proposed GET /api/settings/account/exports/:id and /:id/download | Step-up for sensitive request; stable request key; requester-bound manifest; role-independent personal-data capability; current access rechecked on download |
| Erasure | Existing POST /api/settings/account/delete; proposed GET /api/settings/account/deletion-status | Step-up/explicit confirmation; durable state; block writes/revoke identity before purge; recovery/status must not reopen account access |
| AI chat | Existing POST /api/ai/chat | Authenticated actor/household; request key+fingerprint; versioned consent; admission; one final result |
| AI consent/status | Existing GET/POST /api/ai/consent and GET /api/ai/status | Owner/admin writes; current version and revision; status exposes no secrets/billing diagnostics |
| Account correction | Proposed POST /api/accounts/:id/reconcile | Authorized writer with recent step-up; explanation/expected version/idempotency; explicit adjustment event, not rewriting historical currency/class |
| Job triggers | Existing /api/cron/* retained under registry | Production secret mandatory; service auth; unique due identity/fence; no ordinary member future-post authority |
| Quiet hours | Proposed GET/PUT /api/settings/quiet-hours | Own user only; enabled/timezone/local start/end; explicit cross-midnight semantics and current-version update |
| Recap feedback | Existing POST /api/weekly-recap/feedback | Actor owns/was recipient of referenced recap; bounded enum/text; request identity; persisted structured feedback |

Do not expose a public deletion-status endpoint that can enumerate erased people. Bind permitted status access to a narrow opaque request credential with expiry or a separately authorized support flow after session revocation.

### Data contracts to specify before migration

| State | Fields/constraints and transaction boundary |
|---|---|
| Session revocation | Durable session identity or tombstone/revocation generation for selected-device revoke; user security generation for revoke-all/reset/deletion. Session serialization captures generation; deserialization checks it. Preserve unrelated device on selected revoke. Schema/payload migration explicit |
| Shared views | UUID, household FK, normalized name, validated filters JSON, creator/updater, version, timestamps/archive policy; unique household+normalized name where active; read never changes disclosure authority |
| Import identity | Batch UUID, actor/household/account, file fingerprint, mapping version, option fingerprint, state/counts; row ordinal/source reference, decision/outcome/linked operation. Unique account+source or account+batch+occurrence; replay/conflict distinctions |
| Job run/item | Job/resource/household/due-period identity, status, lease owner/expiry/heartbeat, fencing generation, attempt/error/checkpoint; financial effect checks current fence and its own unique effect identity in one transaction |
| Settlement | Holding/entitlement identity, prior carrying value, cost basis, quantity, proceeds/principal/interest/fees/tax, approved policy version, source/base FX, linked existing or new cash operation, state/version/audit. Unique settlement identity prevents duplicate receipt |
| File/export | Opaque storage key, scope/requester, content checksum/media type/size, lifecycle state, manifest version, expiry/deletion identity; never use a filesystem path as public authority |
| Erasure | Request/subject, authorized scope, retained-data policy version, revoke/purge/file progress, errors, tombstone/replay marker. No secrets in tombstone; backup restore replays suppression before traffic |
| Delivery/feedback | Unique event+recipient+channel; pending/sent/failed/unknown/suppressed; provider reference, attempts/next due. Feedback references recap+actor with bounded data and idempotent update |
| AI | ai_requests/attempts/reservations/budget_accounts/consent and funding snapshots as specified in section3; atomic scope locks, no transaction across provider network I/O |

New names are design targets. Reuse equivalent existing tables only after checking constraints and document the mapping in packet evidence. Do not infer exactly-one-owner from an at-most-one index or exactly-once external delivery from a unique DB key.

### Migration and rollback checklist

1. Record exact source/config/schema SHA, target identity and backup/restore point. Never use the development finance_app as a disposable test target.
2. Inspect empty and populated prior-schema fixtures and inventory ambiguities: ownership, legacy account denomination, private flags, old GRZ cash links, lot basis and tracked files. Preserve before values/counts/checksums.
3. Expand additively with nullable/new state first. Deploy compatibility readers/writers where required. No bulk historical repair by guessing.
4. Produce a bounded backfill exception report and require a reviewed resolution for ambiguous real records. Automatic repair is allowed only when provenance proves the value.
5. Backfill in bounded resumable batches; verify cardinality, sums, references, uniqueness and privacy. Add constraints only after verification.
6. Run rollback compatibility tests with the previous binary against the expanded schema; rehearse failed migration recovery and DB+file restore. A code revert does not undo destructive data conversion.
7. Contract/remove obsolete fields only in a later compatible release after evidence and retention decisions. Reapply erasure markers on restore before serving traffic.
8. Record migration identifiers, steps, expected/actual counts, unresolved exceptions and abort/rollback actions in the packet evidence. Never edit a deployed migration to conceal drift.

Financial mutation invariants must be tested through the actual repository transaction executor, not just unit mocks. Foreign-key constraints, scoped unique indexes and row-lock/claim ordering are part of the specification, not optional implementation polish.


<a id="handoff"></a>
## 8. Operations, staffing, risk and agent handoff

### Execution authority and reading path

Read sections1–3, the relevant register rows in section4, the selected packet in section5, its acceptance cases in section6 and migration/API details in section7. Source links in section9 are corroborating evidence; no separate specification is needed to settle behavior. Resolve conflict in favor of explicit current user instructions, then this document and its versioned amendments.

Next read the matching Rxx work order in the [packet companion](../reviews/2026-10-15-unified-completion-spec/FINAL_COMPLETION_SPEC.md), plus relevant Part E host-specific instructions and Part F numeric oracles. Include its compatible steps and named assertions in the execution checklist under the authority/defaults rules above. Keep the master as the sole source for requirement status and governing decisions.

Before implementation: record the owner's campaign authorization above, current checkout/SHA/dirty ownership, applicable repository instructions, target safety and packet dependency state. The dedicated Astra session may delegate to Sol workers and reviewers; its workers must know their owned files and that other agents' edits must be preserved. This authorization does not permit unsolicited messages to other user chats or external recipients.

> Implement packet Rxx from docs/plans/2026-10-15-master-completion-spec.md under the user's explicit implementation instruction. Read the governing contracts, applicable101-register rows, AI checkpoints if relevant, and acceptance catalogue in that single file. Claim exact files, preserve other work, write meaningful failing regressions, implement the coherent service/controller/client/migration slice, and run focused checks plus protected runtime evidence. Obtain review appropriate to the changed language/domain. Update the packet evidence and this document's statuses only from observed results. Do not hide capabilities, invent policy/credentials, use finance_app for tests, spend credits without bounded authorization, or claim deployment from a merged commit. End with actual evidence, unresolved inputs and one bounded next task.

Rxx is a placeholder. The dedicated implementation session is authorized to advance through all dependency-ready packets without seeking renewed approval for each local packet. A standalone narrower packet request remains narrower. Neither grants production deployment or paid external calls. Missing OI facts block the dependent action; continue independent authorized work.

### Branches, files and evidence

Use an existing suitable isolated worktree when implementation needs it; inspect attachments first. Prefer codex/ branch names in this environment. These assessment documents are untracked at authoring and will not automatically follow a new worktree: explicitly preserve/copy the master and required synthetic evidence or commit documentation under authorized scope first; compare checksums. Never copy .env, audit cookies or raw personal data as handoff material.

One editor owns a hot file at a time: shared/schema.ts, package/lock manifests, TransactionRepository.ts, BaseReportRepository.ts, permission helpers, ai.service.ts and render.yaml. Coordinate dependent schema/service changes before merging. No blanket reset/revert of another agent's work. Commit only explicit authorized paths with one coherent concern; register IDs belong in the PR body.

Store future execution evidence under `docs/reviews/completion-v2-evidence/Rxx/RESULT.md`; per-packet artifacts may include sanitized raw results and a machine-readable record. These files do not yet exist. One master specification does not prohibit separate execution evidence. Never keep the only acceptance fixture or proof in ignored .local paths.

PR/body checklist: problem and intended resulting behavior; register/subrequirement IDs; applied decisions; changed files; tests actually run and their assertion results; target/mode/SHA; migration/backfill/rollback; reviewer findings; remaining items. A source read, toast or exit code alone cannot close a monetary/privacy finding.

### Environment recipe and known traps

- Local regression tests use disposable test DBs and local sinks; protected runtime evidence uses a separate production-mode HTTPS setup with CSRF/cookies/CSP/rates enabled. NODE_ENV=test is not release evidence.
- Secure environment binding must override ambient .env correctly; deleting a provider variable may allow dotenv to re-inject it. Validate zero-paid configuration before test launch, and assert no external transport can dispatch.
- Synthetic email addresses use reserved test domains. Keys and connection strings stay out of logs, evidence and prompts.
- Build fixture DBs with versioned migrations; db:push can omit migration-only constraints. Do not run db:test:setup or db:migrate until the actual resolved target is checked.
- The host may be running CI jobs: avoid simultaneous full suites. Run targeted tests while iterating, full affected suites/static/build before integration; dependency changes also need fresh audit/native checks.
- Playwright browser binaries must match the package version. A launch mismatch is an environment failure; installation belongs to authorized implementation, not readiness proof.
- Drizzle date columns may return date-only strings and decimals return strings. Keep financial arithmetic in Money/Decimal and do not parse date labels as ISO.
- File-size ratchets require cohesive extraction, not increasing baselines to pass. Historical CLAUDE.md status claims are stale leads; inspect current code and guards.
- For Git Bash API paths, path conversion can corrupt /api arguments; prefer PowerShell/native HTTP fixtures or explicitly controlled conversion settings.
- On Windows, preserve junction/shared dependency ownership; do not recursively clean another checkout through a junction.
- Historical ignored probe scripts can inform new tests, but must be inspected and recreated/sanitized into portable committed fixtures before they become acceptance dependencies.

### Verification commands

Commands below are intended future verification, not claims of execution. Confirm the chosen target and installed script behavior first.

```powershell
git status --short
git rev-parse HEAD
npm run check
npm run test:server:run -- modules/auth/__tests__/completion-r01.realdb.integration.test.ts
npm run test:run -- client/src/pages/settings
npm run build
npm run check:bundle
npm run deploy:verify
```

The packet-specific server commands resolve relative to server/ because the package script changes directory there. Focused tests are proposed paths and must be created or mapped to equivalent existing tests during implementation. Real integration targets need TEST_DATABASE_URL plus host/database/run-marker verification. Full candidate commands include npm run test:server:run, npm run test:run and the guarded production-mode Playwright profile specified in section5; they do not replace controlled external integration evidence.

### Delivery lanes and first-month outcome

| Period | Primary priorities | Evidence expected, not promised completion |
|---|---|---|
| First2 working days | Confirm target safety/inputs and baseline; R00/R20 foundation; prepare R19 staging design | Exact identities, protected test plan, named owners, current dependency/runtime findings |
| Days3–5 | R01 session/DTO regressions; R04 privacy reproduction; R19 environment foundation | Before/after selected-cookie proof as fixes land; controlled cross-household/private fixtures |
| Days6–10 | R02 verification/first-run; R04 matrix; R11 early pure-rule/reference regression slices | Fresh-browser mail path and role/private negative tests; no premature gate closure |
| Remainder of first month | Complete dependency-ready identity/privacy work, R03 lifecycle, begin R08 ledger and safe rule fixes; run staged proof as access permits | Progress report against G0/G1 and money foundations; reforecast based on actual completed slices |
| Following stages | R08–R12 money/import/report correctness, then complete settings/investments/jobs/files/outbound, R17/R18 and all acceptance | G2–G6 evidence, not a fixed date commitment |

The owner has selected the Astra/Sol agent team below. The earlier one-developer estimate remains the comparable effort baseline, not the staffing configuration. Human reviewer/operator/UAT availability is still unconfirmed. The first-month table is an initial priority scenario; reforecast from actual accepted throughput instead of retaining its dates or assuming three agents divide duration by three.

Begin the honest harness early rather than rewriting it only during final acceptance. R19 storage/deployment foundation starts after R00; complete job evidence later with R14. All lanes converge on R21 at a single candidate identity.

### Agent staffing, capacity and effort model (version 2.3)

| Role | Configured model and effort | Responsibility and capacity |
|---|---|---|
| Routine orchestrator/integrator | `gpt-6.1-sol`, `xhigh` | Own bounded work under settled contracts, canonical queue/status, assignments, shared-file locks, integration and evidence. Identify required Astra checkpoints before dependent decisions. Counts as one agent. |
| Architecture/policy/release checkpoint | `gpt-6-astra`, `high` | On an owner model switch in this chat, adjudicate new shared architecture/security contracts, unresolved privacy or financial policy, and release readiness. High effort accepted by the owner in v2.4. Human authorization and release gates remain separate. Replaces the active coordinator in that slot rather than adding a full-time lane. |
| Primary implementers | `gpt-6.1-sol`, `high` | Routine coherent UI/API/settings/infrastructure slices and meaningful regression tests. Up to three worker slots total, shared with reviewers. |
| Complex implementers | `gpt-6.1-sol`, `xhigh` | Privacy/roles, ledger and reports, concurrency, migrations, idempotency, durable jobs, Thandi consent/admission/funding. Same slots, not additional staff. |
| Independent reviewer/test investigator | `gpt-6.1-sol`, `xhigh` | Separate agent from the author, appropriate code/domain review, challenge acceptance and investigate integration failures. Same model-family review is not cross-family independence. |
| Human owner/UAT/operator | Named by owner when needed | Policy inputs, actual credentials/environment decisions, realistic UAT and release authorization; not replaced by an agent. |

Current environment capacity is four concurrent agents including the active coordinator: at most three active subagents. Verify availability when starting and queue excess assignments. Use two implementers plus one reviewer once changes are ready; use all three slots for independent implementation only while no review is waiting. Do not nest delegation to evade the capacity limit. An agent slot is neither a human developer-day nor guaranteed continuous service.

**Dispatch and review rules:** Explicit model overrides require a self-contained subagent assignment with `fork_turns="none"` on the current collaboration API. Each assignment names model/effort, outcome, owned files/worktree, canonical IDs, governing contract and companion packet, dependencies, target boundaries, test/evidence requirements and stop condition. Tell every worker it is not alone in the codebase and must preserve others' changes. Do not silently substitute a model if unavailable: report the limitation and continue preparation within available capacity. Use code-reviewer and relevant language/domain reviewer roles as required by applicable instructions. Reviewers must not approve their own implementation.

**Workspace integration:** Inspect attached worktrees first and use an isolated campaign checkout with separate worker worktrees where practical. The master and companion are currently untracked in the primary checkout: preserve and checksum the approved documentation and necessary source references into the campaign before dispatch, without copying secrets, raw personal data or unrelated `.claude/launch.json`. Record source and destination revisions. One owner controls each hot file and the canonical register; workers return proposed status/evidence for Astra to integrate. Serialize schema/migration allocation, package/lock changes and full suites. Integration into the campaign branch is authorized; production/main release actions remain separately gated. Never discard the primary checkout's untracked work.

| Dispatch wave | Concurrent work permitted after prerequisites | Integration gate |
|---|---|---|
| Foundation | R00 owner; independent read-only inventory/fixture design may run alongside but cannot claim downstream closure | Pin baseline, target protections and dependency/runtime evidence |
| First three lanes | R01 auth/security (Sol xhigh); R19 local operations/storage foundation (Sol high); R20 test harness/target guards (Sol high, xhigh for isolation) | All require R00; serialize shared manifests, test setup and deployment files; R19 external proof remains pending |
| Identity/privacy | R02 after R01; R04 after R01; operations/harness continue or slot rotates to review | R03 waits for R02 and R04; R05 waits for R03 and R04 |
| Money and product | R08 after R04 alongside dependency-ready R03/R05/UI work; then R09, R11 and R12 after R08, within slot/file limits | Shared transaction/report utilities have one owner; full prerequisite table in section5 governs |
| Services and AI | R14 after R08 and R19 foundation; R10 after R08/R12; R17 after R04/R05/R12/R19 foundation; R13/R15/R16 follow their full dependencies | Do not begin financial integration against unfixed ledger/FX/privacy contracts; compatible mock/fixture preparation may happen earlier |
| Candidate acceptance | R21 once all required packet outcomes converge; separate agents can execute independent journey groups against the same candidate and isolated fixtures | No writer mutates the candidate during evidence collection; a fix creates a new candidate and affected evidence is rerun |

R19 foundation availability permits explicitly dependent local work; it does not mark R19 complete or certify staging. Apply the foundation/full-acceptance distinction already defined in the packets. No wave table overrides section5 dependencies.

**Effort accounting:** Keep the 88–145 focused developer-day-equivalent work estimate and the single 20% reserve (106–174 rounded-up days) as the scope baseline. These already cover implementation and required verification; do not multiply effort by worker count or add the same contingency twice. Parallelism changes elapsed time, not the remaining requirements. Track worker implementation, review, integration/rework, test runtime and external waiting separately. Newly discovered work or measured coordination overhead beyond this estimate requires an explicit reforecast.

| Illustrative net accepted-throughput multiplier versus the serial baseline | Elapsed working-day equivalents using 106–174 reserved effort-days |
|---|---|
| 1.0x, no demonstrated parallel gain | 106–174 |
| 1.5x, conservative planning scenario | 71–116 |
| 2.0x, favorable scenario requiring measured evidence | 53–87 |

Arithmetic is `ceil(reserved effort / net multiplier)`, with review, integration, contention and orchestration already reflected in the net multiplier. These are comparison scenarios, not forecasts of AI wall-clock duration or promised dates. Use 1.5x only as a provisional scenario; do not commit a calendar until throughput is measured. Preserve the required 14-day elapsed soak and human/external waiting; overlap work only where permitted, and do not add the soak again if it is already represented in a scenario's timeline. No token/API cost or account-limit estimate is inferred from developer-days. Sol agent usage is separate from Thandi's Anthropic/Gemini provider credits.

**Progress ledger and reforecast:** The active coordinator maintains one campaign ledger at `docs/reviews/completion-v2-evidence/CAMPAIGN.md`, recording agent/model/effort, branch and SHA, packet/slice, file ownership, dependencies, started/finished time, review disposition, evidence path, status and blockers. Record actual model switches and required Astra checkpoints; never imply that a Sol-coordinated change received Astra review. Record actual usage only if exposed by tools. Reforecast after the first accepted R00/R01/R19-foundation/R20 slices, then G1 and G2; report completed canonical groups, accepted slices, rework and critical-path blockers rather than agent activity or unsupported completion percentages. Finish independent authorized work before declaring an external block.

**Version 2.2 amendment:** Owner authorized the separate implementation campaign and Astra/Sol delegation, replacing the former documentation-only boundary for that session. Applies to R00–R21 and their existing J/AI checks. Requirements and baseline effort remain unchanged; adds staffing, scheduling scenarios and review/integration accounting. Data/security invariants and external enablement/release gates remain unchanged. The kickoff prompt is [Astra implementation kickoff](2026-10-15-astra-implementation-kickoff.md).

**Version 2.3 amendment record:** Owner approved the hybrid coordination arrangement in this implementation chat on15 October2026. Reason: permit Sol Extra High to continue routine work while the coordinator flags required Astra switches. Affects agent governance across R00–R21 and their existing register/J/AI checks; no requirement, closure state, effort estimate, staffing-slot count, data/security invariant or external authorization changes. All101 canonical groups remain OPEN. Independent author/reviewer separation and exact-candidate evidence remain required. Earlier technical evidence retains its recorded source/target/model provenance and is not relabelled as Astra-reviewed.

### Risk register and decision owners

| Risk | Mitigation / stop condition | Owner to assign |
|---|---|---|
| Unknown/incorrect test DB or ambient server | Refuse before connection/writes; explicit manifest and run marker | Harness owner R20 |
| Legacy money/owner/currency ambiguity | Bounded report, no guessed backfill; approve reconciliation before constraints | Money lead + product owner |
| Parallel edits in shared schema/writers | One active file owner, explicit API/migration contract, integration review | Engineering lead |
| Missing staging/keys/operator | Start synthetic work; block only dependent external action | Operations owner OI-01/02 |
| Credit expiry or off-app consumption | Separate fresh funding reconciliation, all scoped caps, no zero-price assumptions | AI/operator owner |
| Tax/privacy values unknown | Synthetic fixtures only; qualified OI-03/04 gates before real output/use | Product/policy owner |
| Green tests with vacuous journeys | Submit mutation checks, independent DB/files/provider oracles | QA/reviewer |
| Late job/provider/send completion | Fencing, idempotent effects, unknown outcomes, no blind retry/refund | Backend/integrations owner |
| Scope/estimate drift | New finding ID + owner + evidence + acceptance; reforecast after G1/G2 | Delivery owner |
| Recovery failure or lost files | Object+DB restore, erasure replay, compatibility rollback, measured RPO/RTO | Operations owner |

No owner is silently assumed to be the person running an agent. Assign real people/agents before the relevant work/gate; only the human owner's authorized release decision can expand production rollout.

### Resume note

```text
Packet / implementing owner / reviewer:
Authorization reference:
Branch / SHA / worktree / dirty-file ownership:
Register IDs and mandatory subrequirements:
Dependencies and current gate:
Changed files and migrations:
Last completed slice:
Commands actually run and assertion results:
Target/mode/fixture/evidence paths:
Register status transitions:
Unresolved input/failure:
Next exact bounded task:
```

After each packet, update evidence/status and report remaining work. At each gate, publish conditions with observed evidence, not an averaged readiness score. Do not restart a full audit merely because a new agent takes over.



<a id="sources"></a>
## 9. Source traceability and historical evidence

The following sources informed this master. Their evidence stays intact; their old policy/estimate/execution alternatives are superseded. No original-package README or response letter is required to decide what to build.

- [Codex original assessment](../reviews/2026-10-11-deep-readiness/README.md).
- [Claude revised assessment](../reviews/2026-10-13-independent-readiness-fable/README.md).
- [Prior Codex consolidated package](../reviews/2026-10-15-consolidated-completion/README.md).
- [Corrected Claude work orders](../reviews/2026-10-15-consolidated-completion-fable/COMPLETION_SPEC.md).
- [Comparison and final response verification](../reviews/2026-10-15-consolidation-comparison.md).
- [Claude item-by-item response](../reviews/2026-10-15-consolidated-completion-fable/RESPONSE-TO-CODEX-COMPARISON.md).

### Historical packet correspondence

| Canonical packets | Historical Claude work orders |
|---|---|
| R00 / R20 | CP-00 plus harness portion ofCP-21 |
| R01 / R02 / R03 / R04 | CP-01 / CP-02 / CP-03 / CP-04 |
| R05 / R06 / R07 | CP-05 / CP-06 / CP-07 |
| R08 / R09 | CP-08 plus liability work inCP-09 / CP-10 |
| R10 | CP-11 budgets andCP-12 goals |
| R11 / R12 / R13 | CP-14 / CP-09 / CP-15 |
| R14 / R15 / R16 / R17 | CP-13 / CP-17 / CP-18 / CP-19 |
| R18 / R19 / R21 | CP-20 / CP-16 / CP-21 acceptance |

This is many-to-many where responsibility was split. Canonical R IDs govern; never substitute CP-19 for R19 merely because the number matches.

### Domain and lead-finding crosswalk


15 October 2026. This table maps every individually identified table finding read from Claude's six domain reports, including repeated IDs whose meanings differ by report. Summary rows are deduplicated by source file and ID. SET-06 is an explicit positive finding, retained as a regression check rather than invented remaining work. Original62 Codex rows map1:1 by preserved ID in section4; lead F-* findings map through its source aliases. This mapping does not turn source-only evidence into a runtime result.

**129 distinct domain ID entries mapped; 128 map to required closure groups; one positive retained.** Lower-priority details are included in packet acceptance, not silently deferred. Source report rows may contain multiple variants; read the named row when implementing its mapped group.

| Source report | ID | Topic | Consolidated closure group |
|---|---|---|---|
| [domain-budgets-goals-recurring.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | BGR-01 | `GET /api/budgets/progress` | FIN-06 |
| [domain-budgets-goals-recurring.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | BGR-02 | Rollover (progress + `POST /api/cron/budget-rollover`) | NEW-16 |
| [domain-budgets-goals-recurring.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | BGR-03 | `POST /api/budgets/recalculate` | FIN-07 |
| [domain-budgets-goals-recurring.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | BGR-04 | Recalculate/clear audit | NEW-32 |
| [domain-budgets-goals-recurring.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | BGR-07 | Refunds in budget spend | FIN-06 |
| [domain-budgets-goals-recurring.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | BGR-08 | Move to same budget | NEW-32 |
| [domain-budgets-goals-recurring.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | GOAL-01 | Manual contributions | NEW-29 |
| [domain-budgets-goals-recurring.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | GOAL-02 | `GET /api/goals/summary`, `GET /:id/contributions` | NEW-35 |
| [domain-budgets-goals-recurring.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | GOAL-03 | `POST /:id/assign-account` | FIN-09 |
| [domain-budgets-goals-recurring.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | GOAL-04 | Projection dates | NEW-15 |
| [domain-budgets-goals-recurring.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | REC-01 | Create-rule UI vs API | NEW-10 |
| [domain-budgets-goals-recurring.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | REC-02 | `calculateNextDate` monthly | NEW-30 |
| [domain-budgets-goals-recurring.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | REC-03 | Catch-up | NEW-30 |
| [domain-budgets-goals-recurring.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | REC-04 | `POST /api/recurring/process` `asOfDate` | NEW-30 |
| [domain-budgets-goals-recurring.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | REC-05 | "Today" for due-ness | NEW-15 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | IMP-01 | `prioritize_csv` re-import of an already-imported file. Impl PRESENT, Verif HTTP+DB | FIN-02 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | IMP-02 | Same-day same-amount distinct transactions. Impl PRESENT (by design), Verif HTTP+DB | NEW-17 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | IMP-03 | Invalid date `2026-02-30`. Verif HTTP+DB | FIN-15 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | IMP-04 | Ambiguous slash dates. Verif HTTP+DB | FIN-15 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | IMP-05 | Notes column mapping. Verif HTTP+DB+SRC | NEW-17 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | IMP-06 | Per-row errors in UI. Verif SRC | NEW-17 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | IMP-07 | `data_imports` history | NEW-17 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | RCP-01 | `POST /api/receipts/:id/create-transaction` retried. Impl PRESENT, Verif HTTP+DB | NEW-18 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | RCP-02 | create-transaction with negative amount. Verif HTTP+DB | NEW-18 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | RCP-03 | Receipt detail payload | NEW-39 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | RUL-01 | "Test rule" button. Impl MISSING server route, Verif HTTP+SRC | ORG-006 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | RUL-02 | Action references not validated; apply-to-past fails silently. Verif HTTP+DB+SRC | NEW-36 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | RUL-03 | Cross-household tag id in a rule (SRC only, not exercised) | ORG-003 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | RUL-04 | Audit for rule-driven transaction edits. Verif DB | NEW-32 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | RUL-05 | dry-run completeness | ORG-004 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | RUL-06 | reorder input | NEW-36 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | ORG-01 | Tag merge (client `lib/api.ts:1163`). Impl PRESENT but broken, Verif HTTP+DB+EXPLAIN | NEW-19 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | ORG-02 | Merchant detail endpoints used by `components/merchants/detail/useMerchantDetailState.ts` and MerchantsSection handlers (hooks at `use-settings.ts:1241-1375`). Impl MISSING, Verif HTTP | ORG-006 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | ORG-03 | Tag name uniqueness | NEW-36 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | ORG-04 | Counters | ORG-009 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | CAT-01 | Archive group | NEW-36 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | CAT-02 | `includeArchived=false` | NEW-36 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | X-01 | Imported transactions are stored with `currency = NULL` (import passes no currency; receipt path likewise), so any per-currency logic must fall back to the account currency | FIN-05 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | X-02 | `POST /api/accounts` writes two `account CREATE` audit rows per account | NEW-32 |
| [domain-import-receipts-organization.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | X-03 | Timestamps written from JS `new Date()` (e.g. `deleted_at`, account `updatedAt`) are 2 h behind `defaultNow()` columns on this Lusaka-time server (e.g. account `createdAt 22:58Z`, `updatedAt 21:00Z`; transaction `created_at 21:00:09`, `deleted_at 19:00:09`) - suggests `timestamp without time zone` mixed with session-TZ defaults | NEW-15 |
| [domain-investments-grz.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | GRZ-01 | `POST /grz/payments/:id/pay` on a **principal** row | NEW-03 |
| [domain-investments-grz.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | GRZ-02 | pay after sell | NEW-04 |
| [domain-investments-grz.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | GRZ-03 | `PUT /bonds/:id/sell` money effects | NEW-03 |
| [domain-investments-grz.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | GRZ-04 | pay before due date / any account | NEW-04 |
| [domain-investments-grz.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | GRZ-05 | `POST /grz/bonds` validation | NEW-23 |
| [domain-investments-grz.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | GRZ-06 | maturity cron, `Money.isPositive()` | NEW-23 |
| [domain-investments-grz.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | GRZ-07 | schedule vs stored rate | NEW-23 |
| [domain-investments-grz.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | GRZ-08 | yield day count | NEW-23 |
| [domain-investments-grz.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | GRZ-09 | `POST /grz/tbills` | NEW-23 |
| [domain-investments-grz.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | INV-01 | manual buy/sell → `holdings.cost_basis` | FIN-10 |
| [domain-investments-grz.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | INV-02 | sell with negative quantity | NEW-20 |
| [domain-investments-grz.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | INV-03 | sell of holding opened via `POST /holdings` or SIP | FIN-11 |
| [domain-investments-grz.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | INV-04 | FX on investment txns | NEW-21 |
| [domain-investments-grz.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | INV-05 | fees | NEW-35 |
| [domain-investments-grz.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | INV-06 | global securities / FX | NEW-13 |
| [domain-investments-grz.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | INV-07 | tax summary / ZRA export coverage | NEW-22 |
| [domain-investments-grz.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | INV-08 | tax-year window | NEW-22 |
| [domain-investments-grz.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | INV-09 | SIP buy / plan create audit | NEW-32 |
| [domain-investments-grz.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | INV-10 | past-due SIP | FIN-12 |
| [domain-investments-grz.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | PEN-01 | pension contributions | NEW-24 |
| [domain-investments-grz.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | PEN-02 | pension audit/atomicity | NEW-24 |
| [domain-reports-consistency.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-01 | `GET /api/reports/ratios` (`liquidAssets`, `currentLiabilities`, emergency fund, burn rate, liquidity) and `/reports/debt` | NEW-02 |
| [domain-reports-consistency.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-02 | `fx_rates` is global; `POST /api/investments/fx-rates` (role `member`) | NEW-13 |
| [domain-reports-consistency.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-03 | Liability accounts (credit/loan/mortgage) balance sign | NEW-05 |
| [domain-reports-consistency.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-04 | Cash-flow family: `/reports/cashflow`, `/income`, `/savings-rate`, `/spending/trend`, `/annual`, dashboard CashFlowWidget | NEW-06 |
| [domain-reports-consistency.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-05 | Split transactions in `/reports/cashflow/budget`, `/reports/transactions`, `/reports/sankey`, transactions CSV, budget CSV | NEW-14 |
| [domain-reports-consistency.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-06 | `GET /api/transactions/summary` FX policy and cache | FIN-17 |
| [domain-reports-consistency.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-07 | `GET /api/weekly-recap` when a read model throws | OPS-006 |
| [domain-reports-consistency.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-08 | Dashboard date ranges (`useCurrentMonthRange`, `useLastNMonthsRange`, `client/src/hooks/use-reports.ts:1118-1180`, 23 call sites) | NEW-15 |
| [domain-reports-consistency.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-09 | Weekly recap window, net-worth snapshot date | NEW-31 |
| [domain-reports-consistency.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-10 | Missing-rate error shape | NEW-34 |
| [domain-reports-consistency.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-11 | Rounding / footing | NEW-34 |
| [domain-reports-consistency.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-12 | Merchant breakdown `total` | NEW-34 |
| [domain-reports-consistency.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-13 | `GET /api/accounts/summary/export`, `/api/accounts/:id/transactions/export` | NEW-32 |
| [domain-reports-consistency.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-14 | Net-worth history / changes | NEW-34 |
| [domain-reports-consistency.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-15 | Report CSV money format | NEW-35 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SEC-01 | `POST /api/household/invite/accept` | AH-06 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SEC-02 | Invite email link | AH-05 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SEC-03 | `PUT /api/household/members/not-a-uuid/role` | NEW-33 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SEC-04 | Timestamps (cross-cutting) | NEW-15 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | PRIV-01 | `GET /api/goals/:id/transactions`, `GET /api/goals/:id/activity`, `GET /api/goals/summary` | FIN-01 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | PRIV-02 | `GET /api/tags/:id/transactions` | ORG-002 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | PRIV-03 | `GET /api/recurring`, `/recurring/:id`, `/recurring/:id/transactions`, `/recurring/:id/history` | OPS-005 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | PRIV-04 | `PUT /api/recurring/:id` (rule on private account), `DELETE /api/goals/:goalId/transactions/:privTxnId` | FIN-01 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | PRIV-05 | Root cause (cross-cutting) | FIN-01 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | PRIV-06 | `GET /api/recurring/detect` | NEW-33 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | PRIV-07 | Export metadata exposes `recordCount: 2` (DB `data_exports.record_count=2`) to an admin whose CSV has 1 row, so it discloses that hidden rows exist. Low impact. | FIN-01 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | ISO-01 | `GET /api/goals/:id/activity` | NEW-01 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | ISO-02 | `GET /api/transactions/:id/goals`, `GET /api/recurring/:id/history`, `GET /api/recurring/:id/transactions` | NEW-33 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | ISO-03 | `GET /api/transactions/:id/attachments` (foreign id) | NEW-33 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | ISO-04 | `GET/PUT /api/merchants/undefined` (malformed id) | NEW-33 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SES-01 | `DELETE /api/settings/security/sessions/:id` and `DELETE /api/settings/security/sessions` (revoke-all) | AH-01 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SES-02 | Session list | NEW-38 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SES-03 | `DELETE /sessions/<random uuid>` | NEW-33 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SES-04 | `GET /health/ready` (unauthenticated) | NEW-39 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SES-05 | `/api/reports/*` limiter | NEW-08 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | VAL-01 | Invitation email HTML (`invitations.controller.ts:47-70`) | OPS-009 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | VAL-02 | Path ids `GET /api/{transactions,goals,accounts,budgets,recurring,tags,rules}/not-a-uuid`, `PUT /household/members/not-a-uuid/role`, `POST /transactions {accountId:"not-a-uuid"}` | NEW-33 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | VAL-03 | `POST /api/filter-presets` without `context` | NEW-33 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | VAL-04 | Far-future dates | NEW-33 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SEC-06 | `POST /api/household/transfer-ownership {newOwnerId: <caller's own id>}` | NEW-12 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SEC-07 | `PUT /api/household/members/:id/role {role:"owner"}` | NEW-12 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SEC-08 | Lockout message | NEW-08 |
| [domain-security-privacy.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SEC-09 | `/api/auth/*` limiter | NEW-08 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | SET-01 | `PUT /api/settings/profile` | AH-07 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | SET-02 | `PUT /api/settings/preferences` (Settings → Preferences section) | NEW-26 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | SET-03 | `GET /api/settings/profile` | AH-02 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | SET-04 | `PUT /api/settings/notifications` partial update | NEW-26 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | SET-05 | `PUT /api/household/general` currency change with existing ledger | NEW-26 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | SET-06 | Fiscal-year start month | Already worked in audit; preserve in R05/J03 regression |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | REC-01 | `PATCH /api/weekly-recap/settings` storage | NEW-31 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | REC-02 | Week window | NEW-31 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | AI-01 | `POST /api/ai/chat` fallback content | OPS-012 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | AI-02 | Quota headers on `/api/ai/chat` | OPS-012 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | AI-03 | Provenance / audit metadata | OPS-012 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | AI-04 | Timestamps | NEW-15 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | REC-03 | Recap email currency label | OPS-006 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | REC-04 | `GET /api/weekly-recap/history` | NEW-31 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | REC-05 | `POST /api/weekly-recap/feedback` | NEW-31 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | NOT-01 | `GET /api/notifications/push/vapid-key` without VAPID | OPS-010 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | NOT-02 | Quiet hours | OPS-010 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | NOT-03 | `POST /api/cron/budget-alerts` counters | OPS-010 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | SEC-01 | `POST /api/settings/security/email/verify` from the emailed link in a fresh browser | NEW-07 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | SEC-02 | Email-change and password-change trail and notices | NEW-38 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | SEC-03 | `POST /api/settings/security/mfa/enable` | AH-11 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | SEC-04 | `GET …/security/sessions`, `/login-history` envelope | NEW-37 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | DATA-01 | `POST /api/settings/account/export` (DPA right of access) | AH-08 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | DEL-01 | Account deletion: other sessions | AH-01 |
| [domain-settings-notifications-ai.md](../reviews/2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | DEL-02 | Account deletion: PII retained | AH-08 |

### Lead findings and verification notes

All 48 individually labelled lead rows are cross-referenced below. Positive schema parity/password-reset observations are preserved as regression evidence, not newly counted defects. The blocked Playwright launch is an environment limitation; it does not represent71 failed app journeys.

| Lead ID | Topic | Closure group or positive disposition |
|---|---|---|
| F-AUTH-01 | Auth / onboarding | AH-03 |
| F-AUTH-02 | Auth / privacy | AH-02 |
| F-AUTH-03 | Auth / onboarding | AH-04 |
| F-ACC-01 | Accounts (functionality) | NEW-11 |
| F-ACC-02 | Accounts / audit | NEW-32 |
| F-HH-01 | Household (functionality) | AH-05 |
| F-ONB-01 | Onboarding | UX-01/NEW-27 |
| F-UX-01 | Login page | UX-01 |
| F-OPS-01 | Operations (functionality) | OPS-003 |
| F-OPS-02 | Operations | OPS-001/NEW-39 |
| F-OPS-03 | Operations | OPS-002 |
| F-OPS-04 | Operations | OPS-014 |
| F-OPS-05 | Operations | OPS-003 |
| F-OPS-06 | Operations | OPS-015 |
| F-OPS-07 | Operations | QA-02 |
| F-SEC-01 | Security / roles | AH-09 |
| F-SEC-02 | Security | AH-08 |
| F-SEC-03 | Security | NEW-33 |
| F-SEC-04 | Security | NEW-08 |
| F-DATA-01 | Data model | NEW-39 |
| F-DATA-02 | Data model | POSITIVE schema parity |
| F-CLIENT-01 | Client ↔ API | ORG-006 |
| F-CLIENT-02 | Client | AH-05/AH-08/AH-11/NEW-25/NEW-37/ORG-010 |
| F-TXN-01 | Transactions (functionality) | FIN-17 |
| F-TXN-02 | Transactions (functionality) | NEW-09 |
| F-TXN-03 | Transactions / privacy semantics | NEW-28 |
| F-TXN-04 | Transfers (UX) | NEW-37 |
| F-DATE-01 | Dates / timezone | NEW-15 |
| F-UX-02 | Client caching | FIN-17 |
| F-DEP-01 | Dependencies | DEP-01 |
| F-AUTH-04 | Auth / onboarding | NEW-07 |
| F-AI-01 | AI assistant | OPS-012 |
| F-E2E-01 | Verification | QA-01 (environment blocker, not71 app defects) |
| F-SEC-04b | Rate limiting | NEW-08 |
| F-REC-01 | Recurring (functionality) | NEW-10 |
| F-INV-01 | Investments (functionality) | NEW-25 |
| F-REP-01 | Reports | FIN-18 |
| F-GOAL-UX-01 | Goals | NEW-37 |
| F-HH-02 | Household / trust | AH-13 |
| F-HH-03 | Household (display) | AH-05 |
| F-CF-01 | Cash flow | NEW-34 |
| F-SEC-05 | Security settings (functionality) | AH-11 |
| F-DATE-01b | Dates / timezone | NEW-15 |
| F-AUTH-05 | Auth / recovery | POSITIVE reset journey |
| F-MOB-01 | Mobile layout (functionality) | UX-02 |
| F-SEC-04c | Rate limiting (functionality) | NEW-08 |
| F-DATE-01c | Notifications | NEW-15 |
| F-TEST-01 | Verification | OPS-011 |

Source: [Claude findings draft](../reviews/2026-10-13-independent-readiness-fable/evidence/findings-draft.md).

<a id="validation"></a>
## 10. Document validation and change control

### Validation boundary

This is a documentation consolidation, not remediation or launch certification. No application code, dependency lockfile, environment configuration or database was changed by producing it. No application suite, runtime probe, staging deployment or paid provider call was performed. Existing historical evidence retains its original dates/targets and confidence.

Document checks cover the101 unique register IDs/priority totals, all62 original IDs,22 packet ownership/dependencies,66 slices, AI-01–AI-16 coverage, J01–J16 coverage, file targets and local/internal links. The detailed source crosswalk preserves129 source-qualified domain entries (including one positive) and48 lead entries. Packet files/tests/schema names labelled proposed are not treated as existing or passing.

Completed checks at authoring:101 unique closure IDs with18P0/71P1/12P2; all62 original IDs retained;22 packet anchors;66 distinct implementation slices;16 AI checkpoints;16 J journeys; acyclic packet dependency graph; packet estimate sum88–145;121 existing file-target references resolve;136 local source-link occurrences resolve and all explicit contents anchors resolve. These checks validate document structure and references only. They do not prove the proposed implementation or acceptance tests pass.

### Canonical source-of-truth rules

- This file owns requirements, decisions, estimates, priority and completion status. Do not maintain a second independently edited master register.
- External trackers may mirror its IDs, but an issue being closed does not establish runtime acceptance. Record evidence and disposition here.
- Keep original assessments/comparisons unchanged as history except a superseded-navigation notice on their planning indexes. Source observations remain available for inspection.
- Every amendment records version/date, reason, affected register IDs/packets/J/AI checks, effort impact, data/security consequences and authorization where scope or real-world operations change.
- If source code moves, update file mappings at the implementation SHA; do not weaken acceptance to fit renamed/missing code.
- Before closing a packet, reconcile its primary and supporting rows and the detailed source variants. “One useful Claude answer” cannot close all Thandi controls; “one successful transaction” cannot close every writer.
- No scope reduction is implied by lower priority, owner-assigned exception without defined impact, or temporarily disabling a feature. A true scope amendment must identify the requirement being removed and the changed product promise.

### Completion report template

```text
Master version / candidate SHA / configuration and schema identity:
Register counts by status / unresolved required IDs:
R00–R21 evidence paths and reviewer dispositions:
J01–J16 results and environment:
AI-01–AI-16 results and controlled provider proof:
Migration/backfill exceptions and reconciliations:
Restore/rollback/load/device/soak evidence:
OI-01–06 resolution and remaining dependent blocks:
Owner UAT / production authorization:
Canary and72-hour observation:
Verdict: NO-GO / candidate verified awaiting authorization / controlled release / completed
```

A “completed” verdict requires every mandated capability and its deployed evidence, not just documentation agreement between assessors.
