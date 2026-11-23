# Capital (personal-finance-app): unified completion specification and remediation plan

Version 1.2, 15 October 2026. Application baseline `main` @ `381e9439afabe7c6cf829cb1cbded91d36da44ee`. Status: referenced packet companion; no implementation is claimed by this document. The owner's separate Astra implementation campaign is now authorized under master version 2.2; its staffing, effort scenarios and execution boundaries govern. This amendment changes documentation only.

## 0. Authority, sources and how to read this

The [master completion specification](../../plans/2026-10-15-master-completion-spec.md) is the single governing authority. By the owner's instruction, this document is its referenced packet companion for detailed steps, baseline file/line references, named tests and assertions, numeric acceptance examples, host-specific traps and planning scenarios. It retains the consolidation of the two independent assessments and the two consolidations that followed them:

- 11 October assessment (Codex): `docs/reviews/2026-10-11-deep-readiness/` (62-row register, four specialist reports, Thandi provider specification).
- 13 October assessment (Fable): `docs/reviews/2026-10-13-independent-readiness-fable/` (six verifier reports with HTTP and database read-back, skeptic pass, 14 October live re-verification, Thandi assessment).
- 15 October consolidations: `docs/reviews/2026-10-15-consolidated-completion/` with `docs/plans/2026-10-15-full-application-remediation.md` (Codex) and `docs/reviews/2026-10-15-consolidated-completion-fable/` (Fable), plus the two comparisons `docs/reviews/2026-10-15-consolidation-comparison.md` and `.../COMPARISON-OF-CONSOLIDATIONS.md` and the response file `.../RESPONSE-TO-CODEX-COMPARISON.md`.

Precedence: (1) explicit current owner instructions; (2) the master specification and its versioned amendments; (3) compatible execution detail in this companion; (4) historical evidence. The master governs contracts, dependencies, canonical register, estimates and closure. Earlier SPEC.md, THANDI_SPEC.md and COMPLETION_SPEC.md files are source references, not fallback authorities. Where a companion instruction conflicts, apply the master and record the discrepancy, including selected-device session revocation, Thandi failover/funding, storage and dependencies. Master version 2.2 records the owner's new local implementation and delegation authorization; historical documentation-only statements do not block that authorized campaign.

Version 1.1 records the owner-requested companion designation without changing work-order scope or granting implementation permission. Parts A/B and register/estimate summaries below are retained consolidation context subject to the master; Part D's compatible execution detail remains actively referenced. The 110-row companion register is a source/detail checklist, not an independent completion tracker; map its entries and subchecks to the master's 101 canonical groups and reconcile unmatched details before affected packet closure. Do not add the two counts together or update competing completion statuses.

Labelled proposed defaults may support isolated synthetic tests and configurable implementation while inputs are pending; record their source, environment and enablement gate. Unconfirmed tax, retention, spending or other real-user policy values cannot become enabled production defaults. Calendar dates below remain illustrative projections using their stated assumptions and alternative effort range; rebase against the master's governing estimate, actual capacity and start date before scheduling. Verify baseline file/line references at the implementation SHA; named tests are work instructions, not proof of a current pass.

Structure: Part A governing contracts; Part B the Thandi contract; Part C the unified register (what remains, every row OPEN); Part D the 22 work orders R00–R21 (each self-contained for one agent); Part E the agent operating protocol; Part F the acceptance catalogue J01–J16 with oracles; Part G phases, gates, dependencies, lanes, calendar and risks. A machine-readable copy of Part C is `REGISTER.csv` beside this file.

Headline numbers: 110 closure rows (18 P0, 80 P1, 12 P2), all OPEN, all required for completion; 22 work orders; 92–151 focused developer-days before reserve, 110–181 with the agreed 20% reserve; projections in Part G §5 are labelled ranges, not commitments.

How an agent starts: read the master's authority, relevant contracts, canonical rows and Rxx packet first; then read this §0, Part E, the matching work order in Part D and compatible Part F oracles. Use Part C to retain detailed source coverage under the master groups. Do not read historical packages first; they are cited where needed.

---

# Part A. Governing contracts

## A1. Scope

Finish every existing advertised capability: identity and recovery; all offered roles including Professional; households, invitations, ownership and named shared views; accounts, ledger, transfers, splits; imports and exports on both entry points; organisation (categories, groups, tags, merchants, rules, presets); budgets, goals, recurring; investments, GRZ instruments, pension and tax reporting; reports, cash flow and dashboards; receipts with OCR; notifications, weekly recap and push; Thandi; settings, MFA and data exit; phone layout and accessibility; deployment, jobs, storage, recovery and operations. Temporary containment (a feature flag while a packet is built) is allowed during implementation and removed before acceptance; disabling or hiding a capability never closes its completion requirement. Remove fictional paid-plan claims; introduce no billing system.

Outside this estimate and not required: bank connections, PWA or offline editing, automatic goal funding, new PDF products, subscriptions, multilingual support, a wholesale redesign and additional AI financial actions. Existing failure states must still explain unavailable behaviour.

The register rows are grouped closure requirements, not a count of independently reproduced bugs. Each row keeps its original id; the same defect found by both assessments is one row with aliases. Severity orders work; it never excuses a required function: a P2 row is still required for completion unless the owner records a scope change against that specific row.

## A2. Resolved decisions

| # | Topic | Decision | Basis |
|---|---|---|---|
| D01 | Scope and date | Full product, no deadline, staging throughout, gate-driven | Owner instruction |
| D02 | Thandi | Direct Anthropic Claude primary, eligible Google Gemini fallback, labelled local degraded mode; Part B | Owner instruction (not to be re-asked) |
| D03 | Claude credits | The owner's Claude API credits are a finite balance, not a zero price. Both provider legs reserve and settle at dated list prices; the credit balance with its conditions and expiry is recorded as the Claude provider ceiling. Usage, credit consumption and monetary limits are tracked separately | Reconciled 15 Oct (C01) |
| D04 | Identity | Verify e-mail before any household or financial access; a pending session can verify, resend, recover and log out only; login never silently promotes it | Both packages |
| D05 | Membership | One active household per user; exactly one owner per household; transfer is the only owner reassignment; invitation bound to the recipient's verified normalised address | Both packages |
| D06 | Professional role | Kept and implemented: reads authorised shared financial data like view_only; no mutations; no financial or report export jobs; no consent or member management; personal privacy export like every role; `requireRole` fails closed on any unknown value | Reconciled (C03) |
| D07 | Shared views | Named household saved views (name plus validated filter) over already-authorised data; owner and admin create, edit, delete; any member applies; a saved filter can only narrow visibility; the dead "Configure shared views" control becomes this feature; the per-user Shared/Mine/All default filter also persists | Reconciled (C04) |
| D08 | Privacy | Private accounts and private transactions excluded by default from every other member's direct, related, list, count, export, report, AI and notification results; shared aggregates exclude private data; visibility predicate in §A3; no backfill of one privacy fact from the other | Reconciled (C07) |
| D09 | Financial effects | One posting contract for every writer, atomic audit and outbox, explicit asset and liability semantics, immutable source currency from the locked account, optimistic version conflicts | Both packages |
| D10 | GRZ | Record-only acquisition preserved (creating an instrument never debits cash). A confirmed sale or maturity receipt is an asset-to-cash settlement: holding retired, cash credited once, principal never ordinary income, realised basis difference and fees recorded separately; destination any authorised compatible-currency account; sold or matured instruments cannot pay; withholding and day-count conventions versioned and labelled synthetic until OI-03 | Reconciled (C05) |
| D11 | FX | Dated flow conversion; as-of valuation; global provider rows service-written and read-only to households; owner and admin household overrides with provenance; missing or stale rate is never 1.0, zero or a dropped holding | Reconciled (C09) |
| D12 | Calendar | Date-only values stay date-only; event instants in UTC; household timezone for local days, weeks, tax years and schedules; week is seven local dates; monthly anchor day stored | Both packages |
| D13 | Import identity | Provider reference if supplied, otherwise batch fingerprint (file hash plus mapping version) plus row ordinal scoped to account; exact replay idempotent; overlapping files present duplicate candidates for explicit review; overwrite is atomic and pair-safe | Reconciled (C08) |
| D14 | Goals | Typed progress sources; overfunding allowed only with explicit confirmation; cash enforced only when cash moves; exact reversal of links, edits and deletes | Reconciled (C10) |
| D15 | Jobs | Durable due-item ledger with fencing generations, lease renewal, checkpoints, bounded catch-up of at most 100 items per invocation; external authenticated scheduler against the declared deployment; Redis is coordination and cache, PostgreSQL is authority | Reconciled (C12) |
| D16 | Notifications | Independent channel outcomes pending, sent, failed, unknown, suppressed; unknown is never auto-retried as failed; push origins allow-listed with DNS and IP checks | Reconciled (C12) |
| D17 | Receipts | Identical replay of create-transaction returns the existing result; conflicting retry 409; one ledger effect per receipt | Reconciled (C13) |
| D18 | Storage | Durable storage behind one abstraction with manifest, checksum and authenticated retrieval. Default design is S3-compatible object storage; a Render persistent disk on a single instance is an acceptable first deployment if OI-01 confirms a single instance and the driver seam is kept. The choice is recorded in the G0 target manifest | Open design choice, both options valid |
| D19 | Test evidence | Unit and integration suites run in test mode; release evidence comes only from production-mode staging with HTTPS, cookies, CSRF, CSP, limiters, Redis, durable files, UTC host and Lusaka actors | Both packages |
| D20 | Severity rule | Where the assessments disagreed, the higher severity applies; the missing scheduler is P0 | Reconciled |
| D21 | Reserve and estimate | 20% once across the combined plan; packet effort is the higher of the two consolidations' estimates; reforecast after gates G1 and G2 | Reconciled |
| D22 | Numerical defaults | Any number in this document that is policy rather than arithmetic (withholding rate, step-up threshold, MFA re-authentication window, performance targets, limiter sizes) is a labelled proposal and test fixture until the owner confirms it; nothing paid, legal or production-facing is enabled on a proposed value | Reconciled (C06) |
| D23 | Completion flag | Every register row is required for completion regardless of severity; only an owner-recorded scope change against a specific row removes it | Reconciled (C14) |

## A3. Permissions and privacy

Permissions are named capabilities, not an ordinal comparison of role strings. Unknown role fails closed. A database enum is not authorisation.

| Capability | Owner | Admin | Member | View-only | Professional |
|---|---|---|---|---|---|
| Read authorised shared financial data | Yes | Yes | Yes | Yes | Yes |
| Read another person's private account, transaction or derived amounts | No | No | No | No | No |
| Create or edit authorised shared financial records | Yes | Yes | Yes | No | No |
| Create or edit own private financial records | Yes | Yes | Yes | No | No |
| Manage household policy, shared saved views and AI consent | Yes | Yes | No | No | No |
| Invite or remove member, view-only, Professional | Yes | Yes, not owner or admin | No | No | No |
| Grant or remove admin; transfer ownership | Yes | No | No | No | No |
| Change own profile, display, MFA; revoke own sessions; request own data exit | Yes | Yes | Yes | Yes | Yes |
| Financial or report export job; ad hoc recap generation | Yes | Yes | Yes | No | No |
| Personal privacy export (own visible and subject data) | Yes | Yes | Yes | Yes | Yes |
| Ask read-only Thandi questions under household consent | Yes | Yes | Yes | Yes | Yes |
| Write household FX or security overrides | Yes | Yes | No | No | No |
| Modify global market or reference source | No | No | No | No | No |

Role removal or downgrade takes effect on the next protected request and invalidates pending privileged forms and outbound AI authorisation. Operator market jobs use service credentials, not a household role.

Visibility predicate: actor is an active member of the resource household AND holds the operation capability AND can view the containing account (`account.is_private = false OR account.owner_user_id = actor`) AND can view the transaction (`transaction.is_private = false OR transaction.owner_user_id = actor`). A private account restricts every descendant regardless of a false transaction flag. A private transaction on a shared account restricts its own related rows. Neither admin nor Professional overrides privacy. The two privacy facts are stored and tested independently; neither is derived or backfilled from the other, and new transactions take `is_private` only from an explicit flag.

Carry the actor through goal activity, links and assignments, tags, recurring, attachments, export manifests and counts, reports, ratios, portfolios, AI tool queries and jobs. Hidden amount, name, existence, count and identifiers must not leak. Invisible object id: 404. Malformed id: 400. Known forbidden capability: 403. Never mutate a foreign entity while resolving a supplied id. Household preferences and personal preferences use separate allow-lists and persistence paths. An automated recap is generated for its recipient's visibility.

## A4. Identity, membership, settings and exit

Identity states: pending verification → verified or pending MFA → authenticated → revoked, deleting or erased. Financial handlers reject pending verification and pending mandatory MFA even with a session cookie. Registration may keep a restricted session for resend, recovery and logout.

Mail links use the configured public origin and real client routes (`/verify-email`, `/reset-password`, `/invite/:code`). Verification, reset and e-mail-change tokens are opaque, short-lived, stored hashed and consumed atomically; the stored hash is never treated as the mail token. A fresh-browser verification endpoint may use a narrowly scoped token-authenticated CSRF exemption only when it performs no ambient-session-authorised mutation and cannot log the visitor in or switch identity; `resend-verification` takes an address, stays CSRF-protected for session callers, and gains a throttled anonymous variant with a non-enumerating response.

Revocation covers the express session store and the tracking rows, and defeats a late concurrent session save with a per-user session generation checked by the deserialiser. An erased or revoked user cannot be authenticated from a tombstone. DTOs are allow-listed by purpose; no password hash, token material, MFA codes or recovery codes in payloads, errors, audit details or logs.

Invitation acceptance requires an authenticated verified recipient whose normalised address matches, an unexpired single-use invitation, and the one-household rule, serialised on the actor's advisory lock and the household row; ownership transitions lock the household and both memberships in deterministic order. Invite URLs carry the token only in the recipient mail; API responses return an invitation id. Resend rotates the token. The final owner cannot leave or be removed without a completed transfer or explicit household deletion.

MFA: enrolment requires recent step-up and proof of possession (a challenge does not set `mfaEnabled`); recovery codes are issued only after proof; mandatory policy per household increments a policy version and restricts non-compliant sessions to enrolment and recovery; the existing financial step-up stays until a configured replacement threshold is proved; thresholds use household currency with dated FX and fail closed.

Settings: every displayed profile, contact and financial field has a typed allow-list, ownership, null clearing, validation and persistence; personal theme, locale, timezone and widget preferences never alter household policy; notification preference partial updates preserve omitted thresholds and validate the type against the enum; saved shared views per D07; entitlement displays reflect real memberships, never a fictional subscription.

Export jobs: durable states queued, running, ready, failed, expired; requester identity, schema version, scoped counts, manifest and checksum, expiry; downloads re-authorise current access. Erasure: durable states requested, revoking, purging, completed, failed; revoke identity first, block mutations during deletion, replay-safe file cleanup; remaining household records keep pseudonymous attribution and the household audit history; backup restores reapply erasure markers before serving traffic. OI-04 supplies retention and legal constraints.

## A5. Monetary and mutation invariants

Use the existing Money and decimal utilities and decimal-string DTOs; never binary floating point. Source currency is immutable and derived from the locked account at posting. Existing null currencies are backfilled only where the account's denomination history is unambiguous; uncertain rows go to a reconciliation report.

Canonical account effects: asset balance = opening + increases − decreases; liability balance = positive amount owed, a purchase or borrow increases it, a repayment reduces it, never hidden with abs(); an expense on a credit account is an expense, not debt paid; a repayment from checking to a card reduces cash and liability and is not a second expense; a transfer is one operation with both legs, currencies, explicit rate and fee, accounts locked in stable id order, and never strands a leg; a split parent counts once and children equal its amount exactly with a deterministic visible rounding residual; refunds reverse the original economic category; pending items are excluded from posted balances and actual reports unless a view explicitly includes and labels them; amount, date, type, account and version are preserved for optimistic conflict detection (stale edit 409).

Mutation order: authenticate and check capability → validate references → idempotency and fingerprint → begin transaction → lock actor, resource, accounts and dependencies in documented order → recheck state → compute exact old and new effects → write ledger, splits, links, lots, balances, audit, outbox → commit → invalidate and revalidate caches → publish. No external provider or e-mail call inside a financial transaction. Failure before commit changes nothing; external delivery retries use outbox identity.

Account currency, asset or liability type and opening balance freeze once activity exists; corrections go through an explicit previewed, audited adjustment. Goal progress sources are typed (manual contribution, linked posted transaction allocation, assigned account balance, real transfer) and never double-counted; link amounts use dated FX and stored provenance; unlink, edit and delete restore the prior progress exactly; overfunding requires explicit confirmation; malformed, non-positive, non-finite or out-of-range money is rejected.

## A6. Imports, organisation and planning

Both import entrances share parsing, identity, balance and audit. Preview shows the chosen date format and timezone, the mapping including Notes, account and currency, row validation, duplicate candidates and expected effects. Impossible dates are rejected (`validDateSchema`); ambiguous formats require a choice. Identity per D13; changed content under the same key is 409. Overwrite previews the exact affected rows and versions, rejects any set that intersects a paired transfer unless a user-reviewed pair-preserving operation is chosen, replaces within one transaction adjusting both balances, and never soft-deletes then skips. Import history records honest created, updated, skipped and rejected counts; deliberate duplicate rows are not "invalid".

Rules: a pure planner returns validated proposed effects; a separate executor writes. Dry-run and preview may read and never write tags, counts, aliases, splits or audit events. References are checked against the actor's household and visibility on create, update and execution; invalid legacy rules are quarantined with an explanation. Amount splits sum to the parent; percentage splits sum to 100. Apply-to-past itemises errors.

Categories, groups and archive state; tag normalisation and scoped uniqueness; merchant aliases, logos, detail, merge and undo; usage counts from actual affected rows; default filter presets applied on entry and never over explicit URL filters; group archive is atomic with preview or blocked with an explanation.

Budgets use posted authorised spend including splits and refunds with dated FX; historical suggestion is sum divided by included elapsed periods with legitimate zero months and no future months, previewed before overwriting manual budgets; rollover state persists in household policy and the carry is created once under unique period identity; batch audit identity is a UUID with affected ids in metadata. Partial goal-account assignment defaults form a valid request; goal forecasts use calendar months and household-local today.

## A7. Reports, FX and calendar

Global provider FX and securities are service-written and read-only to households; owner and admin create household overrides with immutable actor, source, pair, as-of and precision; legacy global manual rows are not assigned to a household without provenance. Flow conversion uses the latest approved rate on or before the transaction date within configured validity; valuation uses the report's as-of rate. A required monetary operation with a missing rate returns a typed 422 naming pair and date; an analytical display may return `complete: false` with the missing components and no misleading total; writes needing conversion fail before mutation.

For equal actor, filter, period and economic definition, transaction list and summary, dashboard, budgets, cash flow, ratios, annual reports, category buckets, Sankey and CSV reconcile; Uncategorised and Unassigned are explicit buckets; split children replace the parent contribution; card spend and debt repayment stay distinct; aggregate in high precision and round at output with a stated residual policy.

Date-only fields are `YYYY-MM-DD`; event instants are UTC; intervals are half-open internally with the existing inclusive API `endDate` translated deliberately; household timezone drives local days, weeks (seven dates), tax years and schedules; monthly anchor stored (31 Aug → 30 Sep → 31 Oct). Cache keys include household, actor visibility revision, period, currency and policy version; commit triggers all server and client invalidation with revision tokens as the fallback; other members' writes appear through bounded refetch, not `staleTime: Infinity`. History is reconstructed only from immutable events or labelled snapshot-only or incomplete.

## A8. Investments, GRZ and pension

Every buy, opening holding and automated contribution creates or reconciles lot and basis provenance; quantities positive; sells lock holding and lots and cannot oversell; FIFO disposal records quantity, basis, fees, proceeds, currencies and dated FX; portfolio cost basis follows remaining lots; pension records validate employee plus employer totals, dates, corrections and whether cash moved.

Acquisition and settlement are separate (D10). State machine active → sold or matured with durable settlement state; scheduled coupons and principal after disposal are unpayable; a late genuine entitlement is a reviewed adjustment; sell and pay races lock the holding and cannot both consume an entitlement; due date, destination and money range validated before posting. Worked example with synthetic values: face 1000, cost 950, as-of value 1000; principal settlement moves 1000 from the holding to cash, aggregate net worth unchanged, ordinary income zero, realised difference 50 classified separately and explained once; coupon 100 with a synthetic 15% withholding posts net 85 and records gross 100 and withheld 15, and that rate is a test fixture, not a legal claim.

Zero-interest maturity is valid; negative discount, malformed rate, maturity before purchase and unsupported tenor are rejected; rates are decimal fractions with explicit UI units; `Money.isPositive()` is strict. Day-count, compounding, fees, withholding and tax-year policy are versioned; OI-03 supplies current conventions; missing live rollover terms block automatic reinvestment and create a pending item.

## A9. Jobs, files and outbound

Jobs per D15: registry covers recurring, rollover and alerts, goal dates, snapshots, FX and market refresh, investments and GRZ maturity, outbox, receipt matching, recap and cleanup; identity is job plus household or resource plus due period with a unique constraint; claim with fencing generation, renew while working, reject stale completion, retry with bounded backoff, checkpoint, catch up at most 100 items per invocation; members cannot force a future `asOfDate`; expose last due, last success, lag, attempts, error class and owner. Default deployment design: the declared Render web service, PostgreSQL and Redis, durable storage per D18, external authenticated scheduler (Render cron services calling `/api/cron/*` with `CRON_SECRET`, constant-time compared); coordination keys outside the `allkeys-lru` cache namespace.

Files: opaque storage key, household and requester, checksum, media type, size and lifecycle; never an absolute server path in a DTO; authenticated downloads revalidate visibility; historical tracked files move only with manifest, checksum and rollback; OCR assets pinned and self-hosted under the production CSP; receipts per D17.

Notifications per D16 with unique event, recipient and channel identity; consent, preferences and quiet hours honoured through the `user_quiet_hours` model with timezone and cross-midnight validation; HTML-escaped user strings; push origin allow-list with DNS and IP checks, no credentials, non-standard ports, private or loopback destinations, bounded connections and redirects, egress tests against local mocks only; recap feedback persisted structured and queryable; missing VAPID configuration is a truthful not-configured state, not a 500; counters count actual outcomes.

## A10. Migration and API contracts

| Data contract | Identity, state and constraints | Work order |
|---|---|---|
| Membership and revocation | Active membership uniqueness; exactly-one-owner guard; per-user session generation | R01, R03 |
| Preferences and saved views | User or household scope, version, validated filter schema, no embedded SQL | R05 |
| Export and erasure jobs | Requester and subject, immutable request key, state, manifest, retention and expiry, tombstone replay marker | R07 |
| Import batches and rows | Account, fingerprint, mapping version, ordinal or reference, outcome, linked ledger ids | R09 |
| FX and security overrides | Household scope, provenance, pair or instrument, effective date, unique scoped identity | R12 |
| Instrument settlements | Holding and event identity, linked cash entry, basis and fees, policy version, state, audit | R13 |
| Job runs | Unique due identity, fencing generation, lease, attempt, outcome, last success | R14 |
| Storage and delivery manifests | Scoped object or delivery identity, checksum or status, retry and deletion state | R15, R16 |
| AI requests, attempts, budgets, consent | Part B | R17 |

All financial mutations support operation idempotency and conflict detection. Outcomes: 400 malformed, 401 unauthenticated or revoked, 403 known forbidden, 404 invisible, 409 state or version conflict, 422 missing required financial data, 429 application limit, 503 unavailable dependency; a degraded analytical result is 200 only with truthful `complete`, `degraded` and provenance flags. Unknown `/api` routes return the canonical JSON 404 before the SPA catch-all. Migrations follow expand → validate and report → bounded backfill → verify → constrain → contract later; test empty and populated upgrades, rollback compatibility and restore; never auto-repair ambiguous histories by guessing; record counts, checksums, exceptions and before values.

## A11. Operational inputs and assumed defaults

Inputs only the owner can supply. An agent builds safe configuration and synthetic tests without them and stops only the dependent action.

| ID | Input | Blocks | Safe progress meanwhile |
|---|---|---|---|
| OI-01 | Hosting accounts, staging and live origins, DB, Redis, storage, cron, SMTP and VAPID credentials, named operator | External staging and production verification | Local synthetic implementation and manifests |
| OI-02 | Claude and Gemini keys, allowed model ids, Claude credit balance and conditions, per-app, household, user and provider monetary caps, period timezone, pricing versions, small staging budget | Paid calls | Deterministic mocks; zero paid admission by default |
| OI-03 | Qualified current source for tax, withholding, day-count and reporting conventions | Real tax-labelled output; real-money GRZ automation | Synthetic labelled policies and structural tests |
| OI-04 | Retention and privacy wording, legal holds, sensitive-field necessity, backup deletion policy | Real-user export and erasure policy | Synthetic end-to-end lifecycle |
| OI-05 | Named implementation, review, UAT and operations owners and capacity | Calendar commitment and sign-off | Packet queue and handoff |
| OI-06 | Explicit production deployment and rollout authorisation | Production mutation and invitations | Staging and UAT preparation |

Assumed defaults an agent may build against while an input is open, each labelled as a proposal in code and UI and never enabled for real users on the assumption alone: withholding 15% per instrument type (OI-03); profile sensitive fields retained for the life of the account and erased on deletion (OI-04); step-up threshold 5,000 in household currency with dated FX (owner); mandatory-MFA re-authentication within 24 hours of a policy change (owner); limiter 600 requests per user per 60-second sliding window, auth endpoints 10 per minute per IP (owner); performance and recovery targets API p95 at or under 500 ms and primary interaction at or under 3 s at 100 users across 20 synthetic households, restore RPO at or under 24 h and RTO at or under 4 h (ratify at G0); Node runtime the current Active LTS verified against the release schedule; Playwright browser install approved for the development machine; git history for the 30 tracked upload files not rewritten (stop tracking only); support channel a "report a problem" mail link carrying the request id.

## A12. Completion and evidence

Row lifecycle: OPEN → IMPLEMENTED (code merged) → LOCALLY_VERIFIED (regression and isolated runtime evidence) → STAGING_VERIFIED (production-mode staging at a known SHA) → CLOSED (primary and supporting packet acceptance reviewed). REFUTED requires exact counter-evidence recorded in the register. A row closes only with implementation SHA, regression path and result, runtime target and mode, independent read-back where applicable, negative, race and retry cases, and review disposition. A merged commit is not deployment; a configured provider is not a verified provider; a green mock is not persistence.

All 22 work orders and J01–J16 must pass at one candidate SHA on production-mode staging. Security or financial fixes invalidate affected evidence; a release-blocking regression resets the 14-day soak. Owner UAT and deployment authorisation are separate from technical verification.

---

# Part B. Thandi contract (Claude primary, Gemini fallback, local degraded mode)

The governing full contract is section 3 of the [master specification](../../plans/2026-10-15-master-completion-spec.md#thandi). The earlier `docs/reviews/2026-10-11-deep-readiness/THANDI_PROVIDER_SPEC.md` and `docs/reviews/2026-10-15-consolidated-completion/THANDI_SPEC.md` remain historical sources. This part is a companion summary; master failure classification, consent, funding and spending rules prevail over any conflicting summary or R17 oracle here.

B1. Provider order. Claude (direct Anthropic API on the official SDK) analyses the question and proposes tool calls, then explains sanitised tool results. On an eligible Claude failure (connection, bounded timeout, transient 5xx or overload, transient throttle) Gemini may take the remaining stages; once switched, the request stays on Gemini. If both fail, the existing keyword and template mode produces a clearly labelled limited answer from authorised tool results, or an unavailable state when nothing useful is permitted. Never parallel providers; never more than one attempt per provider per stage; at most three paid calls per logical request; 30-second overall deadline with a reserved fallback window; abort signals honoured, late responses ignored; SDK retries set to zero. No fallback evades a consent, authorisation, validation, safety or spending outcome; application and database errors propagate as themselves.

B2. Current code facts (verified at `381e943`): `ai.gemini.ts:27` hardcodes `gemini-2.0-flash` (past its listed shutdown) and `:28` a 10 s non-cancelling promise race (`:688-700`); tool definitions and the system prompt live in the Gemini file in Gemini schema shape; `ai.service.ts:204,217,272` are the three provider touch points; `:385-390` carries `used_gemini`, `provider_attempted`, `provider_error`; `ai.fallback.ts:41-45` classifies provider failures by two error codes; `ai.controller.ts:30` holds `CURRENT_CONSENT_VERSION = 'v1.0'` and `:98` reports `degraded` from configuration; `ai.middleware.ts:231-260` checks only `aiConsentGiven` (an outdated version is reported, not enforced) and `:60-110` charges 50 requests per household per day before dispatch; `ai.tracking.ts` records `token_count` only; `ai.eval-pack.ts:52` is six static prompt checks with zero prompts; the chat endpoint has no idempotency key; conversation list, get, delete and exchange persistence exist in `ai.conversation.service.ts` (the "stub" claim in CLAUDE.md is stale); `@anthropic-ai/sdk` is not installed; `ANTHROPIC_*` variables are absent from `validateEnv.ts`.

B3. Persistence (new entities; reuse an equivalent table only after documented parity): `ai_requests` (household, actor, client request key, canonical fingerprint, consent version, status, chat-quota state, final response id; unique household plus actor plus key; conflicting fingerprint 409); `ai_attempts` (request, stage analysis or answer, provider and model, ordinal, dispatch claim, status reserved, dispatched, succeeded, failed, usage_unknown, provider request id, known token classes, deadline, error class; unique request plus stage plus ordinal); `ai_budget_reservations` (attempt, budget identity, original period, price version, reserved, actual, settlement version, unknown flag; unique attempt plus budget; decimal amounts); `ai_budget_accounts` (scope app, household, user or provider; period and timezone; currency; ceiling; settled and reserved exposure; version; locked in stable order); `ai_consent` (household, policy version naming both processors, granting or revoking actor and timestamps).

B4. Admission. In one transaction: verify actor, household, capability and consent version → claim or replay the request fingerprint → lock budget accounts → test settled plus outstanding plus uncertain exposure against every ceiling → reserve the chat-quota unit and the attempt's conservative maximum cost at dated list prices (D03: Claude credits are a ceiling, not a zero price) → commit → dispatch once. Settlement replaces reservation with actual usage idempotently; duplicate or out-of-order events never double charge or double refund; timeout, loss or crash after possible dispatch marks usage unknown and retains the hold across restarts and period boundaries until an auditable reconciliation; a Gemini attempt needs its own reservation while a Claude hold exists; no DB lock is held across network I/O. App or household quota denial is final for paid work. Billing-cap failover is disabled by default.

B5. Quota, local mode and audit. One useful final answer (external or local) consumes one chat unit per logical request; a permitted local-only request reserves the same unit without a paid reservation and still needs consent; validation, authorisation or consent rejection before admission consumes nothing; a terminal unavailable or cancelled request refunds the unit at most once while any monetary hold stays; replay returns the stored outcome. A missing key or failed call is audited with sanitised status and provenance; an empty assistant success message is never persisted; with no external key configured a consented request is served by the local mode with provider `local` recorded. Headers, `remainingQueries` and the documented period agree; per-minute transport throttles are distinct from the daily allowance.

B6. Consent. Version the disclosure to name Anthropic and Google; `consentCheckMiddleware` blocks external attempts when the household's version is outdated; owner and admin only manage consent (existing `requireRole('admin')` on `POST /api/ai/consent`, inheriting the role-guard fix in R04); other roles see non-actionable status; revocation is rechecked before each outbound attempt and cancels queued or in-flight work where feasible. Disclosure text states which data leaves, names both processors and their retention terms once OI-02 verifies them, and does not promise removal of personal identifiers from typed questions.

B7. Provenance and status. Audit metadata: logical request id, ordered attempts with provider, model, stage, outcome, failure category, external request id, known or unknown usage, consent version, whether transmission was attempted, final answer mode and provider. `used_gemini` is kept for historical rows and never true for a Claude answer. Client labels: "Answered using Claude", "Answered using Gemini — backup provider", "Limited local summary". Status endpoint distinguishes unconfigured, configured but unhealthy, degraded (fallback operating), quota-limited and complete outage; circuit breaker per provider and model with cooldown and a controlled recovery attempt, state in Redis, Claude returning to primary after recovery.

B8. Evaluation and evidence. CI runs deterministic transports and a recorded evaluation set of 20 to 30 prompts with expected tool calls and golden amounts from a fixed fixture, for both adapters; it never reaches a provider. Staging smoke under OI-02 records three scenarios: Claude healthy; forced eligible Claude transport failure then Gemini; both fail then local or unavailable; asserting analysis and answer provider separately, at most three paid calls, no hidden SDK retry, same-request replay, cancellation and late result, revocation between stages, the last-budget-unit race across two instances, and retained unknown cost after restart.

B9. Files. New: `server/modules/ai/ai.provider.types.ts`, `ai.claude.ts`, `ai.provider-orchestrator.ts`, `ai.admission.repository.ts`, `__tests__/completion-r17.realdb.integration.test.ts`, a versioned migration generated at implementation time. Modified: `ai.service.ts`, `ai.gemini.ts` (configurable model, conforming adapter), `ai.fallback.ts`, `ai.controller.ts`, `ai.middleware.ts`, `ai.tracking.ts`, `ai.types.ts`, `ai.validation.ts`, `ai.conversation.repository.ts`, client `features/ai/*`, `validateEnv.ts`, `.env.example`, deployment configuration (variable names only). Keep the LOC ratchet: extract, do not grow `ai.service.ts` or `ai.gemini.ts`.


---

# Part C. Unified register: what remains

All rows are OPEN at `381e943` and all are required for completion (D23). Ids are the original Codex ids and the NEW-xx ids assigned to Fable-only findings in the Codex consolidation; the Fable ids they absorb are listed as aliases so both assessments' evidence can be found. Verification states: HTTP+DB (reproduced over HTTP with database read-back), HTTP, BROWSER, PARSER (pure function executed), SRC (confirmed in source), NOT EXERCISED (adopted on source citations; must be reproduced inside the work order). Evidence lives at the cited paths; `REGISTER.csv` beside this file carries the same rows with status, owner, SHA and evidence columns for tracking.

## C1. P0 (18 rows)

| Id | Title | Aliases | Verification | Work order |
|---|---|---|---|---|
| AH-01 | Session revocation does not invalidate live cookies; express `session` row survives; correct helper used only by password change | SES-01 | HTTP+DB (both) | R01 |
| FIN-01 | Private financial data bypasses account and transaction visibility through goal links, activity and summary, goal detail assignments, investments holdings and valuation, account transaction export; create API never sets `transactions.is_private` | PRIV-01, PRIV-03, PRIV-04, PRIV-05 | HTTP+DB (both, goal path); investments and export variants NOT EXERCISED | R04 |
| ORG-002 | Tag transaction lists ignore account privacy | PRIV-02 | HTTP (Fable), SRC (Codex) | R04 |
| OPS-005 | Recurring rules on private accounts visible to other members, directly and through the weekly recap | PRIV-05 | HTTP (recurring routes), SRC (recap) | R04, R16 |
| NEW-01 | Outsider household reads `GET /api/goals/:id/activity` (`goals.controller.ts:359-369` ignores householdContext) | ISO-01 | HTTP (Fable, skeptic re-run) | R04 |
| ORG-003 | Rule actions accept and apply category, tag, owner and split-category ids from another household; foreign tag usage count polluted | | HTTP+DB (Fable 14 Oct) | R04, R11 |
| NEW-12 | Ownership operations orphan the household (transfer to self 200) or create a second owner who can demote the first | SEC-06, SEC-07 | HTTP+DB (Fable) | R03 |
| FIN-02 | Replaying an overwrite import soft-deletes rows and skips replacements (balance 1257.50 → 415.00 with a success response) | IMP-01 | HTTP+DB (both) | R09 |
| FIN-03 | Account-level overwrite deletes one leg of a transfer | | SRC (both; confirmed 14 Oct at `ImportService.ts:279-352`) | R09 |
| NEW-05 | Card purchase reduces the liability instead of increasing it (net worth 41668.69 vs 41577.69) | RC-03 | HTTP+DB (Fable) | R08 |
| FIN-06 | Budget spend sums foreign-currency amounts unconverted (USD 50.00 counted as K50.00) | BGR-01 | HTTP+DB (Fable), SRC (Codex) | R10 |
| NEW-02 | Ratios and debt analysis convert nothing and ignore privacy filters (liquid assets 40202.92 vs 42115.42 at the stored 26.50 rate) | RC-01 | HTTP (Fable, twice) | R12 |
| NEW-13 | `fx_rates` and `securities` are global and writable by any member of any household; one household's rate changed another's net worth | RC-02, INV-06 | HTTP+DB (Fable) | R12 |
| NEW-03 | GRZ principal repayment booked as ledger income (250000.00) | GRZ-01 | HTTP+DB (Fable) | R13 |
| NEW-04 | Coupons and principal of a sold bond still payable; early pay and pay to another account accepted | GRZ-02, GRZ-04 | HTTP+DB (Fable) | R13 |
| NEW-18 | Receipt create-transaction repeatable (double charge 88.40) and accepts a negative amount that raises the balance | RCP-01, RCP-02 | HTTP+DB (Fable) | R15 |
| OPS-003 | No scheduler drives recurring, rollover, snapshots, FX or investment automation in the declared deployment; `CRON_SECRET` optional (P0 per D20) | F-OPS-01 | SRC (both) | R14, R19 |
| OPS-008 | Push subscription accepts any HTTPS endpoint; the server later connects to it (P0 once push is enabled) | | HTTP (accept observed); egress NOT EXERCISED | R16 |

## C2. P1 (80 rows)

| Id | Title | Aliases | Verification | Work order |
|---|---|---|---|---|
| AH-02 | User, profile and member DTOs expose MFA code, backup codes, verification token hash, `nrc`, `salaryRangeEncrypted`, lockout counters | F-AUTH-02 | HTTP (both) | R01 |
| AH-10 | One-time MFA and backup code consumption not atomic | | NOT EXERCISED | R01 |
| AH-12 | Password change bypasses the registration and reset policy | | NOT EXERCISED | R01 |
| NEW-38 | Deleted user's express session survives via the tombstone; e-mail and password change send no notice and write no security event; login-noise notifications | DEL-01, SNA-SEC-02 | DB+SRC, HTTP | R01, R16 |
| AH-03 | Verification mail links `/auth/verify-email`; client routes `/verify-email`; link renders 404; login refuses unverified users | F-AUTH-01 | BROWSER+DB (Fable), SRC (Codex) | R02 |
| NEW-07 | CSRF token bound to a non-persisted anonymous session: verify-email and e-mail-change verify always 403 outside the registering session | F-AUTH-04 | HTTP (Fable) | R02 |
| AH-04 | Registration session has full API access while unverified | F-AUTH-03 | HTTP+DB (Codex) | R02 |
| UX-01 | First-run and anonymous pages fire household-dependent queries: error toasts and raw 404 JSON | F-UX-01 | BROWSER (both) | R02, R18 |
| NEW-27 | No categories seeded on household creation; first household lacks setup guidance (P2 in Codex, raised because the picker depends on it) | F-ONB-01 | BROWSER+DB | R02, R11 |
| NEW-08 | `generalLimiter` mounted globally and per router: 429 within three page loads; 5-per-minute per-IP auth limiter on `/api/auth/*` incl. `/me` | F-SEC-04b, F-SEC-04c | BROWSER+HTTP (Fable) | R00 |
| AH-05 | Add Member posts to non-existent `POST /api/household/members`; invite mail links `/invite/:code` with no client route or accept caller; members show "Unknown User"; UI offers a role the server rejects; no client callers for leave and transfer | F-HH-01, SEC-02, F-HH-03 | BROWSER+HTTP (both) | R03 |
| AH-06 | Invite acceptance does not check the recipient (joined as admin on an invite to nobody@); one-household check outside the acceptance transaction | SEC-01 | HTTP+DB (recipient), NOT EXERCISED (concurrency) | R03 |
| ORG-001 | `requireRole` hierarchy lacks `professional`; `undefined < level` is false so the guard passes for that role and any unknown value (P0 once a Professional membership can be created) | | SRC (confirmed 14 Oct, `validateEntity.ts:266-301`) | R04 |
| AH-09 | View-only member writes household-level `household_preferences`; report exports and recap generate lack a role gate | F-SEC-01 | HTTP+DB (Fable 14 Oct) | R04, R05 |
| NEW-33 | Malformed ids return 500; unknown `/api` routes fall to the SPA; `/recurring/detect` 500; version alias behaviour undocumented | | HTTP | R04, R14 |
| AH-07 | `PUT /api/settings/profile` drops 14 of about 22 form fields and returns "Profile updated" | SET-01 | HTTP+DB (both) | R05 |
| NEW-26 | Preferences section writes household preferences; nothing writes `user_preferences`; notification preference partial update nulls omitted thresholds and accepts arbitrary types | SET-02, settings SET-04 | HTTP+DB | R05 |
| NEW-11 | Accounts page defaults to `ownerUserId=shared` and hides the first account; Shared/Mine/All not persisted | F-ACC-01 | BROWSER | R05, R11 |
| NEW-16 | Rollover gated on `household_preferences.auto_rollover_budget`, which nothing can set | BGR-02 | HTTP+DB | R05, R10 |
| AH-13 | Fake "Household Premium" panel; dead "Configure shared views" control; unsupported promises (P2 in Codex; shared views now in scope) | F-HH-02 | BROWSER | R03, R05 |
| AH-11 | MFA has no enrolment, disable or recovery UI; mandatory flag inert; enable path does not require proof of possession | F-SEC-05, settings SEC-03 | BROWSER+SRC, HTTP | R06 |
| AH-08 | Personal-data export is a stub (fake id, no row, no file, no audit, no UI); deletion keeps e-mail and IP in security logs and the password hash on the tombstone, deletes the household audit history, has no UI | DATA-01, F-SEC-02, DEL-02 | HTTP+DB, DB+SRC | R07 |
| NEW-32 | Account CSV exports and several money writes (pension, SIP, market refresh, budget settings, attachments, cron ledger writes) write no audit row; account create writes two | RC-13, F4, F-ACC-02 | HTTP+DB | R07, R08 |
| FIN-16 | Transaction UPDATE audit written after commit, outside the transaction | | SRC | R08 |
| FIN-05 | Import and recurring persist `currency = NULL`; DTOs default to ZMW; summary labels converted totals as ZMW | X-01 | DB (both) | R08 |
| FIN-17 | Transaction summary cached five minutes under `txn-summary:*`, never invalidated on write; client query-key mismatch; summary uses latest not dated FX | F-TXN-01, RC-06 | BROWSER+HTTP (both) | R08, R12 |
| NEW-15 | Clock and period boundaries disagree: client builds "this month" in UTC across 23 call sites; naive timestamps mix DB-local `now()` and JS UTC (+2 h skew, invitations accepted before created, expiry windows short, tax year in UTC); goal forecasts use 30-day months | RC-08, F-DATE-01 family, SEC-04, budgets GOAL-04 | HTTP+DB | R12, R08 |
| FIN-08 | Editing a split parent's amount leaves children and dependent totals stale | | NOT EXERCISED | R08 |
| FIN-13 | Account currency, type and opening balance editable under existing ledger rows without reconciliation | | NOT EXERCISED | R08 |
| ORG-005 | Rule split allocations can exceed the parent amount | | NOT EXERCISED | R08, R11 |
| NEW-28 | Owner selector ignored on create (`create.ts:186` always the creator); `staleTime: Infinity` hides other members' writes | F-TXN-03, F-UX-02 | BROWSER+DB, SRC | R08 |
| NEW-06 | Card spending moved to a "debt" bucket and excluded from expenses and savings | RC-04 | HTTP+DB | R12 |
| NEW-14 | Split transactions missing from budget comparison, transactions report, Sankey and both CSV exports (October actual 1073.75 vs 1273.75) | RC-05 | HTTP | R12 |
| FIN-14 | Valuation errors caught; net worth returned without the holdings and without a completeness flag | | NOT EXERCISED | R12, R13 |
| FIN-18 | Monthly trends parse a formatted month label as ISO: "Invalid Date", grouped values lost | F-REP-01 | BROWSER (both) | R12 |
| NEW-34 | Secondary report totals not reconciled: 8-day recap week, missing-rate 500s on some reports, penny footing, merchant total excludes unassigned, net-worth history snapshot-only, cash-flow averages include future months | RC-09, RC-10, RC-11, RC-12, RC-14, F-CF-01 | HTTP | R12 |
| FIN-04 | Account-detail import skips every valid row (uuid type mismatch) and reports success | | HTTP (Codex) | R09 |
| FIN-15 | `2026-02-30` accepted and saved as 2026-03-02; ambiguous slash dates parsed inconsistently; Notes mapping dropped | IMP-03 | PARSER (Codex), HTTP+DB (Fable) | R09 |
| NEW-17 | Dedupe key is date, type and amount, so legitimate repeated purchases merge; `data_imports` never written | IMP-02 | HTTP+DB | R09 |
| FIN-07 | "Historical averages" writes the multi-month total as the monthly budget (550.00 where 183.33), overwrites manual budgets, creates 79 zero budgets; recalc and clear audit rows fail silently (`entityId "bulk:<uuid>"`) | BGR-03, BGR-04 | HTTP+DB (Fable), SRC (Codex) | R10 |
| FIN-09 | Goal transaction links do not preserve progress through edit, delete and unlink; default partial assignment invalid | budgets GOAL-03 | NOT EXERCISED | R10 |
| NEW-29 | Contribution of 1,000,000 accepted and irreversible | GOAL-01 | HTTP+DB | R10 |
| NEW-10 | Recurring rules cannot be created from the UI (form omits `frequency` and `nextDueDate`; 400 with no message) | F-REC-01, REC-01 | BROWSER | R14 |
| NEW-30 | Monthly rule drifts after a short month (day capped at 28); one missed occurrence per run; member can post future-dated occurrences via `asOfDate` | REC-02, REC-03, REC-04 | HTTP+DB | R14 |
| FIN-12 | Investment schedules miss overdue executions and drift past month-end; SIP with a past next-date never runs | INV-10 (schedule) | SRC (Codex), HTTP+DB (Fable) | R13, R14 |
| OPS-013 | Scheduler locks expire without renewal, carry no scheduled-date identity, share the `allkeys-lru` namespace | | SRC | R14 |
| ORG-004 | Dry-run with add_tags writes a tag link and bumps usage count; with split_transaction creates two split rows; response reports neither | | HTTP+DB (Fable 14 Oct) | R11 |
| ORG-006 | Six merchant-detail endpoints the UI calls return 404 (analytics, transactions, alias add and delete, logo upload and delete); `POST /rules/:id/test` 404 | ORG-02, F-CLIENT-01 | HTTP+SRC (both) | R11 |
| ORG-007 | Merchant delete options disagree with server behaviour | | NOT EXERCISED | R11 |
| ORG-010 | Saved default filter preset stored but never applied; preset create and delete UI unreachable (P2 in Codex; raised because the control is advertised) | F-CLIENT-02 | SRC | R11 |
| NEW-19 | `POST /api/tags/merge` returns 500 (uuid vs text in SQL) | ORG-01 | HTTP | R11 |
| NEW-09 | Category picker lists only Uncategorized (form filters on a `groupType` the API never returns) | F-TXN-02 | BROWSER+SRC | R11 |
| FIN-10 | Buys never update `holdings.cost_basis` | INV-01 | HTTP+DB (Fable), SRC (Codex) | R13 |
| FIN-11 | Automated and POST-created holdings have no tax lot so selling returns 409; negative-quantity sell adds phantom shares | INV-02, INV-03 | HTTP (Fable), SRC (Codex) | R13 |
| NEW-20 | Negative sale creates phantom holding quantity | INV-02 | HTTP | R13 |
| NEW-21 | `amount_zmw` never computed from posted FX (180 USD gain reported as 180.00 ZMW) | INV-04 | HTTP+DB | R13 |
| NEW-22 | Tax summary shows 0.00 interest income and ZRA export empty despite WHT; 31 December dividend counted in two tax years | INV-07, INV-08 | HTTP+DB | R13 |
| NEW-23 | Bond create accepts couponRate "14" (coupons of 70000 on 10000 face), negative face, maturity before purchase; `Money.isPositive()` true for zero so a T-bill at face fails every maturity run; cron response echoes SQL | GRZ-05, GRZ-06 | HTTP, HTTP+DB | R13 |
| NEW-24 | Pension contributions unvalidated, unaudited, no transaction | INV-10 | HTTP+DB | R13 |
| NEW-25 | GRZ, tax and pension tabs unreachable without an equity holding; `/investments/tax` link broken | F-INV-01 | BROWSER | R13 |
| GRZ-03 (as NEW-03 supporting) | Selling a bond computes no gain or loss, credits no cash, absent from tax reports | GRZ-03 | HTTP+DB | R13 |
| OPS-001 | Uploads on ephemeral local disk; 30 user files tracked in git; no disk or object storage in render.yaml | F-OPS-02 | SRC (both) | R15, R19 |
| OPS-004 | OCR worker and WASM assets conflict with the production CSP | | SRC | R15 |
| NEW-39 (part) | Receipt details expose server filesystem paths | | HTTP | R15 |
| OPS-006 | Recap returns zeros on missing FX; e-mail labels ZMW as "$"; history shows current net worth for every week | RC-07, SNA-REC-03, SNA-REC-04 | HTTP (Fable), SRC (Codex) | R16 |
| OPS-007 | Saved recap content preferences do not govern generated content; recap settings cross-write (recap day overwrites first-day-of-week; widget save resets recap toggles) | SNA-REC-01 | HTTP+DB | R05, R16 |
| OPS-009 | User-controlled names interpolated into notification and invitation e-mail HTML | VAL-01 | SRC (Codex), HTTP (Fable, invite) | R16, R03 |
| OPS-010 | Notification delivery status and dedupe do not reflect per-channel outcomes; missing VAPID gives 500; alert counter counts deduplicated attempts; quiet hours have no writer | settings NOT-01, NOT-02, NOT-03 | NOT EXERCISED, HTTP | R16 |
| NEW-31 | Recap feedback claims recorded without structured persistence; recap period snapshots and settings overwrite one another | settings REC-05 | HTTP+DB | R16 |
| OPS-012 | Provider failure or no provider returns 200 with an empty or irrelevant answer; quota consumed; retired model id; status reports configuration not health; consent version not enforced; no chat idempotency; evaluation pack has no prompts; CHG-AI-01 not implemented | F-AI-01, AI-01, CHG-AI-01 | BROWSER+DB (Fable), SRC (Codex) | R17 |
| UX-02 | Phone viewport: sidebar covers and clips content; reports overflow at 1280 px | F-MOB-01 | BROWSER (both) | R18 |
| NEW-37 | Visible controls, attribution and validation inert or misleading: silent wizard validation, transfer legs indistinguishable, native `confirm()` dialogs, dead TopBar radios, disabled "Reset Defaults", toast-only "Copy balance history", "Good morning, User", unlabeled icon buttons (P2 in Codex; raised under D23) | F-GOAL-UX-01, F-TXN-04 | BROWSER | R18 |
| DEP-01 | Nine production advisories (1 critical `proxy-addr`, 4 high); CI audit step would fail | F-DEP-01 | RUNTIME (both) | R00 |
| DEP-02 | Node 20 pinned in `engines`, CI and render.yaml; end-of-life | | SRC | R00 |
| OPS-011 | Local Playwright can run against the dev database; root vitest config unguarded; stale tracked coverage; local smoke blocked by browser build mismatch | F-TEST-01 | SRC (both), environment | R20 |
| OPS-002 | `/healthz` checks only the shutdown flag; readiness never probes Redis | F-OPS-03 | SRC (both) | R19 |
| OPS-014 | Logger serialises a fixed field list and drops context; `redactSensitive` unused | F-OPS-04 | SRC (both) | R19 |
| OPS-015 | DB TLS certificate verification off unless explicitly configured | F-OPS-06 | SRC (both) | R19 |
| QA-01 | Playwright specs fill forms without submitting or assert nothing; `if (control)` guards pass silently; populated investment tab skipped | | SRC (Codex, suite run) | R20 |
| QA-02 | No staging, no backup restore drill, no rollback rehearsal, no load test, no real devices | F-OPS-07 | explicit gap | R19, R21 |

## C3. P2 (12 rows)

| Id | Title | Aliases | Verification | Work order |
|---|---|---|---|---|
| ORG-008 | Merchant undo adjusts counts from the original snapshot, not restored rows | | NOT EXERCISED | R11 |
| ORG-009 | Repeated tag removal decrements usage count; stale usage counts | | SRC | R11 |
| NEW-35 | Money DTOs and precision inconsistent in peripheral views (goal summary and portfolio amounts as numbers; floats in portfolio values; 360 vs 365-day bases, unrounded vs stored rate, tenor and maturity disagreement, fees dropped, coupon rows unnamed) | GRZ P2 items | HTTP+DB | R08, R12, R13 |
| NEW-36 | Archive filters and normalisation: `includeArchived=false` ignored; tag names duplicate by case and whitespace; rules accept non-existent action values | | HTTP | R11 |
| NEW-39 | Schema and legacy cleanup: long FK names will churn generated migrations, no tag uniqueness, admin route on a missing table, tracked upload files | F-DATA-01 | SRC | R00, R19 |
| settings SET-05 | Currency change on a household with a ledger produces 500s and a zeroed recap | SET-05 | HTTP | R05 |
| AH-13 (remainder) | Unsupported collaboration promises beyond the Premium panel | | BROWSER | R18 |
| OPS-007 (remainder) | Recap day control versus fixed Monday schedule copy | | SRC | R16 |
| GOAL (misc) | Goal detail exposes assigned account name and balance without privacy filtering (FIN-01 goal-detail variant) | | SRC | R04 |
| REC (misc) | Recurring skip, pause and end-date semantics implicit | | HTTP | R14 |
| ENV | Module assessment metadata, W9/W10 coverage and CLAUDE.md status statements stale | | SRC | R21 |
| UX (misc) | Reports horizontal overflow at desktop widths; toast copy for raw server errors | | BROWSER | R18 |

## C4. What verifiably works (regression obligations)

Keep these green; they are the exercised scope of the assessments, not a claim about untested paths.

- Ledger: balances to the cent after income, expense and transfer; paired transfer legs; idempotent creates; `FOR UPDATE` under three-way concurrent goal transfers (exactly two succeed); five concurrent contributions summing exactly; no duplicate budget periods under concurrent recalculates; recurring materialisation exactly once per period; zero drift across 21 accounts and 89 transactions.
- Money: Money class arithmetic; budget spent and remaining to the ngwee for single-currency spend including month boundaries and splits; GRZ coupon and withholding schedule; T-bill maturity interest; FIFO tax lots; report FX conversion with the dated rate where a rate exists; category breakdown and expense classification exact.
- Security: private items 404 on direct reads; outsider 404 or 403 on every id route except goal activity; `/uploads` auth and traversal guard; CSRF on mutations; admin endpoints 403; lockout after five failures for 15 minutes; password reset revokes all sessions; step-up on money moves; upload extension from mimetype; 33 of 37 probed view-only writes denied.
- Platform: `npm run check`, 2660 server tests, 1384 client tests and the build green; versioned migrations from empty match the push-built schema; receipt upload idempotency and image-hash dedupe; report exports audited; AI consent gate and honest `ai_query` rows; conversations persisted.


---

# Part D. Work orders R00–R21

Each work order is self-contained for one agent. Format: effort (higher of the two consolidations), completion dependencies (implementation may start earlier where noted), lane, crosswalk to the Fable CP id, rows closed, where (files and lines verified at `381e943`; re-resolve symbols at the executing SHA), ordered slices (each slice follows the red → implement → green → runtime → review loop of Part E §E4), implementation detail, data and migration contract, tests to write, independent acceptance oracle, runtime evidence, done when. Proposed test paths are proposals; reuse an existing equivalent test when that makes the defect clearer. Evidence goes to `evidence/Rxx/RESULT.md` under the remediation evidence directory (Part E §E6).

| Order | Title | Days | Depends on | Lane | CP |
|---|---|---|---|---|---|
| R00 | Reproducible baseline, runtime, dependencies, limiters | 3–5 | none | OPS | CP-00 |
| R01 | Sessions, public DTOs, credential concurrency | 3–5 | R00 | BE | CP-01 |
| R02 | Registration, verification, recovery, first run | 3–5 | R01 | BE+FE | CP-02 |
| R03 | Membership, ownership, Professional lifecycle | 4–7 | R02, R04 | BE+FE | CP-03 |
| R04 | Visibility and capability enforcement | 4–7 | R01 | BE | CP-04 |
| R05 | Persistent settings and named shared views | 4–7 | R03, R04 | BE+FE | CP-05 |
| R06 | MFA management and security policy | 2–4 | R01, R02, R05 | FE+BE | CP-06 |
| R07 | Self-service export, leave and erasure | 5–8 | R01, R03, R04, R05, R19 | BE+FE | CP-07 |
| R08 | Ledger invariants across every writer | 6–9 | R04 | BE | CP-08 |
| R09 | One correct import and export workflow | 4–6 | R08 | BE+FE | CP-10 |
| R10 | Budgets and reversible goals | 5–9 | R08, R12 | BE+FE | CP-11, CP-12 |
| R11 | Rules, tags, merchants, pickers and presets | 4–7 | R04, R08 | BE+FE | CP-14 |
| R12 | FX ownership and reconciled reports | 5–8 | R04, R08 | BE+FE | CP-09 |
| R13 | Investments, pension and GRZ lifecycle | 7–11 | R08, R12, R14 | BE+FE | CP-15 |
| R14 | Durable recurring and scheduled jobs | 4–6 | R08; R19 for staging evidence | BE+OPS | CP-13 |
| R15 | Durable receipts and OCR | 3–5 | R08, R19 | FE+BE | CP-17 |
| R16 | Notifications, push and weekly recap | 3–5 | R04, R12, R14, R19 | BE | CP-18 |
| R17 | Thandi: Claude primary, Gemini fallback | 5–8 | R04, R05, R12, R19 | BE+FE | CP-19 |
| R18 | UX, accessibility, phone layout, dates | 5–8 | R02, R03, R05 | FE | CP-20 |
| R19 | Deployable operations, storage, recovery | 4–7 | R00 | OPS | CP-16 |
| R20 | Trustworthy automated and runtime verification | 3–5 | R00 | QA | CP-00 and CP-21 harness |
| R21 | Integrated acceptance and controlled release | 6–9 | all | QA+OPS | CP-21 |
| | Total | 92–151 | | | |

## R00 Reproducible baseline, runtime, dependencies, limiters (3–5 days)

Depends on: none. Lane: OPS. Closes: DEP-01, DEP-02, NEW-08, NEW-39 (part), OPS-011 (harness guard with R20).

Where: `package.json` `engines`; `.github/workflows/ci.yml` (Node 20, `postgres:16`); `render.yaml`; `server/app.ts` global `generalLimiter` mount and every `server/modules/*/*.routes.ts` that mounts it again; `server/middleware/rateLimit.ts` (`ipAuthLimiter` 5/min on `/api/auth/*`); root `vitest.config.ts` and `playwright.config.ts` (unguarded; `server/vitest.config.ts` already refuses non-test databases); `scripts/verify-deploy-readiness.mjs`; `.local/readiness-fable-2026-10-13/` fixture scripts (not portable).

Slices: R00.1 inventory deployment, runtime and schema identities; pin the current Active LTS Node and Postgres 16 across local, CI, render.yaml; re-validate native modules (sharp, OCR worker). R00.2 remediate the nine advisories with targeted upgrades (`npm audit fix` for the eight fixable; `csv-parse` major evaluated in R09; `sharp` here) and compatibility tests for CSV, uploads, SMTP, images, proxy IP; add the audit step to CI as blocking. R00.3 limiters: mount `generalLimiter` once in `app.ts`, remove per-router mounts, size per authenticated user at 600 requests per 60-second sliding window with the IP key as anonymous fallback (proposal, D22); scope `ipAuthLimiter` to `POST login`, `register`, `forgot-password`, `reset-password`, `resend-verification` at 10 per minute; `/api/auth/me` and `/logout` unlimited by the auth limiter. R00.4 port the A1–A6 fixture generators from `.local/` into `server/testing/fixtures/` so any checkout can rebuild them; approve and run the Playwright browser install (DEC default); record the smoke result per spec without rewriting specs (R20).

Data and migration: none; compatibility migration only if a dependency demands it.

Tests: `server/testing/__tests__/completion-r00.test.ts` (engine and audit guard); a limiter test: login plus five bursts of 40 requests inside one window → no 429 and `ratelimit-remaining` at or above 300; a separate exhaustion test: 700 requests in one window → 429 with `retry-after`; CI green on the pinned runtime.

Oracle: clean `npm ci && npm run check && npm run test:run && npm run test:server:run && npm run build && npm audit --omit=dev` all exit 0 on the pinned runtime; ordinary navigation (dashboard, transactions, reports in sequence) never returns 429; the current dependency report has no unexplained release-blocking item.

Runtime evidence: the Fable browser journey R6 repeated (three page loads, no 429). Done when: CI green with the audit step blocking; limiter tests merged; fixtures portable; smoke result recorded.

## R01 Sessions, public DTOs, credential concurrency (3–5 days)

Depends on: R00. Lane: BE. Closes: AH-01, AH-02, AH-10, AH-12, NEW-38 (DEL-01 and security notices).

Where: session revoke handlers under the security settings routes (delete `user_sessions` only); `server/auth/session-revocation.ts` (correct helper, used only by password change); `server/modules/auth/auth.service.ts` register and login responses; `/api/auth/me` handler; `server/modules/settings/settings.controller.ts` profile response; `HouseholdRepository.ts:163-177` members DTO; MFA verify and backup-code consumption; `settings.account-deletion.service.ts`.

Slices: R01.1 write the two-cookie revocation and DTO sentinel tests first. R01.2 route single revoke, revoke-all, password reset, password change and deletion through `session-revocation.ts`, deleting matching express `session` rows and `user_sessions` in one transaction, scoping the supplied id to the actor; add a per-user `sessionGeneration` (or `revokedAt`) on the user row checked by the deserialiser so a late save cannot resurrect a revoked session; bind step-up state to the session. R01.3 `toPublicUserDto()` in `server/modules/auth/auth.dto.ts` with an explicit allow-list (`id, username, email, emailVerified, fullName, firstName, lastName, displayName, timezone, profilePictureUrl, bannerUrl, bio, createdAt, lastLoginAt, mfaEnabled, mfaMethod`) used by register, login, `/me`, profile, members list and any audit detail that embeds a user; own-profile sensitive fields in a separate DTO; consume MFA and backup codes with one conditional `UPDATE ... WHERE code_hash = $1 AND used_at IS NULL RETURNING` or under `FOR UPDATE` on the user row; one `passwordPolicySchema` for register, change and reset; e-mail and password change write a `security_audit_logs` row and send the security notice.

Data and migration: additive `session_generation` on users if chosen; never delete unrelated sessions.

Tests: `server/modules/auth/__tests__/completion-r01.realdb.integration.test.ts`: two agents, revoke one → 401 on `/me`; revoke-all; delete account → every cookie 401 and zero `session` rows for the user; a session save issued after the revoke does not restore it; DTO key-set test asserting none of `passwordHash, mfaCode, mfaCodeExpiry, mfaBackupCodes, mfaBackupCodesGeneratedAt, emailVerificationToken, emailVerificationExpiry, failedLoginAttempts, lockedUntil, lastFailedLoginAt, nrc, salaryRangeEncrypted`; two parallel verifies of one code → one 200; two different valid backup codes redeemed concurrently → both consumed and neither reusable; password policy parity.

Oracle: revoked cookie 401; concurrent redemptions one winner; no credential sentinel in any public DTO; erased identity cannot authenticate from a tombstone.

Runtime evidence: Fable security verifier SES-01 script re-run. Done when: tests green in CI and the register rows carry the evidence path.

## R02 Registration, verification, recovery, first run (3–5 days)

Depends on: R01; D04 default. Lane: BE+FE. Closes: AH-03, NEW-07, AH-04, UX-01 (server half), NEW-27 (seeding), NEW-08 (auth throttle scoping with R00).

Where: `server/modules/auth/auth.email.service.ts:86,119` (link path `/auth/verify-email`); `client/src/App.tsx:106` (route `/verify-email`); `server/app.ts:173-216` CSRF configuration and skip list (token bound to `req.sessionID`, `saveUninitialized: false`); `auth.service.ts:170-171` (session at register), `:278` (login refuses unverified); `resendVerificationSchema` (takes an e-mail address); `server/middleware/auth.ts` `householdGuard`; `server/modules/categories` seed endpoint; client hooks that query before membership exists.

Slices: R02.1 captured-mail fresh-browser test with real CSRF and limiters (no fixture SQL). R02.2 canonical links `${APP_URL}/verify-email?token=` and `${APP_URL}/reset-password?token=` with a server redirect from the old path; `/api/auth/verify-email` and `/api/settings/security/email/verify` on the CSRF skip list under the narrow exemption in §A4 (token-authenticated, no ambient mutation, cannot log the visitor in); tokens hashed at rest and consumed atomically. R02.3 pending-verification state: registration keeps a restricted session; `requireVerifiedEmail` returns 403 `EMAIL_NOT_VERIFIED` on household and financial routers; `/me`, `/logout`, `/resend-verification`, `/verify-email` reachable; client "check your inbox" state with resend and logout; resend throttled per IP and per address with an identical response either way; client gates household-dependent queries on `me.householdId` and shows one "Create your household" action; household creation seeds default categories idempotently through the existing seed path.

Data and migration: none beyond atomic token consumption.

Tests: `server/modules/auth/__tests__/completion-r02.realdb.integration.test.ts`: fresh agent with no cookies verifies with the raw token captured from the SMTP sink message (never the stored hash); expired, used, malformed and wrong-user tokens; pending session 403 on `POST /api/accounts` and 200 on `/me`; resend throttling and non-enumeration; e2e `auth.spec` register → sink link in a second context → verify → login; client test for the gated first-run state.

Oracle: register in browser A, open the link in browser B, verified, login succeeds; pending user cannot reach finance; reset invalidates other sessions; a new browser shows zero error toasts before the household exists; after household creation the category picker is populated.

Runtime evidence: SMTP sink link followed in a new incognito context (Fable journey R2 now passing).

## R03 Membership, ownership, Professional lifecycle (4–7 days)

Depends on: R02, R04 (guard lands first). Lane: BE+FE. Closes: AH-05, AH-06, NEW-12, AH-13 (panel), OPS-009 (invite template), D06.

Where: `client/src/hooks/use-settings.ts:696-703` (posts `POST /api/household/members`), `:555-582` (nested `member.user`); `MemberList.tsx:198-227, 280-285`; `AddMemberDialog.tsx:116-123`; `server/modules/household/household.routes.ts:16-33`; `invitations.controller.ts:28,36,174,221,228-285`; `HouseholdRepository.ts:45-51, 163-177, 553-605`; `members.controller.ts:26`; `transfer-ownership` handler; `createWithOwner` advisory lock; `shared/schema.ts:625` membership unique key.

Slices: R03.1 client Add Member → `POST /api/household/invite {email, role}`; pending invitations with resend and cancel; route `/invite/:code` that stores the code, runs login or register and verification, then `POST /api/household/invite/accept`; flat member DTO `{userId, name, email, role, joinedAt}`; leave and transfer controls wired. R03.2 accept inside one transaction under the actor's advisory lock with the invitation and household rows locked: recheck expiry, state, household, recipient address equals the verified address (409 `INVITE_RECIPIENT_MISMATCH`), one-household rule; invite-create returns the invitation id only; resend rotates the token; `transfer-ownership` rejects self and non-members (400), locks household and both memberships, demotes and promotes in one statement; role-change refuses to assign `owner` or alter the owner; a partial unique index guarantees one owner per household after a preflight repair report. R03.3 Professional per D06 end to end (schema already has the enum value; invite and role-change schemas accept it; UI copy "Professional (read-only)"); leave and removal immediate on the next request; remove the "Household Premium" panel; escape user strings in invitation templates with the shared helper.

Data and migration: preflight duplicate memberships and owners into a repair report; add the uniqueness constraint only after approved repair; never choose an owner silently.

Tests: `server/modules/household/__tests__/completion-r03.realdb.integration.test.ts`: invite, wrong recipient, correct accept, duplicate accept, two concurrent accepts for one household-free user through a barrier (one membership, one 409), create-vs-accept race, revoke, expiry, self-transfer 400, transfer leaves exactly one owner, second-owner attempt 409, demote-owner 403, Professional matrix; client dialog and members list tests; e2e invite flow with the sink.

Oracle: two-browser invited recipient joins with the right role and visible name; wrong verified e-mail denied; ownership always exactly one; removal revokes household access immediately.

Runtime evidence: two-browser acceptance against the sink; Fable SEC-01, SEC-06, SEC-07 probes re-run and refused.

## R04 Visibility and capability enforcement (4–7 days)

Depends on: R01. Lane: BE. Ships before R03 enables the Professional role. Closes: FIN-01 (all variants), ORG-002, OPS-005 (query side), NEW-01, ORG-001, ORG-003 (reference checks shared with R11), AH-09 (gate side), NEW-33 (ids and unknown routes), goal-detail privacy variant.

Where: `server/middleware/validateEntity.ts:266-301` (`requireRole` without `professional`); `server/middleware/householdGuard.ts:105` (cast without validation); `server/modules/goals/goals.controller.ts:359-369` (activity ignores householdContext); `goals.extra.controller.ts:105-119` and `TransactionGoalLinkService.ts:364-388` (no userId; unlink uses the non-visibility reader at `:198`); `GoalQueryService.ts:55-71`; `TagRepository.ts:240-245`; `RecurringRepository.ts:133-161`, `RecurringBaseService.ts:41-45`; `investments.transactions.controller.ts:21-36,59-62`, `investments.service.ts:48-71,340-359,380-411,417-435,481-493`, `PortfolioValuationService.ts:127-145`, `AccountReportingService.ts:95-113`; `AccountImportService.ts:24-43`, `AccountRepository.ts:537-542`; `server/services/transaction/create.ts` (never sets `is_private`); `settings.routes.ts:113-118`; reports exports and weekly-recap `generate` and `feedback` routes; `services/rule/actions.ts:51,62-68,143-145,192` (ids used unchecked).

Slices: R04.1 capability table per §A3 (`ROLE_LEVELS` plus `can(role, capability)`), `requireRole` 403 for any value not in the table, `householdGuard` validates the stored role and fails closed; enumerate every route with actor identity. R04.2 one shared `visibleTransactionPredicate(actor)` per §A3 (membership AND account visible AND transaction visible) used by goal links, activity, summary and detail assignments, tag transactions, recurring list, detail, transactions and history, recap recurring reads, account transaction export, investments holdings, transactions, lots and valuation, and AI tool queries; goal activity also filters by `householdContext.householdId`; counts and metadata filtered too; `is_private` on create only from an explicit flag; unlink, rename and delete of invisible items 404. R04.3 reference revalidation helper for ids supplied in bodies (category, tag, member, goal, account, merchant) against household and visibility, used by rule actions, links and assignments; `PUT /api/settings/preferences` gated owner and admin (R05 adds the personal route); `requireRole("member")` on `POST /api/reports/exports`, `POST /api/reports/custom`, recap `generate` and `feedback`, import execute (declarative); malformed ids 400 through a shared param validator; unknown `/api` routes JSON 404 before the SPA.

Data and migration: no backfill; a report of transactions on private accounts whose flag is false and of ambiguous legacy ownership, for review only.

Tests: `server/modules/goals/__tests__/completion-r04.realdb.integration.test.ts` plus `tags.privacy.realdb`, `recurring.privacy.realdb`, `investments.privacy.realdb`, `accounts.export.privacy.realdb`: households H (owner, admin, member, professional, view_only, and an unknown role injected at the `householdGuard` seam through a test double since the enum forbids persisting it) and J (outsider); private and shared accounts each with private and shared transactions, mismatched-owner and account-private/transaction-public fixtures; linked goal, tag, recurring rule, holding; iterate every read route and every mutating route asserting status and unchanged rows (hash before and after).

Oracle: member M never sees O's private row, amount, name, account id or count through any listed route; outsider X gets 404 on goal activity; unknown role 403 on every mutation; view_only `PUT /settings/preferences` 403 with the row unchanged; a rule action with a foreign category id → 400.

Runtime evidence: Fable security verifier scripts and the 14 October AH-09, ORG-003 probes re-run.

## R05 Persistent settings and named shared views (4–7 days)

Depends on: R03, R04. Lane: BE+FE. Closes: AH-07, NEW-26, NEW-11 (persisted filter), NEW-16 (preference writer), OPS-007 (settings side), AH-13 (shared views), settings SET-05, D07.

Where: `settings.controller.ts` `updateProfile`, `updatePreferences` (`:364-396`); `settings.validation.ts` (`updateProfileSchema`, `updatePreferencesSchema:31-32`); `settings.routes.ts:105-118`; `user_preferences` table (no writer); client `pages/settings/sections/*` (profile fields, preferences, recap and widget sections); Accounts page default `ownerUserId=shared`; the dead "Configure shared views" control.

Slices: R05.1 field inventory UI → API → DB for about 22 profile fields with typed schema, explicit null clearing and retention notes per OI-04; split `PUT /api/settings/preferences` (household policy, owner and admin) from new `GET/PUT /api/settings/user-preferences` (`user_preferences`); `auto_rollover_budget` in the household schema; recap and widget settings write disjoint columns; notification preference partial updates preserve omitted thresholds and validate the type. R05.2 named household saved views: `household_saved_views` (id, household_id, name, validated filter json, created_by, timestamps, version); owner and admin create, edit, delete; any member applies; filters can only narrow the R04 predicate; Mine/Shared/All default filter and reset persist per user; the Settings control lists, edits and applies them. R05.3 currency change on a household with any transaction → 409 `LEDGER_NOT_EMPTY` with guidance; remove fictitious commercial copy without removing advertised functionality; a contract test compares each form's field names with its Zod schema keys.

Data and migration: additive per-user preferences and saved-view tables if the schema cannot express them; minimise sensitive fields.

Tests: `server/modules/settings/__tests__/completion-r05.realdb.integration.test.ts`: PUT all fields → GET returns all; clear → null; member writes user preferences 200 and household preferences 403; owner writes household preferences 200; saved view CRUD by role; a saved view filter cannot return an invisible row; currency 409; client contract test.

Oracle: every offered field saves, reads back and survives reload; another user's preferences untouched; shared views never grant access; currency change with history 409.

## R06 MFA management and security policy (2–4 days)

Depends on: R01, R02, R05. Lane: FE+BE. Closes: AH-11 incl. settings SEC-03, AH-12 (policy), D22 MFA defaults.

Where: existing MFA endpoints under the security routes; `SecuritySection*` client sections; the inert mandatory-MFA flag; step-up threshold code in the transfer path.

Slices: R06.1 enrol, verify, backup codes shown once, regenerate, disable with password and step-up, recovery on login; enabling stays pending until a code from the mailbox proves possession; recovery codes issued only after proof and hashed at rest. R06.2 household mandatory-MFA policy with a policy version: non-compliant sessions of owner and admin are restricted to enrolment and recovery within the proposed 24-hour window (D22). R06.3 recent step-up required for sensitive management; any high-value threshold normalised to household currency with dated FX, fail-closed; the existing financial step-up stays until the replacement is configured and proved.

Data and migration: additive policy version and enrolment state if needed.

Tests: `server/modules/auth/__tests__/completion-r06.realdb.integration.test.ts`: enable requires code; login requires code; backup code once; regeneration invalidates old codes; disable requires password; policy change restricts an existing session; provider outage yields a safe recovery state; e2e `auth.spec` MFA path.

Oracle: enable then login with code; backup reuse fails; policy change restricts old session; no immediate-enable path remains.

## R07 Self-service export, leave and erasure (5–8 days)

Depends on: R01, R03, R04, R05, R19 (durable storage). Lane: BE+FE. Closes: AH-08, NEW-32 (audit completeness with R08), OI-04 defaults.

Where: export stub in the privacy or settings controller (synthetic id); `data_exports` table (`parameters` jsonb); `settings.account-deletion.service.ts:441-476`; `security_audit_logs`; `server/core/uploads.ts`; writers listed in the Fable server-surface inventory F4.

Slices: R07.1 durable export jobs (`POST /api/settings/privacy/export` → queued, running, ready, failed, expired; JSON plus CSV of every entity the user can see under the R04 predicate; manifest, checksum, size; authenticated download that re-authorises and expires; UI button and status). R07.2 deletion state machine for household-free, last-owner and shared-member cases: revoke identity first (R01 helper), block mutations, pseudonymise `security_audit_logs.email` and `ip`, drop the password hash and tokens from the tombstone, delete files, retain other members' shared rows with pseudonymous attribution and the household audit history, retry-safe. R07.3 security notices complete; audit rows for every F4 writer inside the same transaction; backup restores reapply erasure markers.

Data and migration: export and erasure job state and manifests; retention and legal holds from OI-04, never inferred.

Tests: `server/modules/settings/__tests__/completion-r07.realdb.integration.test.ts`: export contains own and shared rows and no other member's private row, counts and money reconcile, hash recorded; three deletion states; after deletion no row holds the e-mail except the deletion audit; stale cookie, token and file URL 401 or 404; interrupted erasure retried to completion; audit-completeness test iterating the F4 list.

Oracle: visible-only export reconciles; stale access fails; remaining household audit survives; restoring a backup reapplies erasures.

## R08 Ledger invariants across every writer (6–9 days)

Depends on: R04. Lane: BE. Closes: FIN-05, FIN-08, FIN-13, FIN-16, FIN-17 (server cache), ORG-005 (allocation validation), NEW-05, NEW-28, NEW-32 (ledger writers), NEW-35 (DTO precision, part), NEW-15 (timestamps), D09.

Where: `TransactionRepository.ts:287-310` (`createWithinTransaction` persists supplied data), `:105-123` (`calculateBalanceDelta` ignores `isAsset`), `:410-465` update, `:683-735` splits; `ImportService.ts:199-215` and `RecurringProcessingService.ts:187-209` (no currency); `transactions.helpers.ts:26-33` (defaults ZMW); `transaction/queries.ts:176-285` (`withCache` 5 min, latest rate); `CacheInvalidation.ts:13-28,74-78`, `AnalyticsCache.ts:157-167`; `transaction/service.ts:291-347` (audit after commit); `server/services/transaction/create.ts:186` (`ownerUserId: userId`); `client/src/lib/queryClient.ts:175-176` (`staleTime: Infinity`); `client/src/pages/Transactions/index.tsx:173` (query key); `AddAccountModal.tsx:136-143` (owed amount positive); `AccountReportingService.ts:88-91` and `NetWorthReportRepository.ts:261` (abs on liabilities); `timestamp without time zone` columns written by DB `now()` and JS `new Date()`.

Slices: R08.1 independent asset, liability, create, edit, delete, split and transfer oracles with concurrent writers written first (Golden fixture A, Part F). R08.2 one transaction executor for financial effects and audit and outbox used by manual, import, recurring, receipt, rule and GRZ writers: signed account effects per §A5 (liability positive owed; purchase increases; repayment decreases; never abs()); immutable source currency from the locked account with mismatch rejected; split allocations equal the parent with a deterministic residual and atomic re-materialisation on parent edits; ordered locks; audit inside the transaction; `ownerUserId: null` honoured as shared; account create writes one audit row. R08.3 freeze account currency, type and opening balance after activity except through `POST /api/accounts/:id/reconcile` (previewed, audited adjustment); idempotent retries by operation key with 409 on changed payload; cache: invalidate `txn-summary:*` and the analytics family after commit with and without Redis, revision tokens as fallback; client `staleTime` 30 s with refetch on focus and the summary key in mutation invalidation; timestamps: move affected columns to `timestamptz` or write every instant from the DB with a UTC session, fix writers passing JS dates, serialise UTC, format in household timezone; malformed UUID 400.

Data and migration: backfill null currencies only where account denomination history is unambiguous (account audit shows no currency change); a reconciliation report for the rest; timestamp migration rehearsed on a sanitised prior-schema copy first; preserve original values and provenance; never recompute all balances blindly.

Tests: `server/modules/transactions/__tests__/completion-r08.realdb.integration.test.ts`: Golden fixture A steps with DB read-back; `transactions.currency.invariant.realdb` (every writer persists the account currency; mismatch 400); `transactions.summary.cache.realdb` (create → summary reflects within one request, Redis stub on and off); `transactions.splits.edit.realdb`; `accounts.edit.freeze.realdb`; audit atomicity (fail the audit insert → update rolled back); concurrent writers; timestamp test (`created_at` equals the DB instant; invitation `accepted_at` after `created_at`).

Oracle: asset 1000 + 200 − 125.50 = 1074.50; card debt 500 + 45.50 = 545.50 with expense 45.50 and net worth down 45.50; transfer has two legs and replay changes nothing; split 100 = 60 + 40; edit and delete reverse dependent effects without drift; a USD recurring materialisation stores USD; a changed account currency after activity → 409.

Runtime evidence: Fable journeys R6 and R7 repeated with read-back; reports fixture September expenses 1564.15 as cross-check.

## R09 One correct import and export workflow (4–6 days)

Depends on: R08. Lane: BE+FE. Closes: FIN-02, FIN-03, FIN-04, FIN-15, NEW-17, NEW-14 (export split detail), FIN-01 export variant (with R04), `csv-parse` major, D13.

Where: `ImportService.ts:135-145` (soft-delete before key check), `:172-185` (idempotency lookup ignores deleted rows), `:279-352` (account-level overwrite, one account, no pair), `sideEffects.ts:28-30`; `import/dedupe.ts:21-24`; `import/parse.ts:26-78`; `AccountImportService.ts` (uuid mismatch); `routes/import.ts`; `data_imports` table; export writers in `AccountRepository.ts:537-542` and reports exports.

Slices: R09.1 fixtures for overwrite, transfer conflict, sign, uuid, invalid date and duplicate occurrence on both entrances. R09.2 identity per D13 (batch fingerprint plus row ordinal, provider reference when present, mapping version); preview with chosen date format, Notes mapping, duplicate candidates and expected effects; two identical legitimate purchases retained; replacement sets intersecting a paired transfer rejected with the conflict listed unless a reviewed pair-preserving operation is chosen; changed content under the same key 409. R09.3 overwrite in one transaction: lock existing rows, update in place or hard-replace, adjust both balances where applicable, never soft-delete then skip; account-detail path fixed (uuid) with explicit sign semantics per account class; honest created, updated, skipped, rejected counts and per-row outcomes persisted in `data_imports`; exports round-trip type, sign, currency and precision with split detail, apply the R04 predicate and escape formula cells; `csv-parse` 7 adopted or pinned with a recorded reason.

Data and migration: batch identity, row ordinal, fingerprint and mapping version columns where absent; never repurpose soft-deleted idempotency keys as a blanket skip.

Tests: `server/modules/accounts/__tests__/completion-r09.realdb.integration.test.ts` and the existing `import.execute.realdb.integration.test.ts`: overwrite twice → identical rows and balance, zero orphan soft-deletes; transfer in range → both legs replaced or import refused and both balances reconcile; account path imports one valid row; same-day identical purchases both import; `2026-02-30` rejected with row number; ambiguous slash date requires a chosen format; concurrent identical imports → one effect; lost-response replay → opening 100, expense 10, income 20 → 110 exactly once; export round-trip; privacy export test with R04.

Oracle: exact batch replay no new effects; repeated overwrite stable; no partial pair deletion; Feb 30 rejected; Notes retained.

Runtime evidence: Fable import verifier CSVs and the Codex `overwrite_first`/`overwrite_second` probe reproduced with `deleted: 0`.

## R10 Budgets and reversible goals (5–9 days)

Depends on: R08, R12 (`fxRateExpr` and split helper). Lane: BE+FE. Closes: FIN-06, FIN-07, FIN-09 incl. GOAL-03, NEW-29, NEW-16 (rollover driver), NEW-15 (goal forecasts), D14, D22 budget semantics.

Where: `BudgetSpendRepository.ts` (no currency filter or conversion); budget recalculation service (sum, overwrite, zero budgets); recalc and clear audit `entityId`; rollover cron; `TransactionGoalLinkService.ts:198,364-388`; goal contribution handlers; `GoalQueryService.ts:55-71`; goal projection code (30-day months).

Slices: R10.1 spend aggregated in the budget currency with the dated rate via the shared helper, splits counted once, refunds and pending per §A6, private spend excluded; historical suggestion = sum ÷ included elapsed periods with legitimate zero months, no future months, previewed, never overwriting manual budgets without confirmation, zero-spend categories skipped. R10.2 rollover driven by `budgets.rollover_enabled` and the household preference from R05, one carry per period under unique period identity across repeated workers; recalc and clear audits with a UUID `entityId` and affected ids in `details`. R10.3 typed goal progress sources with stored provenance and effective delta so unlink, edit and source delete restore the exact prior progress under ordered locks; no double counting of assigned balance plus links; cross-currency links converted with the dated rate or rejected; contributions validated as money, overfunding only with explicit confirmation, cash enforced only when cash moves, mistaken contributions reversible through an audited correction; default partial assignment forms a valid request; forecasts use calendar months and household-local today with zero remaining time when complete.

Data and migration: goal progress provenance and correction links; report ambiguous legacy progress for reconciliation; no silent clamping.

Tests: `server/modules/goals/__tests__/completion-r10.realdb.integration.test.ts` plus budget spend and recalculation tests: ZMW 100 plus USD 10 at 20 → ZMW 300; USD 50.00 never counted as K50.00; no rate → 422; months 100/100/100 → 100; 550.00 over three months → 183.33 with Dining 500.00 untouched; 450.00 carries once across repeated workers; audit rows present; goal 5 → linked spend 10 → unlink → 5; edit and delete of the source reverse; two concurrent contributions reconcile; 1,000,000 contribution rejected or confirmed per policy; assignment default valid.

Oracle: as listed; every visible budget and export agrees with independent expected totals.

Runtime evidence: Fable budgets verifier scripts re-run.


## R11 Rules, tags, merchants, pickers and presets (4–7 days)

Depends on: R04, R08. Lane: BE+FE. Closes: ORG-004, ORG-006, ORG-007, ORG-008, ORG-009, ORG-010, NEW-09, NEW-19, NEW-27 (seeding UI), NEW-36, ORG-003 and ORG-005 (execution side), NEW-11 (picker and filter UI).

Where: `rules.validation.ts:55-79` (action values untyped); `services/rule/actions.ts:51,62-68,120,143-145,192,204-209`; `services/rule/service.ts:88-95,134-139,286-291` (dry-run and preview call the mutating evaluator); `TransactionRepository.ts:410-465,683-735`; `TagRepository.ts:136-164`; merchant routes lacking `/:id/analytics`, `/:id/transactions`, aliases, logo; `POST /rules/:id/test` absent; `POST /api/tags/merge` uuid cast; `client/src/components/transactions/form/TransactionFormFields.tsx:92,95` (`groupType` filter); both `useCategories` hooks; filter preset apply-on-entry.

Slices: R11.1 pure planner returning validated proposed effects for every action type (category, tags, aliases, splits, merchant, owner, goal links) and a separate executor; references resolved against household and visibility at create, update and execution with 400 `FOREIGN_REFERENCE`; a migration report quarantines stored rules with foreign ids; split configs validated to sum to the parent (amounts) or 100 (percent) at authoring and execution; apply-to-past itemises failures. R11.2 tag merge fixed (uuid cast), canonical names with scoped uniqueness after a dedupe migration, usage counts recomputed from rows, repeated removal idempotent; merchant endpoints implemented on `merchant_aliases` and `merchant_logo_uploads` with authorisation; `POST /rules/:id/test` implemented; archive keeps history, permanent delete follows the retention policy, merge into another merchant, undo claims its history row atomically and adjusts counts from rows actually restored, alias ownership defined. R11.3 default preset applied on fresh navigation, never over explicit URL filters, reset and user-switch safe, create and delete controls reachable; `includeArchived` honoured; category picker derives type from the group so the seeded categories appear grouped Income and Expenses; Accounts default "All" with the persisted Mine/Shared/All chip from R05; idempotent seeding and a useful uncategorised state.

Data and migration: preflight cross-household rules and duplicate tags before adding scoped uniqueness; preserve original ids in the migration map; audit actual affected rows.

Tests: `server/modules/rules/__tests__/completion-r11.realdb.integration.test.ts`: foreign category, tag, member, goal and split-category ids → 400; a stored legacy rule with a foreign id applies nothing and is listed; dry-run with add_tags, add_merchant_alias and split_transaction → row hashes of transactions, tags, usage counts, aliases and splits identical before and after while `proposedUpdates` lists all; 60/60 split → 400; `tags.merge.realdb`; merchant endpoint tests; preset tests; client tests for the picker and the default filter; e2e `transactions.spec` adds a categorised expense.

Oracle: dry-run snapshots unchanged for every action; foreign ids rejected and legacy rules quarantined; merge and undo preserve actual counts; every merchant control persists; first account visible and categories selectable without touching settings.

Runtime evidence: the 14 October ORG-003 and ORG-004 probe commands re-run (expect 400 and identical snapshots).

## R12 FX ownership and reconciled reports (5–8 days)

Depends on: R04, R08. Lane: BE+FE. Closes: NEW-02, NEW-13, NEW-06, NEW-14, NEW-15 (client month range and report dates), NEW-34, FIN-18, FIN-14 (completeness flag), FIN-17 (client half), NEW-35 (report DTOs), D11, D12.

Where: `AnalyticsRatiosRepository.ts:46-81,185-216` (no conversion, no privacy filters); `BaseReportRepository.ts:78-90,162-260,283-286`; `TransactionReportRepository.ts:108-111`; `SankeyNodes.ts:63-66`; `AccountReportingService.ts:95-122,194-221` (catch drops holdings); `fx_rates` and `securities` tables; Annual dashboard chart adapter (label parsed as ISO); cash-flow averages; recap week; merchant totals; net-worth history; the 23 client month-range call sites.

Slices: R12.1 separate read-only global market data from household overrides: nullable `household_id` on `fx_rates` and `securities` with unique scoped identity, immutable actor, source, pair, as-of and precision; owner and admin write their household's overrides (D11); readers prefer the household row for the date then the global row; an owner-facing FX entry in Settings; legacy global manual rows quarantined rather than assigned. R12.2 unify dated-flow conversion and as-of valuation through the shared `fxRateExpr` and `assertFxRatesAvailable`; ratios and debt repositories rewritten on them plus the R04 predicate; missing rate → 422 with pair and date for required operations, `complete: false` with named components for displays; liabilities positive owed, net worth = assets − liabilities, card spend an expense, repayments distinct; split children replace parent contributions in every reader (shared helper); Uncategorised and Unassigned buckets; Money DTOs and rounding at output with a residual policy. R12.3 period DTOs carry `periodStart` plus a display label, charts never parse labels, twelve months distinct, quarters equal month sums; `monthRange(timezone)` helper used by every client call site, server receives household-local dates; both cache families and client invalidation repaired with revision tokens; recap week seven local dates; cash-flow averages exclude future months; merchant totals include unassigned; net-worth history labelled snapshot-only or incomplete, never computed from today's values.

Data and migration: household-scoped override identity, precision and validity metadata; quarantine ambiguous legacy rows.

Tests: `server/modules/reports/__tests__/completion-r12.realdb.integration.test.ts` as a property suite over random fixtures including edits and deletes: income − expenses = net flow; Σ buckets incl. Uncategorised = expenses; dashboard month = summary month = cash-flow month = annual month; net worth = assets − liabilities; converted amounts use the latest rate on or before the date; no unconverted foreign amount in any ZMW total; plus `reports.ratios.fx.realdb`, `reports.liability.sign.realdb`, `reports.splits.realdb`, chart adapter unit tests, migration tests.

Oracle (Fable reports fixture and Codex FX fixture): ZMW 100 plus USD 10 at 20 = ZMW 300; `/ratios` with USD 75 at 26.50 includes 1987.50, with no rate 422; net worth 41577.69 with a 500.00 card after a 45.50 charge; October budget actual 1273.75 in comparison and CSV; September expenses 1564.15; another household's rate write cannot change this household's totals; summary sees a write within one request; Monthly Trends shows twelve named months and no Invalid Date; Lusaka client on 1 October requests 2026-10-01 to 2026-10-31.

Runtime evidence: Fable reports verifier fixture re-run against its hand values.

## R13 Investments, pension and GRZ lifecycle (7–11 days)

Depends on: R08, R12, R14. Lane: BE+FE. Closes: NEW-03, NEW-04, GRZ-03, FIN-10, FIN-11, FIN-12 (investment part), FIN-14 (valuation), NEW-20, NEW-21, NEW-22, NEW-23, NEW-24, NEW-25, NEW-35 (GRZ precision items), FIN-01 investments variant (with R04), D10, OI-03 labelling.

Where: `server/services/grz-service.ts` and `server/routes/grz-securities.ts` (payments `pay`, sell, create validation); `investments.service.ts:571-596` (sell requires lots) and the household-only scoping cited in R04; `processDueInvestments.ts:160-179` (15% fallback yield), `:244-319` (no tax lot); `PortfolioValuationService.ts`; `Money.isPositive()`; tax summary and ZRA export; `client/src/pages/Investments.tsx:83-107` (empty-state gate); `/investments/tax` link.

Slices: R13.1 lots and basis for manual, POST and automated buys; positive quantities only; sells lock holding and lots and cannot oversell; FIFO disposal with quantity, basis, fees, proceeds, currencies and dated FX; `cost_basis` and `cost_basis_zmw` follow remaining lots; `amount_zmw` computed from posted FX; pension `total = employee + employer` validated, audited, with the cash-moved flag. R13.2 record-only acquisition preserved and labelled in the UI; state machine active → sold or matured with durable settlement; confirmed sale or maturity receipt is an asset-to-cash settlement per D10 (holding retired, cash credited once to an authorised compatible-currency account, principal recorded as return of capital, realised basis difference and fees separate, income zero), linked or posted once with unique instrument and event identity; coupons remain income with versioned withholding; payable rows after disposal cancelled; `pay` rejects not active (409), future date (400), unauthorised destination (400); sell and pay races lock the holding; legacy payments migrated through a reconciliation report. R13.3 validation: rate as a decimal fraction within bounds, face > 0, maturity after purchase, zero-interest maturity valid, `Money.isPositive()` strict, cron responses return counts only; day-count, compounding, fee and withholding conventions versioned and labelled synthetic until OI-03; tax summary includes GRZ interest and withholding with household-timezone year boundaries (31 December counted once) and a populated ZRA export; SIP catch-up and month-end anchoring under the R14 registry; automated rollover refuses without live terms and raises a pending item; GRZ, tax and pension tabs reachable without an equity holding; broken link fixed.

Data and migration: settlement and provenance links; versioned policy fields; legacy payments reconciled, never auto-credited twice.

Tests: `server/modules/investments/__tests__/completion-r13.realdb.integration.test.ts` extending `grz-money.integration`, `grz-record-only`, `grz-securities.sell-race`, `investments.db.integration`, `investments.sell-overdraft.realdb`; FIFO property test; schedule boundary tests; privacy test shared with R04; the Fable `hand.mjs` values as fixtures.

Oracle: two equal-price buys produce zero invented gain; negative sell 400; selling 5 of 10 bought at 310.50 consumes FIFO lots with the hand-computed gain; sold bond `pay` 409; principal settlement face 1000 moves 1000 from holding to cash with net worth unchanged and ordinary income zero, difference to a 950 basis explained once; coupon 100 with synthetic 15% withholding posts 85 and records 100 and 15; a T-bill bought at face matures via the cron; actual cash receipt linked once; tax counts 31 December once; ZRA export lists withheld tax.

Runtime evidence: Fable investments verifier scripts re-run.

## R14 Durable recurring and scheduled jobs (4–6 days)

Depends on: R08 for the registry; R19 for staging cron evidence (closure only). Lane: BE+OPS. Closes: OPS-003 (registry and wiring), OPS-013, NEW-10, NEW-30, FIN-12 (schedule semantics), NEW-33 (detect endpoint), dormant outbox and matcher workers, D15.

Where: `server/startup.ts:40`; `server/scheduler.ts:23,83,123-153` (three in-process jobs; 10-minute locks without renewal); `server/routes/cron.ts:34-41,57-440`; `server/config/redis.ts:78-120,158`; `RecurringProcessingService.ts:160-279`; the Add-Transaction recurring section (omits `frequency` and `nextDueDate`); `/recurring/detect`; outbox and receipt-matcher workers.

Slices: R14.1 recurring form sends `frequency`, `nextDueDate` (defaults to the transaction date), `endDate`, `amountType`, reminders and surfaces field errors; monthly anchor stored (31 Aug → 30 Sep → 31 Oct); timezone, end-date, pause, skip explicit; bounded catch-up; `asOfDate` capped at today for members. R14.2 registry: `job_runs` with unique (job, household or resource, due identity), fencing generation, lease with heartbeat renewal, attempt, outcome, error class, last success; stale leases reclaimed under a new generation and every financial write by a job carries its generation so a stale worker's late commit is rejected; per-item checkpoints; at most 100 items per invocation with rescheduling; coordination keys outside the cache namespace; every financial and notification job registered (recurring, rollover and alerts, goal dates, snapshots, FX and market refresh, investment automation and GRZ maturity, outbox, receipt matching, recap, cleanup). R14.3 the in-process scheduler and the `/api/cron/*` endpoints both go through the registry; `CRON_SECRET` required in production with constant-time compare; declared external schedule in render.yaml (R19); receipt and outbox workers connected or removed with a recorded decision; `/recurring/detect` fixed; operator indicators for lag, failure and staleness on `/api/admin/jobs` and readiness.

Data and migration: `job_runs` uniqueness is the authority; Redis expiry is not.

Tests: `server/modules/recurring/__tests__/completion-r14.realdb.integration.test.ts` extending `processRecurring.materialization.realdb`: two concurrent acquisitions → one run; stale heartbeat reclaimed and the old worker's commit rejected; crash before commit → no financial row; retry after commit deduplicates; short-month anchor; three missed months once each and rerun idempotent; future `asOfDate` 400; backlog over 100 checkpoints and continues; client test asserting the recurring payload.

Oracle: UI monthly rule → 201 with correct `next_due_date`; Aug 31 → Sep 30 → Oct 31; two workers and a restart yield one financial effect; on staging two consecutive days of `recurring_transaction_history`, `net_worth_snapshots` and `fx_rates` rows from scheduled triggers.

Runtime evidence: Fable budgets and recurring verifier scripts; staging cron evidence recorded under R19.

## R15 Durable receipts and OCR (3–5 days)

Depends on: R08, R19. Lane: FE+BE. Closes: NEW-18, OPS-001 (receipts path), OPS-004, NEW-39 (server paths in DTOs), matcher worker (with R14), D17.

Where: receipt create-transaction handler and `pendingReceipts.idempotencyKey`; receipt amount schema; OCR worker and WASM assets versus production CSP (`app.ts:56` helmet); receipt DTOs; `receipt/upload.service.ts:87-105`; `uploadsAuth.ts:33`.

Slices: R15.1 OCR assets pinned and self-hosted under the production CSP (`worker-src 'self'`, the WASM directive) or OCR moved server-side; the real upload → scan → correct → match → create journey exercised on phone and desktop. R15.2 receipt-to-ledger as one atomic idempotent transition under `FOR UPDATE` on the receipt: identical replay returns the existing transaction (200, same id), conflicting retry 409; non-positive amounts 400 (`positiveMoneyDtoSchema`); cross-household match 404. R15.3 files under the R19 storage abstraction with manifest and checksum; authenticated retrieval re-validates visibility; DTOs expose download URLs only; legacy flat files migrated with manifest and rollback; abandoned uploads cleaned safely; the matcher registered in R14 matches later transactions.

Data and migration: receipt version and idempotency, storage object metadata; pending-file state survives DB or object failure without false success.

Tests: `server/modules/receipts/__tests__/completion-r15.realdb.integration.test.ts`: replay → 200 same id and one ledger row; conflicting retry 409; negative 400; production-mode e2e scanning a known synthetic receipt with no CSP violation; matcher test; restart and restore retain hashes.

Oracle: second create produces no second charge; corrected OCR values persist; unauthorised file denied; thumbnails survive redeploy and restore with the same hash.

## R16 Notifications, push and weekly recap (3–5 days)

Depends on: R04, R12, R14, R19. Lane: BE. Closes: OPS-008, OPS-006, OPS-009, OPS-010 incl. NOT-01, NOT-02, NOT-03, OPS-007 (recap side), NEW-31, NEW-38 (notices and login noise), OPS-005 (recap consumer), D16.

Where: `notifications.controller.ts:329-335`; `notification/push.ts:64-99,202-204`; e-mail templates interpolating names; `weekly-recap.service.ts:87-172,273-309`; `weekly-recap.controller.ts:307-350`; `weekly-recap.email.service.ts`; delivery records; `user_quiet_hours`.

Slices: R16.1 push subscriptions schema-validated; endpoint origin allow-listed to known push services with DNS and IP resolution checks; credentials, non-standard ports, private and loopback destinations rejected; bounded connections and redirects; push kept disabled until merged; egress tests against local mocks only. R16.2 per-notification per-channel outcomes pending, sent, failed, unknown, suppressed with unique event, recipient and channel identity; retry failed channels only, never unknown as failed, never duplicate confirmed delivery; quiet hours configurable through `user_quiet_hours` with timezone and cross-midnight validation; every template escapes user strings through one helper; security change notices without login noise; missing VAPID a not-configured state; counters count actual outcomes. R16.3 recap viewer-aware (R04 predicate), household currency, exactly seven local dates, `includeGoals` and `includeRecurring` honoured, period snapshots stored and the week's net worth shown, missing FX surfaced as incomplete never zero, per-user consent before e-mail egress, feedback persisted structured and queryable.

Data and migration: delivery identity and outcome rows, retry scheduling, recap snapshot version; no sensitive bodies in logs.

Tests: `server/modules/notifications/__tests__/completion-r16.realdb.integration.test.ts`: endpoint `https://127.0.0.1/` or unknown origin → 400 and no row; delivery to a stubbed transport records per channel; e-mail failure plus push success distinguishable and only the e-mail retried once; unknown outcome not retried; recap for a member excludes other members' private rules; `<b>` in a name arrives escaped; feedback row queryable; quiet hours honoured.

Oracle: as listed; historical recap never substitutes current net worth.

## R17 Thandi: Claude primary, Gemini fallback (5–8 days)

Depends on: R04, R05, R12, R19. Lane: BE+FE. Closes: OPS-012 (all sub-items: provider order, consent version, idempotency, admission ledger, provenance, status, evaluation, retired model), D02, D03. Contract: Part B. Sub-checkpoints to avoid partial closure: 17a contracts and adapters; 17b orchestration and local mode; 17c admission ledger and replay; 17d consent version and role controls; 17e provenance, status and client labels; 17f evaluation set in CI; 17g staging smoke under OI-02.

Slices: R17.1 canonical provider contracts (`ai.provider.types.ts`) with tool definitions in JSON Schema and the Gemini declaration shape generated from them; direct Claude adapter on the official SDK (`ANTHROPIC_MODEL`, `max_tokens` from the remaining budget, tool and text blocks, usage per call, abort signal from the request deadline, SDK retries zero, no thinking or signature blocks persisted or forwarded); Gemini adapter conforming to the contract with `GEMINI_MODEL` configurable; stage-aware orchestrator (`ai.provider-orchestrator.ts`) per B1 with truthful per-stage provenance and the existing failure classification extended by typed categories. R17.2 consent versioned to name both processors with the middleware block on an outdated version; owner and admin controls and role-aware copy; revocation rechecked before each attempt; sanitiser, allow-list, history ownership and deterministic calculations preserved for both providers. R17.3 durable admission ledger (`ai.admission.repository.ts`, tables per B3, admission per B4, quota and local-mode policy per B5, both legs at dated list prices with the Claude credit balance as ceiling); cancellation and deadline; bounded failover then labelled local mode; evaluation set of 20 to 30 prompts with expected tool calls and golden amounts in CI against recorded responses; controlled staging smoke after OI-02 recording the three scenarios.

Data and migration: `ai_requests`, `ai_attempts`, `ai_budget_reservations`, `ai_budget_accounts`, `ai_consent` as a versioned migration generated at implementation time; never evictable Redis counters as spending authority; `used_gemini` retained for historical rows.

Tests: `server/modules/ai/__tests__/completion-r17.realdb.integration.test.ts`: adapter failure categories on transport stubs; orchestrator stage matrix; two instances competing for the last budget unit → one dispatch and settled plus reserved never over the limit; same request on two instances → one admission and one exchange; changed payload or actor 409; timeout after dispatch retains the hold across a simulated restart; Gemini blocked without its own reservation; consent-version block; member or view_only consent write denied; a member's private account absent from tool results for another member; provenance assertions; the evaluation pack; CI makes no provider network call.

Oracle: Claude healthy → both stages Claude, provider `claude`, zero Gemini calls, amounts match the fixture; forced eligible Claude failure at analysis → exactly one Gemini analysis and one Gemini answer, both audited, one exchange, one quota unit; Claude answer-stage failure → Gemini reuses sanitised results without re-running tools; both fail → labelled local summary or unavailable, no fabricated number; no key → local mode served and audited with provider `local`; invalid key → operator sees a configuration failure, user sees unavailable, no secret logged; at most three paid attempts; replay one exchange; late result ignored; outdated consent blocks before dispatch.

Runtime evidence: staging smoke recorded with model ids, revision and request count.

## R18 UX, accessibility, phone layout, dates (5–8 days)

Depends on: R02, R03, R05. Lane: FE. Closes: UX-02, NEW-37, UX-01 (client half), NEW-09, NEW-10, NEW-11, NEW-15 and NEW-25 client parts, NEW-27 guidance, NEW-33 client error copy, AH-13 remainder.

Slices: R18.1 sidebar as a drawer below 768 px; content 100% width at 320, 360, 375, 390 and 768 px on Dashboard, Transactions, Add Transaction, Accounts, Budget, Reports, Settings; Reports without horizontal overflow at 1280 px; focus traps; empty and default-filter states; first-run guidance; every visible workflow submits and surfaces validation (wizard). R18.2 every offered control works or, if a fictional commercial claim, is removed: TopBar radios, "Reset Defaults", "Copy balance history", greeting, transfer-leg attribution, individual delete, archive and correction controls for transactions, budgets, goals and holdings under the lifecycle contracts, preset create and delete. R18.3 dates, locale and decimal display standardised; native `confirm()` replaced by the app dialog; icon buttons labelled; keyboard order and skip links; error association and announcement; 200% zoom; reduced motion; chart table alternatives; loading, error, retry and offline states.

Data and migration: per-user display defaults migrate without overwriting choices.

Tests: `e2e/completion-r18.spec.ts` on the production-mode profile: Mobile Chrome layout spec asserting `scrollWidth === innerWidth` and visible headings on the listed pages; axe-core on the eight primary pages with no critical or serious issue; keyboard spec for the Add Transaction dialog; a control inventory test that every primary-page control has an observable result.

Oracle: at 375 px the sidebar is collapsed and nothing is clipped; no first-run toast cascade; keyboard and screen-reader journeys complete; real phone and browser matrix recorded.

## R19 Deployable operations, storage, recovery (4–7 days)

Depends on: R00. Lane: OPS. Closes: OPS-002, OPS-014, OPS-015, OPS-001 (storage), OPS-013 (Redis namespace), NEW-39 (schema hygiene, tracked files), QA-02 (staging and drills), OPS-003 (trigger side), D15, D18.

Where: `render.yaml` (no disk, no cron services, TLS comments only, `allkeys-lru` shared); `server/app.ts:256-263` (`/healthz`), `health.controller.ts:71-83`; `server/dbSsl.ts:57-62`; `server/utils/logger.ts:76-108`; `uploadsAuth.ts:33`, `receipt/upload.service.ts:87-105` and the other upload writers; 30 tracked files under `uploads/`; `shared/schema.ts` long FK names; the admin route on a missing table; `scripts/verify-deploy-readiness.mjs`.

Slices: R19.1 declare staging and production service identities: web service, PostgreSQL, Redis with coordination in a separate logical db or a `noeviction` instance, durable storage per D18 (object storage default; persistent disk acceptable for a confirmed single instance), cron services per registered job with `CRON_SECRET`, TLS CA mounted with `DATABASE_SSL_REJECT_UNAUTHORIZED=true`, pinned runtime, `APP_URL`, `CLIENT_URL`, `SMTP_*`, `VAPID_*` from secrets; one storage abstraction (`server/core/storage.ts`) with object and local-disk drivers used by receipts, attachments, goal images, profile and banner images and merchant logos; `uploads/` ignored and the tracked files stopped tracking (history rewrite only by owner decision). R19.2 `/health/ready` performs a bounded DB query and a Redis set and get, returns 503 within 2 s on failure, reports revision and job staleness; logger serialises all context keys through `redactSensitive` and keeps errors and job outcomes; metrics and alert routing for failed jobs, dependency health, delivery failures and error rate; outage scenarios for DB, Redis and storage. R19.3 versioned migration on deploy, backups including files, restore to a fresh target with timings, rollback compatibility, failed-migration recovery and incident runbooks; schema hygiene (explicit FK names under 63 characters; the admin route fixed or removed); env validation covers every variable the app reads; `deploy:verify` makes a live readiness call when a URL is given; staging provisioned from the blueprint (G0).

Data and migration: object manifest and job and AI state included in backups; test, staging and production separated; no deploy or paid service creation authorised by this document.

Tests: `server/testing/__tests__/completion-r19.test.ts`: readiness with a stopped DB and a Redis stub; logger redaction and context retention; storage driver tests; `deploy:verify` test.

Oracle: known SHA on HTTPS staging; invalid CA fails the connection; required outage makes readiness fail within 2 s; a receipt uploaded before a redeploy downloads after; restore meets the proposed RPO 24 h and RTO 4 h; rollback compatible with migrated data; a job error appears in logs with context and no secret or raw finance payload.

## R20 Trustworthy automated and runtime verification (3–5 days)

Depends on: R00. Lane: QA. Closes: OPS-011, QA-01, D19.

Where: `e2e/transactions.spec.ts:175` (fills without submitting), `e2e/investments.spec.ts:103` (skips populated tab), specs with `if (control)` guards; root `vitest.config.ts`; `playwright.config.ts`; CI smoke project.

Slices: R20.1 guard every root, server and browser harness against a real database or an arbitrary reused server: explicit disposable target with a run marker, refusal before any connection otherwise; pinned browser and runtime identities. R20.2 replace fill-only and conditional-empty assertions with submit → result → database read-back; deterministic populated fixtures (from the R00 portable generators) so no populated state is skipped; a mutation check in CI that skips each spec's submit and expects red; absent required controls fail. R20.3 a separate production-mode verification profile (`playwright.production.config.ts` and a guarded launch script) with HTTPS, CSRF, cookies, CSP, limiters, Redis, UTC server and Lusaka actors, synthetic data, local SMTP sink and mock providers; standard tests and protected-runtime probes report separately.

Data and migration: none; fixtures generated per run with scoped cleanup; never reuse private audit cookie jars.

Tests: `server/testing/__tests__/completion-r20.test.ts` (target refusal); the rewritten e2e specs themselves; the mutation check.

Oracle: wrong target aborts before a write; every e2e spec fails when its asserted row is absent; no new skip conceals a regression; the production-mode profile runs against staging.

## R21 Integrated acceptance and controlled release (6–9 days)

Depends on: all. Lane: QA+OPS. Closes: QA-02 (drills), ENV (metadata refresh), the gate itself.

Slices: R21.1 execute J01–J16 (Part F) at one candidate SHA on production-mode staging with the independent oracles; re-run both Fable verifier script sets, the 14 October probes and the Codex probe harness; every register row's evidence collected. R21.2 real controlled SMTP, provider, push and device checks; backup restored to a fresh target with the smoke run against it and timings recorded; rollback rehearsed with the forward-only migration check; failed-migration recovery; load test against the proposed targets; 14-day soak with synthetic households; owner UAT across every module; independent reviewer sign-off; explicit deployment authorisation (OI-06). R21.3 canary household with a real mailbox on production; first due jobs observed; 72-hour monitoring; expansion only after the gates; refresh module assessment metadata, W9/W10 coverage, CLAUDE.md stale statements (conversation stubs, LOC scope, status docs) and release notes from completed evidence; archive manifests; residual limitations accepted by the owner with a date.

Data and migration: none by default; release manifests pin code, config, schema, object and provider identities; a fix resets affected evidence and the soak.

Oracle: no required open row; every J01–J16 journey passed at the candidate SHA; restore under 4 h with at most 24 h loss (or ratified targets); rollback rehearsal recorded; continuous 14-day soak without P0 or P1; UAT signed; production smoke and first due runs observed.


---

# Part E. Agent operating protocol

## E1. Authorisation and precedence

The owner has now authorized a separate Astra-led local implementation campaign with Sol High/Extra High workers, as recorded in master version 2.2. Advance through dependency-ready packets without repeated per-packet approval; preserve the master's external, paid and release gates. Do not re-ask the full-product brief or the Claude and Gemini order. Stop only the dependent action when an OI input is missing or a target is ambiguous; continue independent authorised work. Astra assigns concrete engineering ownership before code work; human UAT/operator ownership remains an input for its dependent gates.

Copy-and-paste task for an implementing agent:

> Implement packet Rxx under the owner's separate implementation authorisation, with docs/plans/2026-10-15-master-completion-spec.md as the single authority. Read its relevant contracts, canonical rows, packet and acceptance requirements first. Use the matching Part D work order, Part E host-specific instructions and compatible Part F oracles in docs/reviews/2026-10-15-unified-completion-spec/FINAL_COMPLETION_SPEC.md as the detailed companion. Master requirements prevail over conflicting companion text. Confirm dependencies and the current SHA, claim exact file ownership, preserve other agents' changes. For each slice: write a failing behavioural regression against the independent oracle, implement the smallest coherent fix and migration, run focused checks and affected suites, produce protected runtime evidence and obtain review. Update completion status in the master only; map companion subchecks to its canonical groups. Label synthetic assumptions and retain real-world enablement gates. Do not cut features, invent external policy or credentials, use the real finance_app database, mark source-only work as runtime-verified, or deploy without authorisation. End with completed rows, actual tests and evidence paths, unresolved blockers and the next safe work order.

## E2. Environment and safety

1. Databases. `finance_app` (development) is never written by tests, probes or scripts. Server tests run only against `finance_app_test` (`npm run db:test:setup` once; `server/vitest.config.ts` refuses non-test-scoped names). Runtime evidence uses a disposable database per run, named with the work order and run (`pfa_completion_r08_<run>_test`), created empty and migrated with `drizzle-kit migrate`, never `db:push`; verify the resolved database name and host against the target manifest before the first write, without printing secrets. Root and browser harnesses get the same refusal in R00 and R20.
2. Audit server for runtime evidence: development mode (CSRF and limiters active), SMTP to the local sink, AI key empty (as an empty string; dotenv re-injects deleted variables), `LOG_LEVEL=debug`. The `audit` entry in `.claude/launch.json` and `run-audit-server.mjs` show the recipe. Server Vitest forces `NODE_ENV=test` and cannot establish CSRF, CSP or limiter behaviour; release evidence comes from the production-mode staging profile only.
3. Outbound. No real e-mail, push, provider call, deploy, merge or push to a shared branch without explicit instruction. Ordinary tests use mocks and the SMTP sink; the only live provider path is the R17 staging smoke under OI-02 with a recorded request budget.
4. Secrets live in `.env` locally and in Render secrets, never in code, tests, fixtures, logs or PR text; tests assert their absence at HTTP boundaries.
5. Data is synthetic only (`@audit.invalid` or `@example.com` addresses); nothing resembling a real person or identifier; never reuse private audit cookie jars.
6. The assessment host is also a CI runner; do not run two full suites while a CI job is active.
7. Worktrees: the assessment and specification packages are untracked and will not appear in a new worktree; copy this directory and its referenced evidence explicitly or commit the docs under authorisation first; verify checksums; never copy `.env`, cookies or raw logs.

## E3. Working conventions

Branch per work order or sub-order (`fix/r04-visibility-matrix`, `fix/r11a-rule-references`), based on current `origin/main`; re-run `npm run check` after every merge from main (the LOC ratchet and type errors have surfaced after pulls). Conventional commits, one concern each, register ids in the body, the required attribution trailer. PR body: rows closed; decisions and defaults applied; files changed and why; tests added with names and the runner's summary lines (never an exit code alone) and the database they ran against; runtime evidence with before and after values; migrations and rollback; LOC ratchet status; anything left open and why. One agent owns an active work order; `shared/schema.ts`, package manifests, common money and visibility utilities and deployment configuration have a single active editor; a schema change needs dependency acknowledgement before integration; never revert another agent's work.

## E4. Slice loop

For every slice: (1) claim ownership and record baseline, dirty files and dependencies; read the exact source finding and current call path; (2) write a failing behavioural regression using the independent oracle, over real HTTP and persistence for permission and money defects, never computing expected values with the production helper; (3) run the single regression and capture the expected assertion failure (an environment error is BLOCKED, not red); (4) implement the smallest cohesive change, validate at boundaries, transact financial effects, add a migration only with explicit mapping and backfill proof; (5) run the focused test to green, then adjacent tests and `npm run check`; include failure, retry, unauthorised and concurrency branches; (6) run the matching protected runtime journey on the isolated target (and later staging) and save evidence with SHA, config, target and expected versus observed values; (7) review changed code, migration and error paths; (8) update the register honestly; record incomplete runtime evidence and the next action in the handoff.

Commands: `git status --short`; `git rev-parse HEAD`; `npm run check`; `npm run test:server:run -- modules/<area>/__tests__/completion-rNN.realdb.integration.test.ts` (the script runs `cd server && vitest run`); `npm run test:run -- client/src/<area>`; `npm run build`; `npm run check:bundle`; `npm run deploy:verify`; full suites when integrating a candidate; `npx playwright test --config playwright.production.config.ts e2e/completion-rNN.spec.ts --project=chromium` once R20 exists. Quote the runner summary lines in the PR and state which database the server suite used.

## E5. Closure rule and status lifecycle

Statuses: OPEN → IMPLEMENTED → LOCALLY_VERIFIED → STAGING_VERIFIED → CLOSED; REFUTED with exact counter-evidence. A row reaches CLOSED only with: implementation SHA; a regression that failed before and passes after, by path and name; the affected UI, API and database paths agreeing; runtime evidence from the isolated target for rows marked HTTP or DB; staging evidence at a known revision for rows whose acceptance depends on deployment; negative, race and retry cases; review disposition; the CSV row updated with SHA, test, evidence path and status; CI green on the branch. A PR title, a success toast, a mock-only test, a merged commit or a historic green run does not close a row.

## E6. Evidence

Raw outputs under `.local/remediation-<date>/` (git-ignored); the durable record is `evidence/Rxx/RESULT.md` in this directory, created only during authorised execution, containing: work order, agents, branch, exact SHA and dirty-tree disposition; rows claimed and dependency status; intended behaviour and the failure before repair; target manifest (database name and host alias without credentials, server origin and run marker, mode, Node, Postgres and Redis versions, schema version, clock and timezones); changed files and migration ids with preflight and backfill counts; exact commands, exits, test counts and assertion outcomes, with historical, local and staging results separated; independent expected values and redacted API, SQL, file and provider observations with before and after visibility controls; retry, concurrency, restart and fault-injection evidence; review findings, rollout and rollback notes, unresolved OI items and next action. Machine-readable entry per packet:

```json
{"packet":"R08","findingIds":["NEW-05","FIN-08"],"implementationSha":"<actual>","status":"LOCALLY_VERIFIED","targetManifest":"<path>","checks":[{"case":"card-debt-sign","expected":"545.50","observed":"<actual>","passed":false}],"stagingEvidence":null,"reviewDisposition":"pending"}
```

Replace the illustrative values only with observed outcomes.

Resume note template: packet, assigned agent, reviewer; authorisation reference; branch, SHA, worktree, dirty-file ownership; source findings and dependencies; changed files and migrations; last completed slice; commands actually run and results; runtime target, mode, fixture and evidence paths; register status changes; unresolved input or failure; next exact command or bounded task.

## E7. Known traps on this codebase and host

- The money-float PreToolUse hook blocks writes containing `parseFloat`, `Math.round` or `Number(` in financial paths and has prose false positives when an asterisk shares a paragraph with the words rate or amount; the `as any` hook blocks `as any`, `: any` and `@ts-ignore` in `.ts` and `.tsx`.
- The Stop hook blocks ending a turn while `npm run check` or the core calculation tests are red.
- Git Bash mangles `/api/...` arguments into Windows paths; export `MSYS_NO_PATHCONV=1`. Long heredocs fail in this shell; write scripts to a file and run them.
- Until R00 lands, `/api/auth/*` is limited to 5 requests per minute per IP; space scripted logins or use saved cookie jars. Until R02 lands, anonymous CSRF tokens are invalid because the session is not saved; verify fixture users directly in the disposable database.
- Playwright needs the `chromium_headless_shell` build matching the installed version; the download needs approval.
- Subagents can be killed by the account's spend limit; checkpoint evidence to files as you go.
- The LOC ratchet fails the build when a baselined file grows; extract instead of growing; never update the baseline to pass.
- Push-built databases lack indexes that migrations create; build evidence databases with `drizzle-kit migrate`.
- Drizzle returns `date` and `decimal` columns as strings; never compare a JS Date to a date column; never do arithmetic on an amount outside `Money`.
- CLAUDE.md contains stale completion statements (conversation stubs, LOC scope, status docs); verify source, do not treat them as readiness proof.
- Two agent sessions have shared this checkout and written into the same `docs/reviews` directories concurrently; check `git status` and file mtimes before writing, and never assume a path is yours alone.

---

# Part F. Acceptance catalogue J01–J16 and oracles

All journeys are NOT RUN for this specification. They are executed in R21 on production-mode staging at the candidate SHA with the role, independent expected value, failure case and evidence link recorded. Expected values are handwritten or produced by scripts independent of the production helper.

## F1. Fixtures

Golden fixture A (posting, liability, FX, splits), run in order on fresh rows with an approved FX valuation of 20 ZMW per USD:

| Step | Expected persisted and reported result |
|---|---|
| Cash A opening 1000, cash B opening 0, card debt 500 | Assets 1000; liabilities 500; net worth 500 |
| Cash A income 200 and expense 125.50 | A 1074.50; assets 1074.50; net worth 574.50; expense 125.50 |
| Transfer 100 from A to B | A 974.50, B 100; assets 1074.50; household net worth 574.50; expense unchanged |
| Card purchase 45.50 | Liability 545.50; net worth 529.00; combined expense 171.00 |
| Add USD account with opening 10 at rate 20 | USD 10; converted assets 1274.50; net worth 729.00 |
| Cash A expense 100 split 60/40 | A 874.50; assets 1174.50; net worth 629.00; expenses 271.00; split categories 60 + 40, parent not double-counted |
| Replay the same operation identity | No new financial effect or audit; row counts stable |
| Edit and delete each operation in a separate reset scenario | Exact inverse or replacement effects across balances, splits, links, caches and audit; no orphan transfer leg |

Separate fixtures: FX flow USD 10 dated at rate 20 = 200 ZMW historical; valuation at later rate 26.50 = 265 ZMW; missing or stale rate never 1.0; another household's override changes neither. Goal: manual progress 5, linked allocation 10 → 15, unlink → 5; edit and delete repeat safely. Budget: three months 100/100/100 → 100 monthly; elapsed three months summing 550 → 183.33 suggestion; 450 remainder carries once; ZMW 100 plus USD 10 at 20 → ZMW 300. Investment: cost 950, face 1000, as-of 1000; principal settlement 1000 → cash +1000, holding −1000, ordinary income 0, realised difference 50 explained separately; coupon 100 with synthetic withholding 15 → net 85; two purchases at an unchanged price → zero gain; 10 shares at 310.50, sell 5 FIFO.

Fable historical fixtures and scripts (ported to `server/testing/fixtures/` in R00; originals under `.local/readiness-fable-2026-10-13/scratch-*/` and `evidence/domain-*.md`): reports household A4 (Checking 10000.00, Savings 2000.00, USD 100.00, card 500.00, private 300.00; September expenses 1564.15; October budget actual 1273.75; net worth 41577.69; ratios liquid assets with USD 75 at 26.50 include 1987.50); budgets A1 (October Groceries 650.74 of 1000.00, remaining 349.26, 65.07%; recalc 550.00 over three months → 183.33; Dining 500.00 untouched; rollover 450.00); investments A3 (bond face 250000.00, coupon 14078.12; `hand.mjs` values); security A5 (owner, admin, member, view_only, professional, outsider; private transaction PRIVSECRET 777.77; shared 11.11); the 14 October probes (ORG-003 foreign ids, ORG-004 dry-run writes, AH-09 view-only preferences). Codex probe harness under `.local/readiness-2026-10-11/` (two-cookie revocation, overwrite replay, goal-link leak, profile save).

## F2. Journeys

| Journey | Required path | Negative, race and failure cases | Evidence that closes it | Work orders |
|---|---|---|---|---|
| J01 Identity | Register → captured e-mail → verify in a different browser → login, logout → reset → login with the new credential | Pending access denied; wrong, expired, used token; CSRF on normal mutations; mail failure and resend; enumeration; copied old cookie | Browser trace, redacted link route, HTTP outcomes, `email_verified`, token and session-store read-back | R01, R02 |
| J02 Household | Owner invites every offered role → verified intended recipient accepts → real name and correct capabilities → role change, remove, leave, transfer | Wrong recipient; used, revoked, expired invite; self-transfer; simultaneous transfer and role mutation; two accepts and create-vs-accept | Exactly one active household per user and one owner per household; no unauthorised shared or private read or write; both browser sessions | R03, R04 |
| J03 Settings and security | Every visible field save, clear, reload; personal preferences and shared views; MFA enrol, login, backup, regenerate, disable, recovery; device revocation | Unknown schema keys; view-only household policy; one-time races; outdated open form; policy version on existing session; missing FX for threshold | Field matrix API plus DB; no credential sentinel; correct role controls; one-winner and replay assertions | R01, R05, R06 |
| J04 Ledger | Golden fixture A plus all writers (manual, import, recurring, receipt, rule, GRZ); create, edit, delete, retry; pair-preserving transfers | Competing writer lock; stale version 409; mid-transaction fault; wrong currency; split over-allocation; account type or opening edit | Independent before and after balances, both legs, immutable currency, audit and outbox; no drift or duplicate effects | R08 |
| J05 Privacy | Direct, list, activity, goal, tag, recurring, assignment, portfolio, export, count, report, AI and notification matrix across owner, admin, member, view_only, Professional, outsider and unknown role | Private-account with false transaction flag; private transaction on shared account; foreign category, tag, member, goal ids; recipient-specific jobs | No private marker, amount, id or count; denied writes unchanged; positive authorised control per route | R04, R11, R12, R16, R17 |
| J06 Imports | Both entrances → mapping, date, duplicate, transfer preview → commit → row errors and history → export → round-trip | Same file repeat; altered payload under the same key; same-day identical valid purchases; Feb 30; ambiguous date; transfer-range overwrite; halfway fault; lost-response replay (100, −10, +20 → 110 once) | Row-level ids and outcomes, exact account changes, batch identity, Notes retained, no deleted-and-skipped replacement | R09 |
| J07 Organisation | Seed, create, archive categories and groups; tag and merchant merge; alias, logo, details; undo after intervening edits; default preset; rule preview, test, apply | Cross-household ids at authoring and execution; every dry-run action; repeated removal; invalid reorder; 60/60 split; concurrent undo | Full table snapshots unchanged for dry-run; actual affected counts; all client-called routes persist | R11 |
| J08 Budgets | Create, manual edit, history → FX, split, refund spend → average preview → rollover | Zero and future months; missing FX; concurrent recalculation; owner preference persists; private spend excluded | 271.00 expense fixture where applicable; 550/3; 450 carried once; report and export parity; valid batch audit | R10, R12, R14 |
| J09 Goals | Create → contribution and correction → allocation, link, unlink → assignment → archive, complete, reopen | Overfunding confirmation; invalid huge amount; missing FX; linked transaction edit and delete; concurrent contributions; repeated unlink | Exact progress source identity and inverse values; no hidden-data activity or double counting | R10, R08 |
| J10 Recurring and jobs | UI rule → deployed due tick → exactly-one materialisation → catch-up → pause and end; every registry job | 31st anchor; timezone and DST; stale lease; two workers; crash after effect; future `asOfDate`; backlog over 100 | Durable run and due identity, fencing, checkpoints, last success; staging logs plus ledger rows from actual scheduled triggers | R14, R19 |
| J11 Investments | Opening, manual and automated buy → FIFO partial and full sell → basis, fees, FX → income, withholding, tax export; bond-only UI; pension; maturity and rollover | Negative or oversell; no tax lot; sold-bond pay; sale and pay race; zero-interest bill; invalid rate or date; missing rollover terms; 31 December | Cash, holdings, lot, disposal and report read-back; principal ordinary income 0; versioned calculation policy; OI-03 evidence before real use | R13, R12 |
| J12 Reports | Dashboard, summary, cash flow, budgets, ratios, all report tabs, chart periods and CSV with the same actor and filter | Latest versus dated rate; stale caches on both backends; quarter grouping; Unassigned and Uncategorised; split and card purchase; incomplete snapshots; another member writes | Independent golden totals (1564.15, 41577.69, 1273.75, 1987.50); no Invalid Date; immediate revalidation; rounding foots; explicit incomplete states | R12, R18 |
| J13 Receipts | Real file upload → OCR under CSP → correct → match or create → retry, delete → restart and restore | Negative amount; concurrent create; worker unavailable; wrong household file; legacy path; corrupt object; duplicate hash | Exactly one ledger effect; persisted reviewed values; manifest checksums; authorised download; no server paths | R15, R19 |
| J14 Outbound and AI | E-mail, push, recap settings → scheduled and send outcomes; Claude success → forced eligible Gemini → both-fail local or unavailable | Unknown or private push endpoint; channel partial failure; consent role and revocation; safety and data errors; two last-budget requests; unknown-cost restart; cancellation and late reply | Per-channel outcome and audit; recipient-private markers absent; correct provider per stage; one conversation; at most 3 paid attempts; durable reservations | R16, R17 |
| J15 Export and exit | Request → async export download → expiry; household-free, shared and last-owner erasure and leave | Access changes before download; interrupted purge; object deletion failure; stale sessions, tokens, files; backup restore of an erased identity | Visible-only manifest and counts; denied stale access; retained shared audit pseudonymised; erasure eventually complete; retention input documented | R07 |
| J16 Operations and devices | Empty and populated migrations; HTTPS security; dependency outages; load; keyboard, screen reader, phone; restore and rollback | Invalid TLS CA; Redis down or eviction; no SMTP or AI key; log redaction; wrong test target; runtime mismatch; missing required UI control | Target manifest and SHA; refusal before wrong-target writes; p95 and device results; object plus DB restore RPO and RTO; alert and runbook | R00, R18, R19, R20, R21 |

No automatic pass for controls that are absent, hidden or unpopulated. A mocked client test cannot prove server persistence. An HTTP create without the actual UI payload cannot close a UI journey. A local restore does not certify an unknown production setup.

## F3. Candidate gates

Static, build, client, server and bundle checks pass on the exact candidate; targeted regressions and the production-mode runtime journeys pass; no required register row lacks evidence; real controlled SMTP, AI, push, scheduled-job, storage, device, restore and rollback checks performed; 14-day no-P0/P1 soak with incident evidence; owner UAT. Security and financial fixes invalidate affected evidence; a release-blocking regression resets the soak. Post-deploy: verify source, config and schema identity, run a synthetic canary without real household data, observe the first due production jobs, monitor 72 hours. Production deployment and invitations require OI-06.

---

# Part G. Phases, gates, dependencies, lanes, calendar, risks

## G1. Phases and gates

| Phase | Work orders | Exit gate |
|---|---|---|
| 0 Baseline and protected targets | R00, R20 foundations, R19 staging bootstrap; OI-01 and OI-05 recorded | G0: supported runtime pinned with CI green and the audit step blocking; isolated DB and server guards on every harness; honest browser harness profile; staging provisioned with secrets, storage, cron services and TLS CA; `/health/ready` 200 with DB and Redis checks; limiter fix merged |
| 1 Identity and privacy | R01, R02, R04, R03; R11 reference and purity slices may land early | G1: actual revocation; fresh-device verification; role, private and reference denial across the matrix incl. Professional and unknown role; member lifecycle with one owner; DTO key-set test green |
| 2 Money | R08, R09, R12, R10, affected R14 slices | G2: exact asset and liability effects; pair-safe imports on both paths; report FX, splits and periods reconcile to the golden fixtures; reversible budget and goal state; dry-run writes nothing; summary agrees within one request |
| 3 Complete workflows | R05, R06, R07, R13, R14, R15, R16; deployed R19 foundations | G3: settings, MFA and exit functional; investments and GRZ lifecycle reconciles; jobs durable with two consecutive days of staging cron evidence; receipts under production CSP on durable storage; notifications truthful per channel; shared views functional |
| 4 AI and usable product | R17, R18 | G4: Claude, Gemini and local paths proven on staging with provenance; consent and budget concurrency tests green; phone and accessibility specs green; no inert offered controls |
| 5 Release candidate | R19 closure, R21 | G5: every register row closed or evidence-refuted; J01–J16 passed at one SHA; restore and rollback rehearsed; 14-day soak clean; owner UAT signed; no unresolved OI for an enabled feature |
| 6 Controlled release | deploy, canary, first households | G6: authorised deployment at the exact SHA; smoke green; first due production jobs observed; 72 hours without P1; expansion by owner decision; no scope reduction |

A minimal invited pilot is a rollout stage after the applicable gates, not an alternate completion definition. Any newly discovered defect gets an id, work order, severity, evidence and acceptance condition before repricing.

## G2. Dependency graph

Completion dependencies (implementation may start earlier where a work order says so):

- R00 → R01, R19, R20; R19 → R07, R14 (staging evidence), R15, R16, R17
- R01 → R02, R04, R06, R07; R02 → R03, R06, R18; R04 → R03, R05, R07, R08, R11, R12, R16, R17
- R03 → R05, R07, R18; R05 → R06, R07, R17, R18
- R08 → R09, R10, R11, R12, R13, R14, R15; R12 → R10, R13, R16, R17; R14 → R13, R16
- everything → R21

Shared hot files with a single active editor per week: `shared/schema.ts`, `TransactionRepository.ts`, `BaseReportRepository.ts`, `ai.service.ts`, `validateEntity.ts`, `household.routes.ts`, `render.yaml`, package manifests.

## G3. Lanes for two developers

| Weeks (low estimate) | Lane A (backend-leaning) | Lane B (frontend and operations-leaning) |
|---|---|---|
| 1–2 | R01, R04 | R00, R20 guard, R19 staging bootstrap |
| 3–4 | R08 | R02, R03 |
| 5–7 | R12, R09 | R05, R06, R11 client half |
| 8–9 | R10, R11 server half | R07, R14 registry with A |
| 10–12 | R13 | R15, R16 |
| 13–15 | R17 | R18, R20 e2e rewrite |
| 16–19 | R21 server evidence | R21 drills, soak, UAT |

Two developers yield about 1.6 times one developer's throughput, not 2; shared contracts serialise work.

## G4. First ten working days

| Days | Work | Output |
|---|---|---|
| 1–2 | Owner records OI-01 and OI-05; R00 slices 1–3 (runtime, advisories, limiters); approve the Playwright install; R20 target guard; R19 staging configuration design | CI green on the pinned runtime; no self-inflicted 429s; wrong-target refusal; smoke result recorded |
| 3–5 | R01 (revocation, DTOs, atomic codes); R02 fresh-browser verification; small reviewed changes | Two-cookie test green; verification from a second browser |
| 6–8 | R04 (capability table, predicate, gates, reference helper); R11 reference and dry-run regression slices | Privacy matrix test green; AH-09 probe 403; ISO-01 404; ORG-003 and ORG-004 probes 400 and unchanged snapshots |
| 9–10 | R03 membership and ownership; R08 money oracles; start R09 overwrite only once the R08 executor contract is settled | Invite accepted in a second browser; Golden fixture A red tests in place |

Unfinished prerequisites carry forward; do not compress tests or mark a gate passed to keep the allocation.

## G5. Effort and calendar

Version 1.2 note: the following estimates and dated projections are retained source scenarios. Master section8's Astra/Sol staffing, 88–145 baseline effort, single reserve and measured-throughput reforecast govern campaign planning. These older dates are not commitments and are not added to the master estimate.

Effort: 92–151 focused developer-days before reserve (about 552–906 engineering hours at six focused hours a day); 110–181 with the 20% reserve applied once. This is a reconciled planning range, not a quote; it includes the union of both registers, the broader settings and shared-view scope, the durable AI admission ledger, the investments settlement model and real acceptance work. Do not add the earlier estimates together; they overlap.

Projections, labelled: one developer at about 20 working days a month, starting Monday 19 October 2026, one week lost over the holidays.

| Milestone | Low (92 days) | High (151 days) | With reserve (110–181) |
|---|---|---|---|
| Build complete, R21 starts | early March 2027 | mid-May 2027 | late March to early July 2027 |
| Release candidate after soak and UAT | late March 2027 | early June 2027 | mid-April to late July 2027 |

Two developers with the lanes in G3: build complete mid-January to late February 2027 before reserve, release candidate February to late April 2027 with reserve. Reforecast at G1 and G2 from measured throughput; a gate never moves to hit a date.

## G6. Risk register

| Risk | Likelihood | Effect | Mitigation |
|---|---|---|---|
| Staging provisioning slips (OI-01) | medium | every gate from G0 slips the same days | OI-01 in week 1; R19 bootstrap first in lane B |
| New P0 or P1 found on staging | high | 1–3 days each | the 20% reserve; the 21 source-only or not-exercised rows are the likeliest sources |
| R08 and R12 touch seven repositories and every writer | high | regressions in reports that currently reconcile | property suite first, golden fixtures as oracles, one owner for hot files |
| Timestamp and currency migrations on existing data | medium | wrong instants or currencies | rehearse on a sanitised prior-schema copy (R21.1); reconciliation reports, no guessing |
| Claude credit balance or pricing changes (OI-02) | medium | R17 ceilings and price tables change | the ledger prices both legs at dated rates; the ceiling is configuration |
| Professional matrix or shared-views scope disputed later | low | rework in R03, R04, R05 | the capability table is one table; D06 and D07 recorded with reversal cost |
| Two sessions writing the same files | medium | lost or interleaved edits | single active editor per hot file; check mtimes; evidence directory per packet |
| Agent sessions killed by spend limits | medium | lost work | checkpoint evidence files; small PRs |
| Hook false positives block edits | medium | wasted turns | avoid asterisks near rate and amount in prose; surgical edits |

## G7. Reporting cadence

End of each work order: PR merged, CSV rows updated, `evidence/Rxx/RESULT.md` written, a dated line appended to `PROGRESS.md` in this directory. Each gate: a one-page gate report listing the gate conditions with evidence links and any accepted residual with owner and date. Reforecast lines at G1 and G2.
