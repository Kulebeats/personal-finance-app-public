# Decisions: resolved differences, assumed defaults, open owner decisions

Agents implement against this file. Where a decision is marked DEFAULT, implement the default and say so in the PR; the owner can reverse it, and the reversal cost is stated. Where a decision is marked OWNER, do not guess beyond the default.

## 1. Differences between the two assessments and how they are resolved

| # | Topic | Codex (11 Oct) | Fable (13 Oct, revised 14–15 Oct) | Resolution |
|---|---|---|---|---|
| R1 | Thandi provider order | Claude primary, Gemini fallback, local degraded mode; full spend-reservation ledger | Claude only plus local degraded mode first; Gemini and ledger deferred | OWNER DECIDED: Claude primary, Gemini fallback, local degraded mode, per the 11 October THANDI_PROVIDER_SPEC. The ledger applies to both legs; the owner's Claude credits are a finite balance, not a zero price: both legs reserve and settle at dated list prices, and the credit balance with its conditions and expiry is recorded as the Claude provider ceiling. Work order CP-19 |
| R2 | Professional role | Mandatory full support with an approved matrix | Implement or remove, owner's choice | DEFAULT: implement. Matrix: Professional reads authorised shared data like view_only, runs no financial or report export jobs, makes no mutations, manages neither consent nor members, and may request a personal privacy export like every role. Enum, invite and role-change controllers accept it; `requireRole` fails closed on unknown values. Reversal (remove the role) saves 1–2 days in CP-03 |
| R3 | Settings, export, erasure, shared views sizing | One packet P05 at 12–20 days with four deliverables | Three packets totalling 7–10 days | Adopt the Codex scope, split into CP-05 settings (3–5), CP-06 MFA (2–4), CP-07 export and erasure (5–8). "Shared views" resolves as named household saved views over authorised data, owner and admin editable, applicable by any member, never widening the visibility predicate (CP-05, DEC-24); the per-user Shared/Mine/All filter also persists (CP-14); the "Household Premium" panel is removed; no entitlement system is built |
| R4 | GRZ conventions | Preserve record-only purchases; no principal-as-income finding | Record-only preserved; GRZ-01 principal as income and GRZ-02 sold bonds paying are P0; state machine required | Both: record-only preserved and the state machine implemented. DEFAULT DEC-08b: under record-only purchases a confirmed principal receipt retires the holding and posts one asset-to-cash settlement with ordinary income zero; principal never posts as income, and creating an instrument never invents a purchase debit. DEFAULT DEC-08c: automated T-bill rollover refuses to run without a live yield and records the refusal. CP-15 |
| R5 | Severity where both found the same row | | | The higher of the two applies: session revocation P0 (AH-01); budget currency P0 (FIN-06/BGR-01); scheduler P0 (OPS-003/F-OPS-01); unverified session access P1 (AH-04/F-AUTH-03); health, logger, Invalid Date, first-run cascade, local e2e target P1 (full-product brief); recurring schedule drift P1 (FIN-12); MFA UI P1 |
| R6 | Acceptance catalogue | J01–J16 enumerated | Described, not enumerated | J01–J16 adopted verbatim in ACCEPTANCE_CATALOGUE.md with the Fable fixtures and verifier scripts added as oracles |
| R7 | Reserve | 20% | 15% | 20% until two gates have produced throughput data |
| R8 | Runtime mode for verification | Test mode (CSRF and limiters off) | Development mode locally | Development mode locally; production-mode staging for every gate from G0; `NODE_ENV=test` never produces release evidence |
| R9 | Calendar | No dates | Projections | Gate-driven with projections stated as ranges (REMEDIATION_PLAN.md §5) |
| R10 | Conversation endpoints | Not addressed | CLAUDE.md "stubs" claim found stale: list, get, delete and persistence exist | Implemented; CP-19 extends, does not rebuild |
| R11 | Consent version enforcement | Required: outdated disclosure blocks external calls | Found that the middleware checks only `aiConsentGiven` | Implement the block in `consentCheckMiddleware`; CP-19 |
| R12 | Rule dry-run and foreign references | ORG-003 and ORG-004 source-confirmed P0/P1 | Doubted, then reproduced live on 14 Oct | Confirmed; CP-14 first items |
| R13 | View-only preference writes | AH-09 P1 | F-SEC-01 said per-user; reproduced 14 Oct as household-level | Confirmed P1; CP-04 gate plus CP-05 route split |
| R14 | One-legged transfer deletion on account import | FIN-03 P0 | Confirmed in source 14 Oct | P0 in the import cluster; CP-10 |
| R15 | Role guard fall-through | ORG-001 P0 | Confirmed in source; reachable only once a Professional membership exists | P1 now, P0 the moment R2 lands; CP-04 ships the guard fix before CP-03 enables the role |

## 2. Product and data contracts (defaults an agent assumes)

| ID | Contract | Default | Reversal cost |
|---|---|---|---|
| DEC-02 | E-mail verification policy | Registration creates a session in a pending state; household and financial routes return 403 `EMAIL_NOT_VERIFIED` until verified; resend (once per minute, no enumeration) and logout available; verification link and API work from any browser | Switching to "allow with banner" is a middleware flag plus copy, half a day |
| DEC-03 | Household membership | One active household per user (today's rule); invitation bound to the recipient's verified e-mail; acceptance and creation serialised on the per-user advisory lock | Multi-household would reopen erasure, resolution and privacy; not priced |
| DEC-05 | Scheduler | Render cron services call `/api/cron/*` with `CRON_SECRET`; the in-process registry records durable run identity, lease renewal, retry and last success; coordination keys live outside the `allkeys-lru` cache namespace | In-process node-cron on the single instance is the same registry with a different trigger, one day |
| DEC-06 | Upload storage | Render persistent disk mounted at the upload root (single instance) behind one storage abstraction with an S3-compatible driver stub | Switching to object storage later is the driver, 1–2 days |
| DEC-07 | Dependencies | `npm audit fix` for the eight fixable advisories now; `csv-parse` major evaluated in CP-10; `sharp` updated in CP-00 | none |
| DEC-08 | GRZ withholding tax | Configurable rate per instrument type, default 15%, labelled "pending ZRA confirmation" in the UI until DEC-08a is answered | none |
| DEC-09 | Playwright browser | Approve `npx playwright install chromium` on the development machine | none |
| DEC-12 | Professional role | See R2 | 1–2 days |
| DEC-13 | MFA policy | Mandatory-MFA flag enforced for owner and admin roles when set; existing sessions must re-authenticate within 24 hours of a policy change; high-value step-up threshold proposed at 5,000 in household currency, converted with the dated rate, fail-closed when no rate (a labelled proposal and test fixture until the owner confirms it) | copy and constants |
| DEC-14 | Private data in shared aggregates | Excluded by default from household aggregates, summaries, recaps and AI context; a later owner-approved toggle would be a separate feature | not priced |
| DEC-15 | Uncategorised bucket | Displayed as an explicit bucket in every category view and export | none |
| DEC-16 | Date and time | Date-only fields keep the entered local day; timestamps are written in UTC by the database (`now()` with a UTC session or `timestamptz`); schedules run in the household timezone; CP-08 owns the migration | none |
| DEC-17 | Refunds, pending, excluded | Refunds reduce the category's spend in the period they post; pending transactions are excluded from budgets and reports unless the household preference says otherwise; excluded-from-reports rows never appear in headline totals | copy |
| DEC-18 | Node runtime | The current Active LTS at implementation time, verified against the Node release schedule; pinned in `engines`, CI and render.yaml; native modules re-validated | none |
| DEC-19 | Historical import balance option | Both advertised options kept: "adjust balance by imported rows" and "do not adjust"; the overwrite option is pair-aware and atomic | none |
| DEC-24 | Shared views | Named household saved views over authorised data, owner/admin editable, member applicable; the dead control becomes real rather than removed | removal saves 1–2 days in CP-05 but leaves an advertised control unimplemented |
| DEC-25 | FX override writes | Owner and admin only; members read; global provider rows written only by the market job | widening to members is a one-line capability change |
| DEC-20 | Performance and recovery targets | 100 concurrent users across 20 synthetic households; ordinary API p95 at or under 500 ms; restore window at or under 24 hours of data loss and 4 hours to recover | ratify in G0 |

## 3. Decisions only the owner can make (open)

| ID | Decision | Needed by | Default an agent assumes meanwhile |
|---|---|---|---|
| DEC-01 | Confirm the brief and name the engineering, operations, QA and product owners | before CP-00 | brief as stated in README.md; the person running the agent is all four owners |
| DEC-08a | Zambia Revenue Authority withholding-tax rule and T-bill conventions confirmed by a qualified person | before CP-15 release | 15% configurable, labelled pending |
| DEC-10 | Privacy notice, terms, retention periods for `nrc`, income and salary fields, export and deletion wording | before CP-07 release and before any real user | fields retained for the life of the account, erased on deletion; notice drafted by the agent, approved by the owner |
| DEC-11a | Anthropic key, model id, the free allowance's limits and expiry; Gemini key with billing enabled and a monthly cap | before CP-19 live smoke | adapters built against stubs and recorded responses |
| DEC-11b | Anthropic and Google data-retention terms for the consent text | before CP-19 release | consent text states "per the providers' current API terms" with a link slot |
| DEC-11c | What happens when the free Claude allowance ends | before CP-19 release | the Claude leg's price table becomes non-zero and the same ledger applies; no code change |
| DEC-21 | Render account, staging service, SMTP provider, VAPID keys, TLS CA | before G0 | none; G0 cannot pass without them |
| DEC-22 | Whether to rewrite git history to remove the 30 tracked upload files or only stop tracking them | CP-16 | stop tracking only |
| DEC-23 | Participant-facing help and support channel | before G6 | a "report a problem" mail link carrying the request id |

## 4. What this consolidation did not decide

It did not decide that any finding is closed. Every row in REGISTER.md is OPEN until the closure rule in REMEDIATION_PLAN.md §2.6 is satisfied, including the rows one package reproduced and the other did not. It also did not merge with the parallel consolidation written into `docs/reviews/2026-10-15-consolidated-completion/` by another session on the same evening; where the two disagree, the owner decides which governs.
