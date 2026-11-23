# Comparison of the two consolidated completion packages

> **CONSOLIDATION COMPLETE:** The [Master Completion Specification](../plans/2026-10-15-master-completion-spec.md) incorporates the resolved requirements, corrections and detailed implementation plan. This comparison is retained as historical reasoning, not an outstanding implementation queue.

15 October 2026. Documentation review only. Application baseline: `381e9439afabe7c6cf829cb1cbded91d36da44ee`.

**Latest status:** Claude has since applied most major corrections. See [the response verification below](#9-verification-of-claudes-response). Sections 1–8 preserve the earlier comparison; their unresolved wording must not be read as the status of a correction now verified in section 9.

## Verdict

**The packages agree on the main defects and full-product objective, but they are not interchangeable execution specifications.** My recommendation is to retain the Codex product, privacy, financial-lifecycle and Thandi contracts as the starting point, bring across Claude/Fable's compact work-order format, operational detail and historical regression fixtures, and resolve the explicit conflicts below before assigning implementation. Neither package should be executed unchanged as an unquestioned authority.

Claude's consolidation is easier to scan and often more concrete about an individual repair. Codex is more explicit about cross-module invariants, retry/crash behaviour, safe migration and completion coverage. Some differences are valid product or infrastructure alternatives; others are specification defects that should not become agent instructions.

This report **does not amend either package, select a new governing version, authorize implementation, or close an application finding**. The current instruction remains no app code changes.

## Sources and review boundary

- **Codex:** [README](2026-10-15-consolidated-completion/README.md), [SPEC](2026-10-15-consolidated-completion/SPEC.md), [Thandi](2026-10-15-consolidated-completion/THANDI_SPEC.md), [acceptance](2026-10-15-consolidated-completion/ACCEPTANCE.md), [decisions](2026-10-15-consolidated-completion/DECISIONS.md), [register](2026-10-15-consolidated-completion/REMAINING_WORK.csv), [source coverage](2026-10-15-consolidated-completion/SOURCE_COVERAGE.md), [agent handoff](2026-10-15-consolidated-completion/AGENT_HANDOFF.md), [packet index](2026-10-15-consolidated-completion/PACKET_INDEX.csv), and [detailed plan](../plans/2026-10-15-full-application-remediation.md).
- **Claude/Fable:** [README](2026-10-15-consolidated-completion-fable/README.md), [completion specification](2026-10-15-consolidated-completion-fable/COMPLETION_SPEC.md), [decisions](2026-10-15-consolidated-completion-fable/DECISIONS.md), [register](2026-10-15-consolidated-completion-fable/REGISTER.md), [remediation plan](2026-10-15-consolidated-completion-fable/REMEDIATION_PLAN.md), and [acceptance catalogue](2026-10-15-consolidated-completion-fable/ACCEPTANCE_CATALOGUE.md).
- Historical domain evidence was consulted for selected coverage gaps. Current auth and account-visibility source was inspected for specific disputed implementation instructions. No suites, browser journeys, database probes, deployments or paid provider calls were run for this comparison.
- Both packages use the same application SHA. Their agreement is not two new independent runtime passes: both consolidations already incorporate and cross-reference the earlier assessments.
- During this review, the Claude session added its own [comparison](2026-10-15-consolidated-completion-fable/COMPARISON-OF-CONSOLIDATIONS.md), updated its README and corrected CP-04's privacy backfill instruction. This report incorporates those changes. The remaining predicate and create-time privacy issues below are still present in the refreshed file.

## 1. Agreement and numerical comparison

Both require full completion, Claude primary then eligible Gemini fallback then useful labelled local fallback, real session revocation, complete authorization/privacy, money correctness, durable scheduled work, production-mode staging, sixteen acceptance journeys, recovery drills and a controlled release. Neither claims the application has been remediated.

| Measure | Codex | Claude/Fable | Interpretation |
|---|---|---|---|
| Work packets | 22, R00–R21 | 22, CP-00–CP-21 | Different boundaries; matching numbers do not mean matching work orders |
| Base effort | 88–145 developer-days | 86–138 developer-days | Packet sums verified; Codex is 2–7 days higher |
| With 20% reserve | 105.6–174; rounded up 106–174 | 103.2–165.6; displayed 103–166 | Both broadly similar. If rounding up, Claude's low end should be 104, not 103 |
| Time definition | About six focused engineering hours/day | Developer working days, hours not specified | Not a precise like-for-like price comparison until capacity is normalized |
| Register | 101 unique closure groups: 17 P0, 72 P1, 12 P2 | Headline: 12 P0 clusters, 68 P1 rows and a P2/P3 tail | Do not compare these as counts of independently reproduced bugs |
| Direct count of Claude's register | — | 12 OPEN rows in section 1 and **102 OPEN rows in section 2** | Section 2 mixes severities and splits variants; its claimed 68 P1 cannot be reproduced from an explicit per-row severity field |
| Original Codex finding coverage | All 62 original IDs preserved | All 62 original IDs appear in REGISTER.md | Neither lost the original headline register; this does not establish complete lower-level coverage |
| Traceability | CSV, stable closure IDs, source-qualified domain mapping, staged verification states | Human-readable rows, evidence labels and CP ownership | Codex is easier to audit mechanically; Claude is easier to browse by work order |
| Calendar | Capacity-based range, no start-date commitment | Assumes 19 October start, holiday loss and two-person throughput of 1.6× | Claude is more tangible, but those staffing/calendar assumptions have not been confirmed |

Claude's count discrepancy is a tracking defect, not proof that 34 P1 defects are missing or that it found more bugs. Its register contains repeated source IDs, grouped findings and lower-priority items inside the P1 section. Assign unique closure IDs and explicit severity, then regenerate the totals. Codex's 17 P0 versus Claude's 12 also reflects different grouping and escalation decisions, including ownership integrity, liability sign, market-data isolation and receipt duplication.

The exact calendar remains provisional. Claude's phase table ends around week 20 for one developer, whereas its own 86–138 days is 17.2–27.6 working weeks before reserve. Its later calendar range is broader. Use one capacity model throughout rather than choosing the most attractive presentation. The withdrawn November deadline stays withdrawn.

## 2. Material contract differences

### C01 — Claude credits and spending controls: correct Claude's adaptation

Claude DECISIONS R1 and CP-19 reinterpret the user's API credits as a free allowance and price Claude at zero, while Gemini reserves money. **The user said they have Claude API credits; they did not establish a zero token price or unlimited free usage.** A zero cost model can hide credit consumption and distort a shared spend ceiling.

Codex THANDI_SPEC requires dated provider prices, actual usage and conservative reservations against app, household, user and provider budgets. Retain that contract. If there is a verified promotion, record its credit balance, conditions and expiry separately from gross usage cost. Do not enable paid calls until model access, pricing and numerical caps are configured.

Claude does explicitly retain unknown-usage holds, separate Gemini reservations, per-attempt claims and a durable admission ledger. Those are strengths; it is not merely a Redis-counter design. Its reference to the original Thandi spec imports additional protections, but the zero-price override conflicts with those protections and its local summary names fewer budget dimensions. One explicit final contract is needed.

### C02 — AI consent and degraded behaviour: largely aligned, one conflict

Both version consent for Anthropic and Google, give management to owner/admin, recheck revocation, preserve three-call/30-second bounds and require provenance. Codex additionally spells out current actor authorization before each call, distinct chat-quota refunds versus provider cost, and permitted local-only admission.

Claude CP-19 says **no key means unavailable with no ai_query row**, despite its own local-fallback design and its incorporated source specification. Codex allows a useful consented local result and records sanitized failure/provenance without creating an empty successful answer. Resolve the no-key acceptance case explicitly; absence of an external key need not erase the local feature or failure audit. Neither plan may use fallback to evade safety, consent or spending limits.

### C03 — Professional exports: a product difference and an internal contradiction

Codex SPEC section 3 denies Professional and view_only financial/report export jobs while allowing their personal privacy export. Claude DECISIONS R2 and CP-03 explicitly grant Professional report/account CSV exports.

Either is a product policy choice if visibility remains enforced; calling exports a mutation does not settle whether the user should be allowed to export. However, Claude CP-04 then applies `requireRole("member")` to report exports while placing Professional below member. Its proposed capability exception is not explicitly wired to override that gate, and its acceptance rejects every Professional mutation. An agent could implement opposite outcomes from adjacent instructions.

For the common starting contract, retain Codex's narrower permission until the capability matrix is deliberately amended. Do not represent that as a separately expressed owner preference. Whichever policy is chosen must distinguish report export, account CSV, privacy export and recap generation, and include allowed as well as denied tests.

### C04 — Shared views and feature removal: retain the advertised capability

Claude removes Configure shared views and reinterprets it as a per-user Shared/Mine/All account filter. Codex implements named household saved views over already-authorized data, with owner/admin editing. Both remove fictional Premium claims.

These are not equivalent features. Under the current full-functionality brief, retain an actual configurable shared-view capability. Its exact schema/UI still needs a small implementation design; the named-filter interpretation is Codex's engineering choice, not a previously documented user data-sharing requirement. Do not introduce private-data sharing.

Claude also permits removing the rules Test control and lists several other controls as “fixed or removed.” Removal is reasonable for a misleading commercial claim or a genuinely duplicate UI element, but cannot silently close a required functional capability.

### C05 — GRZ principal: no income is agreed; no cash is not

Both preserve record-only acquisition. Claude CP-15 then requires cash and income to remain unchanged when a principal payment is marked paid, while crediting cash on a sale. Codex distinguishes acquisition from subsequent receipt: a confirmed principal receipt retires the holding and links or creates one asset-to-cash settlement, with principal excluded from ordinary income.

Keep the Codex settlement model. A record-only purchase does not establish that a later real receipt should disappear. Conversely, creating an instrument must not invent a purchase debit or a receipt. Acceptance needs cash, remaining holding, basis, gain, fees and net-worth checks, plus protection against importing the same receipt again.

Codex allows explicit settlement to another authorized compatible-currency account; Claude rejects any destination different from the instrument account. Prefer explicit authorized selection, unless a separately documented product constraint requires a fixed destination. This is an application-accounting contract, not a claim about current tax law.

### C06 — Tax and MFA numerical defaults: distinguish examples from real policy

Claude introduces a configurable 15% withholding default, a 5,000-household-currency step-up threshold and a 24-hour MFA reauthentication window. It does also require qualified tax confirmation before release. Codex retains current financial step-up until verified configuration and blocks real tax-labelled assumptions until qualified conventions are supplied.

Use the numbers as labelled synthetic fixtures or explicit proposals, not validated production policy. Codex also defines proof of factor possession before enabling MFA/recovery codes; Claude's lifecycle test does not clearly close the existing immediate-enable defect. Make that enrollment assertion mandatory.

### C07 — Privacy predicate: backfill corrected, two issues remain

Claude CP-04 proposes `(not transaction.private AND not account.private) OR transaction.owner = actor`. That shortcut does not separately establish the actor's right to the containing account when account and transaction owners differ. Its original bulk copy of account privacy into transaction flags was corrected during this review: step 4 now explicitly prohibits the backfill. **That correction is accepted and is no longer an open disagreement.** Step 3 still derives a new transaction's privacy from the account or explicit flag, which leaves the same provenance distinction unresolved for future writes.

Codex requires household membership AND capability AND account visibility AND transaction visibility, preserving the two privacy facts independently. Retain that model, express it as a tested shared predicate, and report ambiguous legacy ownership before backfilling. Include mismatched-owner fixtures and account-private/transaction-public fixtures, not just the usual same-owner case.

Current source confirms separate account ownership/privacy fields and an account-owner visibility check in `server/repositories/AccountRepository.ts`. This comparison identifies a specification risk; it did not reproduce a new exploit.

### C08 — Import duplicate identity: Claude's repair still merges valid purchases

Claude CP-10 adds normalized description to date/type/amount/account identity and tests different descriptions. Two genuine purchases can still have the same date, amount and description. A preview option alone does not establish a durable occurrence identity.

Retain Codex's source reference or batch fingerprint plus row ordinal/occurrence identity and mapping version. Exact replay is idempotent; overlapping new files get a reviewable candidate decision. Test **identical descriptions as well as identical amounts**, altered-payload replay, concurrency and paired-transfer overwrite.

### C09 — FX authority and legacy currency migration: two distinct differences

Claude CP-09 permits household members to write scoped overrides; Codex restricts that to owner/admin. Both prevent households writing global provider data. Retain an explicit capability decision, with Codex's narrower default; “household-scoped” alone is not the whole authorization policy.

Claude CP-08 backfills null transaction currency from the current account. Codex permits that only when denomination history is unambiguous. Because account currency was editable, current currency may not prove historical currency. Preserve the reconciliation report and reviewed exceptions before changing old financial records.

### C10 — Goals: hard ceiling versus deliberate overfunding

Claude bounds contributions by target plus tolerance and source balance. Codex separates contribution, account tracking, linked allocation and actual cash movement; it permits deliberate confirmed overfunding while rejecting invalid money and preserving exact reversal.

Prefer explicit source semantics. A target is a planning objective, not necessarily a hard monetary ceiling. Only enforce available cash when the operation actually transfers cash. Both need source identity, edit/delete reversal and concurrency tests; Codex's numerical maximum still needs a concrete boundary in implementation.

### C11 — Infrastructure: a valid tradeoff, not a proven defect

Claude chooses a single-instance Render persistent disk with an S3-compatible extension. Codex chooses S3-compatible durable object storage from the outset. Claude is potentially simpler for an explicitly single-instance launch; Codex makes shared file access less dependent on one web instance, at the cost of more setup and migration work.

Neither storage choice has been deployed or validated here. Select against actual instance count, deployment/restore requirements, availability and operator cost. Both must satisfy authenticated access, manifests/checksums, restart, backup and restore. Preserve Codex's no-blind-file-deletion migration safeguards. Claude's references to a driver “stub” versus two drivers also need a clear delivery boundary.

### C12 — Job and notification uncertainty: retain the stronger crash contract

Claude specifies durable run identity, heartbeat/reclaim and dedupe; Codex additionally requires fencing generations, checkpoints and a bounded catch-up policy. A reclaimed lease alone does not stop a former worker from committing late.

Claude notification states are queued/sent/failed/skipped; Codex includes unknown delivery outcome. Preserve unknown when a send might have succeeded but acknowledgment was lost. Do not automatically retry an ambiguous external send as if it definitely failed. Include stale-worker and lost-acknowledgment tests alongside Claude's clear per-channel retry examples.

### C13 — Receipt replay and history completeness: make response semantics explicit

Claude returns 409 for every repeated receipt-to-transaction request. Codex returns the existing result for an identical replay and 409 for a conflicting retry. Both prevent duplicate money; Codex better supports recovery after a lost response.

Claude requests computed net-worth history when snapshots are absent. Codex permits reconstruction only from sufficient historical evidence and otherwise labels the series incomplete/snapshot-only. Retain that qualification; current balance and today's prices cannot silently become historical facts.

### C14 — Release closure: all required behaviour, not only severity totals

Codex requires all 101 closure groups and all packets/journeys, or an evidence-based refutation. Claude CP-21's steps say every register row closed, but its acceptance and G5 require every P0/P1 row, with owner-accepted residual limitations elsewhere. That leaves an escape path for the P2/P3 tail despite the full-product brief.

Use an explicit `required_for_completion` flag separate from severity. Any true scope change must be recorded; lower severity or hiding a control does not close a promised function. Both should distinguish build verification, staging verification and deployment authorization.

## 3. Claude instructions that need correction before execution

These are narrower than the product decisions above. They can send an otherwise competent agent into a broken implementation or test.

| Instruction | Problem | Required correction |
|---|---|---|
| CP-00: 300 requests/minute; ten bursts of 40 with no 429 and at least 200 remaining | 400 requests cannot meet that expectation in one 300-request window. No window schedule is specified | Define clock/window boundaries and exact counting; test ordinary navigation separately from deliberate exhaustion |
| CP-02: resend-verification is single-use-token authenticated | Current `resendVerificationSchema` accepts an email address, not a token | Decide a narrowly scoped public resend policy with throttling/origin protections; do not justify its CSRF treatment by a token it does not receive |
| CP-02: verify with the token hash from the DB | `auth.email.service.ts` hashes the presented token before lookup | Capture the raw token from the synthetic SMTP message, or create a controlled raw/hash fixture pair; never send the stored hash as the raw token |
| CP-04: insert a `bogus` role directly into the DB fixture | `household_role` is a PostgreSQL enum | Exercise unknown-role rejection at a controlled boundary/repository seam; do not weaken the enum for a test |
| CP-01: fix a session-save race by deleting again after the response, or use revocation state | A second delete is not a defined barrier against arbitrarily late saves | Require durable revocation/generation enforcement and test delayed save after revocation; choose one complete mechanism |
| CP-16/G0 requires cron services for registered jobs; CP-13 depends on CP-16 | Deployment scaffolding can precede the registry, but end-to-end cron evidence cannot | Split environment foundation from operational acceptance, and label each dependency/gate accordingly |
| Plan graph vs CP table: CP-19 depends on CP-16 in the table, also CP-17 in one graph chain; CP-18 omits CP-13/16 although it needs scheduled delivery | Graph and packet preconditions are not one consistent dependency model | Publish one machine-readable DAG and generate the summaries; distinguish implementation start from closure dependencies |

The privacy formula, Professional export gate and no-key Thandi rule are additional implementation conflicts already detailed in section 2. These observations are source/document checks, not new runtime failures.

## 4. Detailed coverage that is easier to lose in Claude's package

Both retain all 62 original Codex IDs. The difference is coverage beneath the lead-level summaries. Codex maps the source-qualified domain findings and specifies these details; Claude's consolidated work orders do not clearly assign equivalent implementation and acceptance for all of them:

| Historical finding | Codex location | Claude consolidation gap |
|---|---|---|
| settings SET-04: omitted threshold becomes null; arbitrary notification type | SPEC section 4; NEW-26 | Generic settings persistence does not explicitly test partial-update preservation or enum validation |
| settings SEC-03: MFA enabled before proving possession | SPEC section 4; AH-11 | Enrollment/login test does not expressly require a pre-proof disabled state |
| settings REC-05: feedback claims recorded without a structured analytics contract | SPEC section 9; NEW-31 | Recap requirements do not explicitly deliver structured/queryable feedback persistence |
| settings NOT-01 and NOT-03: missing VAPID gives 500; alert counter counts deduped attempts | SPEC section 9; OPS-010 | Delivery/push fixes do not explicitly assert configuration state or actual-send counter semantics |
| settings NOT-02: quiet hours have no writer | SPEC section 9; OPS-010 | “Honor quiet hours” does not provide a configuration path. This is a broader Codex completion choice: the old report says it was not advertised in the UI |
| goals GOAL-03 and GOAL-04: invalid default partial assignment; 30-day month projection/completed remaining time | SPEC section 6; FIN-09 and NEW-15 | Generic allocation/date work does not expressly close these cases |
| Preset create/delete and individual correction/delete controls | SPEC section 11; R11/R18 | Default-preset application and removal of inert controls do not by themselves deliver the missing actions |

These are bounded coverage examples, not a claim that every uncited item is absent. Some generic Claude packets could absorb them, but “an agent might infer it” is weaker than an explicit closure contract. The source IDs collide between domain reports, so identify them by report as well as ID.

## 5. Where Claude is better, and what my package should improve

1. **More compact per-work-order presentation.** Claude's goal, where, steps, data, tests, acceptance, runtime evidence and rollback structure is easier to hand to one agent. Codex makes the reader coordinate a global spec, long plan, CSV and acceptance table. Keep the stronger contracts but generate a short packet card containing the relevant decisions, files, commands and gates.
2. **More concrete historical regression examples.** Claude names the report, budget and investment fixtures and hand-calculated expected results from its deeper runtime work. Preserve those alongside Codex's smaller self-contained golden fixture. First make the synthetic fixture generators portable: Claude currently relies heavily on ignored `.local` scripts that another machine/worktree will not have.
3. **Explicit working-feature preservation.** Claude REGISTER section 4 lists paths that worked, including creation/transfer arithmetic, concurrency examples and fiscal behaviour. Carry these as regression obligations, with exact historical scope. Its broad README statement that the “ledger core is sound” should be narrowed because the same package documents broken overwrite, liability and mutation paths.
4. **Clearer staffing and operational planning.** Claude provides lanes, shared hot files, risk register and calendar examples. Adapt them to confirmed staffing and measured throughput. Codex should add a similarly concise delivery dashboard without turning assumptions into commitments.
5. **More explicit MFA, rate and performance proposals.** Concrete proposals are useful for discussion. Codex avoids inventing critical thresholds, but should still supply implementable configuration contracts, boundary tests and a designated decision owner. Claude's proposed values are not automatically correct defaults.
6. **My scope and estimates also need discipline.** Named shared views, upfront object storage and quiet-hours configuration are design choices with cost. Quiet-hours UI extends an existing backend capability that the historical audit says was not advertised. Codex should label that distinction plainly. Keep full functionality, but do not describe every chosen enhancement as a reproduced blocker.
7. **My test design is not finished code.** The 66 slices and proposed test paths are useful organization, not 66 runnable instructions or passing tests. Each packet still needs a targeted red test and concrete migration/index/API design at the implementation SHA. Claude's greater line-level detail does not remove the same need.
8. **My privacy-export exception needs clear wording.** Denying financial export jobs to Professional/view_only while allowing an archive of their visible data must be described as a capability/workflow distinction, not a claim that those users cannot obtain a data copy. Apply download reauthorization and file limits consistently.

Both packages should be versioned before handoff. They are currently untracked; a new checkout will not automatically contain them. Codex warns about this explicitly; Claude's branch-from-origin instructions need the same protection. Neither package's self-declared authority should override a later owner-approved combined version.

### Response to Claude's newly added comparison

Claude's latest comparison independently recommends using Codex's governing specification, Thandi persistence contract, CSV/status model, agent handoff, early R20 harness and Golden fixture A, supplemented with its detailed work orders. I agree with that direction. Its narrower list of five substantive differences does not resolve the credit, principal cash, duplicate-identity and authorization conflicts identified here.

- **Scheduler priority: accept the criticism.** Codex OPS-003 is P1; Claude calls it P0. Deployed automatic processing is a release blocker for the advertised product. Mark it explicitly release-blocking/P0 in a future revision while preserving the distinction between missing declared deployment wiring and unverified infrastructure elsewhere. The present Codex counts remain 17/72/12 because this comparison did not edit the register.
- **R04 file starting points: accept in part.** Codex already lists `goals.controller.ts` and `TagRepository.ts`, contrary to any implication that only helper files are listed. But its packet should also directly name `goals.extra.controller.ts`, `TransactionGoalLinkService.ts` and `RecurringRepository.ts` rather than relying on following delegates or reading source evidence. Claude's reproduced call-site references improve the handoff.
- **R17 tracking: improve granularity, but the scope is present.** Claude says Codex's register contains CHG-AI-01; it does not. That identifier belongs to Claude's register. Codex groups the full provider/consent/idempotency/budget work under OPS-012, the three R17 slices and THANDI_SPEC. Add explicit sub-requirement IDs or a completion checklist so this large group cannot be partially closed, rather than calling the functionality absent.
- **Phone layout is included in Codex.** R18, UX-02 and J16 explicitly cover small screens, 320px, 200% zoom and device checks. Claude's additional viewport list is useful specificity, not a feature missing from Codex.
- **Defaults remain proposals.** Adopting Claude's defaults as clearly labelled synthetic or pending configuration is reasonable; it must not permit a zero Claude price, unverified tax output or a weaker security policy to become the production default implicitly.
- **The packet mapping is many-to-many in places.** Claude's final wording says R and CP IDs map one-to-one, but budgets/goals and harness/acceptance are split differently. Use the responsibility crosswalk below; do not paste work orders based on matching numbers.

## 6. Packet correspondence

This maps responsibility, not interchangeable implementation authorization. CP-19 does not mean R19.

| Domain | Codex | Claude/Fable |
|---|---|---|
| Runtime/dependencies/rates | R00 | CP-00 |
| Session/credentials | R01 | CP-01 |
| Verification/recovery | R02 | CP-02 |
| Household/roles | R03 | CP-03 |
| Privacy/capabilities | R04 | CP-04 |
| Settings/shared views | R05 | CP-05 plus CP-03/14/20; shared-view scope differs |
| MFA | R06 | CP-06 |
| Export/erasure | R07 | CP-07 |
| Ledger | R08 | CP-08 plus liability work in CP-09 |
| Imports/exports | R09 | CP-10 |
| Budgets/goals | R10 | CP-11 and CP-12 |
| Organization/rules | R11 | CP-14 |
| FX/reports | R12 | CP-09 |
| Investments/GRZ/pension | R13 | CP-15 |
| Recurring/jobs | R14 | CP-13 |
| Receipts | R15 | CP-17 |
| Notifications/recap/push | R16 | CP-18 |
| Thandi | R17 | CP-19 |
| UX/accessibility | R18 | CP-20 |
| Deployment/storage/recovery | R19 | CP-16 plus CP-21 drills |
| Harness/evidence foundations | R20 | CP-00 and CP-21 |
| Integrated acceptance/release | R21 | CP-21 |

Codex separates trustworthy harness work from final acceptance and combines budgets/goals. Claude separates budgets/goals and places more harness rewrite effort in final acceptance. Compare R20+R21 (8–13 days) with Claude CP-21 (8–12 days) plus CP-00's harness portion, not R21 alone. Similarly, compare combined responsibility before calling one AI, UI or investments estimate more efficient.

## 7. Recommended reconciliation sequence

1. Publish one explicit precedence/version statement; retain both historic packages as sources. Do not let different agents choose different versions by filename.
2. Correct C01 spending, C05 settlements, C07 privacy, C08 import identity and the execution defects in section 3 before application implementation.
3. Record the remaining product/design defaults together: Professional exports, named shared views, goal overfunding, FX-write capability, storage topology and receipt replay. Use the recommendations above as the proposed baseline; do not reopen the already-settled Claude/Gemini order or full-app objective.
4. Retain stable closure IDs and source-qualified evidence; incorporate missing detailed cases and Claude's positive regression checks. Generate counts and severity totals from explicit fields.
5. Generate concise packet cards with one dependency model and portable synthetic fixtures, incorporating Claude's useful work-order and risk detail.
6. Reforecast once that exact scope, staffing and environment are fixed, then after the first two gates. Do not add or average the two estimates: they describe largely overlapping work.

Actual external inputs still remain: hosting and deployment access, provider/model/pricing and numerical caps, qualified tax conventions, retention/privacy policy, named delivery/review/operations owners and eventual production authorization. Neither report can establish these facts on the owner's behalf.

## 8. Verification of this comparison

- Recomputed both 22-packet estimate sums and Codex's 101-row priority distribution.
- Counted Claude's OPEN register rows by section and checked that all original 62 Codex IDs occur in its register.
- Checked selected disputed instructions against current source: resend schema, verification token hashing, role enum and account-owner visibility.
- Consulted domain source findings for the detailed coverage examples; did not relabel historical evidence as fresh runtime proof.
- This session did not change either source package or any application file. A source-hash check detected the concurrent Claude updates described above; their changed content was re-read before finalizing. No application tests or runtime readiness checks were performed. Only this comparison report was added by this session.

## 9. Verification of Claude's response

Follow-up, 15 October 2026. Read [RESPONSE-TO-CODEX-COMPARISON](2026-10-15-consolidated-completion-fable/RESPONSE-TO-CODEX-COMPARISON.md) and checked the current decision, work-order, register, acceptance and plan files. This section supersedes the earlier open/closed disposition where explicitly stated. This is document verification, not application remediation or runtime proof.

### Corrections verified in the work orders

The principal policy choices now substantially align:

- Both provider legs reserve and settle at dated prices; Claude credits are no longer treated as a zero price in R1/CP-19.
- CP-19 now permits audited local mode for consented requests with no external key.
- Professional financial/report export jobs are denied, with the personal privacy-export exception retained.
- Named shared views are implemented under CP-05; account filtering is no longer their replacement.
- CP-15 now describes principal as an asset-to-cash settlement rather than suppressing cash receipts.
- CP-04 requires independent membership, account and transaction visibility, with neither create-time derivation nor privacy backfill.
- Import rows use batch fingerprint/mapping version and ordinal; cross-file candidates require review.
- Household FX overrides are owner/admin-only; currency backfill requires unambiguous denomination history.
- Goal overfunding is confirmed rather than forbidden solely by the target; available cash applies when cash moves.
- Jobs include fencing; delivery includes unknown outcomes; identical receipt replay returns the existing result in CP-17.
- CP-21 acceptance now requires every register row, regardless of severity.
- The limiter example is arithmetically coherent; raw mail tokens, the unknown-role test seam and the narrower resend treatment replace the erroneous instructions. MFA enrollment now requires possession proof. Dependency wording has improved.

Seven additional grouped rows are present in REGISTER section 2.12a. These include several source IDs per row; seven rows is not a claim of seven distinct original findings.

**Conclusion: the major design disagreements have largely converged.** The remaining work is a bounded reconciliation and consistency pass, not another full readiness assessment. However, “only presentation differences remain” is premature for the exact files an implementation agent would read.

### Remaining corrections before copying work orders into the final package

| Item | Verified remaining issue | Required final disposition |
|---|---|---|
| Register count | The response says Codex counted IDs and section 2 has 55 rows. The actual count is **109 OPEN table rows** in section 2, plus 12 in section 1. The earlier count was 102 table rows; seven were subsequently added | Correct the response/README/count table. Generate severity totals from explicit per-row fields and deduplicate closure identities separately. Neither 109 nor 121 is a claim of unique bugs |
| Old pricing rule | DECISIONS DEC-11c still says Claude's price table becomes non-zero when the free allowance ends; the risk table and CP-19 introduction also retain free-allowance wording | Prices already apply during credit use. Expiry/exhaustion changes the available balance or authorization, not token price from zero. Remove contradictory instructions |
| Receipt acceptance | CP-17 returns the existing result on an identical replay, but ACCEPTANCE_CATALOGUE J13 still requires replayed create-transaction to return409 | Same request/fingerprint returns the same result; conflicting retry409. Update both the work-order and end-to-end test contract |
| Release gate | CP-21 and README now require every row; REMEDIATION_PLAN G5 still says every P0/P1 row | State all required-for-completion rows consistently in every gate and tracker |
| Targeted revocation | CP-01 proposes a per-user session generation for single-session revoke as well as revoke-all, while still saying `Data: none new` | Specify per-session durable revocation for one-device removal, and user-wide generation for revoke-all/password reset. Otherwise one-device removal may revoke unrelated sessions. Test the surviving cookie and declare any schema/session-payload migration |
| Settlement oracle | CP-15 now says principal always leaves net worth unchanged and removes face value from the holding | That oracle requires the pre-settlement carrying value to equal face. Preserve the Codex distinction between carrying value, cost basis and proceeds, explain any valuation difference, and link an existing imported receipt rather than crediting cash twice |
| Credit ceiling | CP-19 records available Claude credits as a provider ceiling | Specify balance as-of time, expiry, reservations, reconciliation and consumption outside this app. It is an additional funding constraint, not authority to spend all credits or a substitute for app/household/user/provider caps |
| Proposed numeric defaults | The response says all defaults are proposals, but DEC-08 still says default15% with a pending label, and DEC-13 still prescribes the24-hour policy | Put the synthetic-only/unconfirmed-policy restriction in the governing contract and release gate, not only the response letter. Retain existing verified security policy until an authorized replacement is configured |
| Estimate arithmetic | The22 work orders sum correctly to87–140 days;20% gives104.4–168 | If rounding up to whole days, report105–168. The agreed planning envelope can remain Codex106–174; this is a small rounding correction, not a new estimate |

Storage topology remains a legitimate design choice, and labelled calendar projections are useful. DEC-06 still describes a persistent-disk default with an S3 seam; do not mistake the response's statement that both options are possible for an implemented or validated storage decision.

The session-revocation and settlement notes above are requirements to tighten proposed contracts. They are not new runtime findings. The global Codex contract already provides the relevant preservation constraints; copied work-order details must not weaken them.

### Reproducible row count

Count one Markdown data line ending in `| OPEN |` as one row, independent of the number of source IDs in its cells. Section 2 subtotal by subsection:

| Subsection | OPEN rows |
|---|---:|
| 2.1 Identity |9|
| 2.2 Household/roles |10|
| 2.3 Settings/MFA/data rights |9|
| 2.4 Ledger/currency |15|
| 2.5 Imports/receipts |8|
| 2.6 Budgets/goals/recurring |10|
| 2.7 Organization/rules |10|
| 2.8 Investments/GRZ |10|
| 2.9 Operations/platform |10|
| 2.10 Notifications/AI |6|
| 2.11 UX |2|
| 2.12a New explicit verifier groups |7|
| 2.12 Verification system |3|
| **Section 2 total** |**109**|

This includes repeated source IDs and grouped/variant closure requirements. A unique-defect or severity count requires normalization; neither can be inferred by counting raw source IDs or using the section heading alone.

### Handoff status

Retain the recommended combination: Codex governing contracts, Thandi persistence model, normalized tracking and agent handoff, plus Claude's corrected work-order detail and portable historical fixtures. Resolve the table above while integrating; do not keep cycling through full assessments. Preserve the many-to-many packet mapping, promote the scheduler's release-blocking priority and improve R04/R17 tracking as already accepted. No application changes, provider calls, implementation approval or release clearance are implied by this follow-up.
