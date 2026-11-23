# Thandi completion contract: Claude primary, Gemini fallback

Version 1.0, consolidated 15 October 2026. Governs remediation packet R17. Provider order is an explicit owner decision, not a pending choice. Documentation only; no provider integration, secret configuration or paid calls have been performed by this consolidation.

This adopts the 14 October consent and shared-spending corrections in full. Historical findings remain evidence at revision381e9439afabe7c6cf829cb1cbded91d36da44ee. Model IDs, availability and prices must be verified against official provider documentation during implementation; links below are references, not fresh verification in this task.

## Required provider order

1. **Anthropic Claude is the primary provider** for understanding questions/tool selection and generating explanations.
2. **Google Gemini is the fallback provider** for eligible Claude failures, subject to consent, authorization, time and spending budgets.
3. **Existing local keyword/template fallback is the final degraded mode** if neither external provider can serve the request. It must be clearly identified as limited functionality; it is not a successful Claude/Gemini answer.

Use the direct Anthropic API so the owner's API account can fund Claude requests. Gemini uses its own Google credentials and quota/billing; Claude credits do not fund Google requests. Do not add a routing intermediary or obtain new subscriptions. Do not ask for a key in chat: implementation uses server-side environment/secrets configuration.

Recommended model class: a supported **Claude Sonnet** model for the first evaluation, with the exact ID configurable and validated against the owner's account at implementation time. Gemini's exact supported model must also be configurable. Do not carry forward the hardcoded `gemini-2.0-flash`, or silently choose a more expensive Claude model. Model selection is finalized with the same financial/privacy evaluation suite and measured latency/cost, rather than family name alone. Current IDs/capabilities must be rechecked against the [official Claude model catalogue](https://platform.claude.com/docs/en/models/overview) and [Gemini lifecycle documentation](https://ai.google.dev/gemini-api/docs/deprecations).

## Current source and intended changes

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
- `server/modules/ai/ai.providers.ts`: provider registry/order, failure classification, time/spend budget and circuit state.
- Existing `ai.gemini.ts`: Gemini adapter conforming to the shared contract; configurable supported model.
- Existing service/controller/types/guardrails/tracking/cache/conversation modules: routing integration and truthful provenance/status with existing scope protections.
- Existing client `features/ai` contracts, consent/status/response components: disclose failover and local degradation without exposing secrets or raw provider errors.
- `.env.example`, environment validation, deployment configuration and operator docs: variable names and setup requirements only; no real keys.
- Existing consent draft and AI evaluation/test suites: both-processor disclosure, re-consent and complete failover matrix.

Follow repository file-size ratchets: extract cohesive pieces rather than grow the already oversized service/Gemini files. Reuse existing analytics and safety layers; do not replace them with autonomous model execution.

## Stage and response contract

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

## Failure and budget policy

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

### Shared admission, reservation and reconciliation

Quota and spend enforcement must use a **durable shared ledger with atomic admission across all application instances**, not process-local counters or separate read-then-write checks. PostgreSQL transactions/conditional updates with a consistent lock order are the proposed mechanism; an expiring cache lock is not sufficient financial-budget authority.

- Bind the logical request/idempotency key to the authenticated actor, household and request fingerprint. An identical replay reuses the same admission/outcome; a different payload or actor cannot reuse it. Reserve the request's single chat-quota unit atomically with initial financial admission. Define failed-request quota refunds explicitly and apply them at most once.
- Before each paid call, atomically reserve its conservative maximum cost against **every applicable app, household, user and provider budget** for the relevant period. Count settled usage plus all outstanding reservations, including uncertain attempts. Permit the call only if every ceiling has capacity. Prices and output/context limits must bound all billable token classes for that configured model; if a conservative bound cannot be established, reject paid admission rather than assume zero cost.
- Claim each provider/stage attempt once in the shared ledger before dispatch, under its parent request. Concurrent workers must not dispatch the same admitted attempt independently. A denied reservation or failed ledger operation causes no outbound call. Do not hold a database transaction open across a network request.
- On known usage, reconcile the attempt idempotently: replace its reservation with actual cost and release only confirmed unused capacity. Duplicate completion, timeout or cancellation events must not refund twice, charge twice in the app ledger, or release another attempt's funds. Record and alert on actual usage exceeding the reserved estimate; do not truncate usage to hide an overrun.
- On timeout, connection loss, cancellation or crash after possible dispatch, mark the attempt **usage unknown** and retain its conservative reservation. Lease expiry, process restart and a period boundary do not turn uncertain usage into free capacity. Release or settle it only through an auditable provider-usage reconciliation or explicit operator resolution under the agreed accounting policy. Original-period liabilities remain visible; do not re-date them to erase a limit breach.
- Gemini fallback requires its **own atomic reservation** while any uncertain Claude cost remains reserved. If the remaining shared budget cannot cover both, do not make the Gemini call; return the permitted local result or a clear limit outcome. Provider-credit failover still follows the separate billing/cap policy above.

These rules bound application admission and prevent concurrency/replay from bypassing configured budgets. They do not promise exactly-once provider billing or an exact provider invoice ceiling when usage/pricing is uncertain. The operator must configure numerical limits, budget timezone/reset policy, price versions, alert thresholds and unknown-usage resolution before paid enablement; no unlimited default is acceptable.

Circuit breaking uses bounded failure thresholds/cooldowns and a controlled recovery attempt, scoped to provider/model/configuration and coordinated across instances where applicable. Claude returns to primary after a successful recovery check; no permanent silent switch to Gemini. Cancelled requests and client/consent errors do not poison provider health.

## Configuration contract

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

## Consent and user experience

Adding Anthropic changes the set of external processors. Version the AI consent policy and require existing households to accept the new provider disclosure before their next external AI request. Server-side enforcement must recheck consent/version before each new outbound attempt; revocation cancels queued/in-flight work where feasible and prevents additional fallback/history transmission. It cannot retract data already transmitted.

**Consent authority is household owner/admin only**, consistent with the existing admin-gated `POST /api/ai/consent` route. Owners and admins can grant, renew or revoke household AI consent. Members, view-only users and Professional users must not be offered a working household consent toggle or gain that permission through a crafted request. Their chat access remains governed by the approved role/visibility policy plus current household consent; being able to ask a question does not grant consent-management rights.

Use role-aware controls and copy: owners/admins see the actionable enable/re-consent/disable controls; other roles see consent status and “Ask a household owner or administrator to enable or disable AI processing.” An outdated disclosure blocks all external AI calls until an authorized owner/admin renews consent. No personal opt-out control is promised or introduced by this change. A future personal opt-out would require its own persisted preference, server-side outbound checks and tests.

Proposed concise disclosure (draft for product/privacy review):

> Thandi normally uses Anthropic Claude to answer your financial questions. If Claude is unavailable, Google Gemini may process the request instead. Your question, selected recent conversation messages and the financial summaries needed to answer may be sent to the provider used. Questions you type can contain personal information. A household owner or administrator can disable household AI processing in Settings.

Add the actual retention, access/deletion and applicable provider terms once verified; do not promise that all personal identifiers in typed messages are removed. Both providers receive only authorized minimized context; provider change does not justify extra data access.

Ordinary users keep one Thandi chat. A response can show “Answered using Claude”, “Answered using Gemini — backup provider”, or “Limited local summary”. On the status surface distinguish primary unavailable/fallback operating from complete outage. Technical failures and billing details go to the operator with sanitized diagnostics, not raw exceptions in a household's chat.

Audit metadata includes logical request ID, ordered provider/stage attempts, configured model, start/end/outcome/failure category, external request ID when available, known/unknown usage, consent version, whether transmission was attempted, final answer mode and data provenance. Retain failed Claude attempts even when Gemini answered; never use `used_gemini=true` for a Claude answer. Log safe metadata, not keys or expanded raw financial prompts. Existing historical rows remain valid historical evidence; use additive schema/DTO compatibility where needed.

Tool cache remains scoped to authorized user/viewer/household, arguments and data generation. Do not cache a degraded answer as a fresh primary-provider answer. If answer caching is later added, include provider/model/prompt/consent versions and actual response provenance; never allow failover to cross user or household context.

## Acceptance tests and release evidence

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

## Delivery and estimate

R17 is estimated at 5–8 focused developer-days within the consolidated 88–145-day plan, including durable admission schema, role-aware consent, adapters and controlled integration evidence. No second AI project is added. This replaces historical P16 sizing for planning only.

Implement canonical contracts and transport mocks -> durable request/attempt/reservation repository -> Claude/Gemini adapters -> orchestration and cancellation -> consent/provenance/UI -> evaluation and authorized staging smoke. R04 visibility, R05 settings, R12 financial truth and R19 environment/observability foundations are completion dependencies.

## Concrete persistence contract (new design, not existing tables)

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

## Resolved app quota, local mode and audit policy

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

## Required new/modified file map

Existing: server/modules/ai/ai.service.ts, ai.gemini.ts, ai.fallback.ts, ai.controller.ts, ai.tracking.ts, ai.types.ts, ai.validation.ts, ai.conversation.repository.ts and client AI components.

Proposed new files:
- server/modules/ai/ai.provider.types.ts — canonical contracts.
- server/modules/ai/ai.claude.ts — direct Anthropic adapter.
- server/modules/ai/ai.provider-orchestrator.ts — bounded stage transitions.
- server/modules/ai/ai.admission.repository.ts — durable atomic budgets/claims.
- server/modules/ai/__tests__/completion-r17.realdb.integration.test.ts — cross-instance/replay/role/unknown-charge tests.
- Versioned Drizzle migration generated at implementation time; do not guess the next migration number.

Preserve or adapt existing tests for consent, sanitizer, history persistence, quota, provider fallback and evaluation. Do not infer conversation persistence is missing from stale CLAUDE.md comments: inspect current ai.conversation.repository.ts and its real-DB tests first, then repair only demonstrated gaps.

## Evaluation and evidence

Ordinary CI uses deterministic transports and a synthetic evaluation set covering financial interpretation, authorized tool selection, refusal, missing data and failure modes. It must not accidentally call paid APIs. OI-02 supplies keys/model IDs/caps and an explicit small budget before separate controlled staging smoke.

Record three independent scenarios: Claude success; forced eligible Claude transport failure followed by Gemini success; both external providers failing with an honest local result or unavailable state. Assert analysis and answer provider separately, maximum 3 paid calls, no hidden SDK retry, same-request replay, cancellation/late result, policy revocation between stages, quota race and retained unknown cost. Never use used_gemini=true as the sole success oracle for the new product.
