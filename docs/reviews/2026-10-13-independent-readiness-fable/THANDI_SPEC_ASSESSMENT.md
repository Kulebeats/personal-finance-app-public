# Assessment of the Thandi provider specification (CHG-AI-01)

Assessed 15 October 2026 against `docs/reviews/2026-10-11-deep-readiness/THANDI_PROVIDER_SPEC.md` (revision of 14 October) and the AI module at `main` @ `381e943`. Context supplied by the owner: Claude API access is free for this project, and the 11 October team has been asked to update its plan on that basis. This file assesses the specification as written, checks its claims about the code, and recommends how the free-Claude situation should change it. No application code, dependency or configuration was changed.

## 1. Verdict on the specification

The specification is sound where it matters most and over-built in one place.

Sound: the provider order with a clearly labelled local degraded mode; the rule that the application owns tool execution, permissions and arithmetic and that model tool calls are proposals; the failure taxonomy that forbids using a second provider to evade a consent, authorisation, validation or safety outcome; one persisted exchange and one quota charge per logical request; honest per-provider provenance in the audit row; consent re-versioning when the processor set changes; owner/admin-only consent authority; bounded calls and a real deadline with cancellation; no parallel providers; configuration never equals health.

Over-built: the shared admission, reservation and reconciliation ledger. It specifies a payments-grade accounting system (atomic Postgres reservations of a conservative maximum cost per paid call across app, household, user and provider ceilings; unknown-usage liabilities retained across restarts and period boundaries; operator reconciliation; dated price versions; decimal cost arithmetic) for an assistant whose primary provider the owner now gets at no charge and whose daily use is already capped at 50 requests per household. That ledger is the largest single driver of the 4–7 day estimate and of the operating burden the spec itself lists as prerequisites ("numerical limits, budget timezone/reset policy, price versions, alert thresholds and unknown-usage resolution before paid enablement").

Recommendation in one line: keep every safety, provenance and consent rule; ship Claude as the single external provider with the local degraded mode behind it; keep the provider abstraction so Gemini can be added later; replace the money ledger with request and token quotas until a paid provider is actually enabled.

## 2. What free Claude access changes

| Spec assumption | With free Claude access | Consequence |
|---|---|---|
| Claude calls cost money that must be reserved before dispatch | Claude calls cost nothing to the owner; the constraint is the allowance's rate and volume limits and its possible expiry | Replace cost reservations with simple counters: requests per household per day (exists), tokens per household per day and per app per day (new, Redis with Postgres fallback), and an operator alert on provider 429/529 responses. Decimal pricing and unknown-cost liabilities are not needed until a paid provider is enabled |
| Gemini is the fallback because Claude is the paid, scarce resource | Gemini is now the only provider that can cost money, and the 20 July live test found this project's Google key had a free-tier allowance of zero | Gemini fallback becomes availability insurance with a bill, a second processor in the privacy disclosure, a second adapter and a doubled failover test matrix. Defer it: ship Claude plus local degraded mode, keep the adapter seam, and decide on Gemini after staging shows Claude's real availability |
| Model: a Sonnet-class model, exact id configurable | Unchanged, but the choice should be driven by latency and tool-call accuracy rather than price | Start with the current Sonnet-class model the allowance permits; evaluate the current Haiku-class model on the same evaluation set for latency; keep `ANTHROPIC_MODEL` configurable and validated at startup |
| Owner must verify key, model access and balance before enablement | Owner must verify the allowance's limits (requests per minute, tokens per day, expiry) and any usage terms that apply to free access | Record those limits as the numeric quotas; add a dated note in DECISIONS.md |

What does not change: the consent policy still has to be re-versioned, because the processor changes from Google to Anthropic even if Gemini is dropped; the current code only reports an outdated consent version and does not block on it (see §3), so that is real work regardless.

## 3. Claims in the specification checked against the code

| Spec claim | Checked | Result |
|---|---|---|
| `ai.gemini.ts` hardcodes the model | `ai.gemini.ts:27` `GEMINI_MODEL = "gemini-2.0-flash"` | Confirmed. Also hardcoded: `REQUEST_TIMEOUT_MS = 10000`, the 12 tool definitions in Gemini `FunctionDeclaration` shape, and the system prompt (`AI_SYSTEM_PROMPT_TEMPLATE`, version v1.1.0) all live in the Gemini file (735 lines) |
| Timeout is a non-cancelling promise race | `ai.gemini.ts:688-700` `Promise.race` with `setTimeout` | Confirmed. The provider request continues after the timeout fires; no abort signal is passed |
| Service calls Gemini directly in two stages | `ai.service.ts:204` `isAvailable()`, `:217` `analyzeQuery`, `:272` `generateResponse` | Confirmed. The orchestration has exactly three provider touch points, so an adapter swap is a contained change |
| Status degrades only when unconfigured | `ai.controller.ts:98` `degraded: !geminiClient.isAvailable()` | Confirmed |
| Provenance fields exist but are Gemini-named | `ai.service.ts:385-390` `used_gemini`, `provider_attempted`, `provider_error` | Confirmed. These three fields were introduced on 20 July and are honest for a single provider; they need a provider name and a per-stage record |
| Fallback distinguishes provider errors from application errors | `ai.fallback.ts:41-45` allow-list of two error codes | Confirmed. Any new adapter must normalise into the same codes or extend the allow-list deliberately |
| Consent version is enforced | `ai.controller.ts:30` `CURRENT_CONSENT_VERSION = 'v1.0'`; `ai.middleware.ts:254` checks only `aiConsentGiven` | Not enforced. The controller reports `needsReconsent` but the middleware lets an outdated consent through. The spec's "outdated disclosure blocks all external AI calls" is new work |
| Consent authority is admin-gated | `ai.routes.ts:64` `requireRole('admin')`; `ConsentGate.tsx:20-33` role-aware copy | Confirmed on both sides. Note the WP-01 finding that `requireRole` passes an unknown role such as `professional`; the consent route inherits that until WP-01 lands |
| Conversation endpoints are stubs | `ai.conversation.service.ts` has `recordExchange`, `list`, `get`, `delete`; routes at `ai.routes.ts:74-88`; tables `ai_conversations` and messages in `shared/schema.ts:3252` | Stale. Conversations are persisted today. CLAUDE.md Rule 4 item 4 and the Fable WP-19 text that repeated it are corrected in this revision |
| Per-household quota in Redis | `ai.middleware.ts:60-110` 50 per household per 24 h via `redisIncrementWithTtl`, in-memory fallback | Confirmed. It is charged before the provider call, which the spec wants kept (one charge per logical request) |
| Usage telemetry | `ai.tracking.ts` events carry `token_count` only | Confirmed. No per-provider usage, no input/output split, no unknown-usage state |
| An evaluation suite exists | `ai.eval-pack.ts:52` `runAIEvalPack` is six static checks on the prompt text and tool catalogue | There is no prompt-and-expected-tool-call evaluation set. The spec's "same financial/privacy evaluation suite" has to be written |
| No idempotency key on chat | `ai.controller.ts`, `ai.service.ts` contain no idempotency or request-fingerprint handling | Confirmed. A network replay today charges quota twice and can persist two exchanges |
| Anthropic SDK present | `package.json` lists `@google/generative-ai` only | Not installed; `ANTHROPIC_*` variables absent from `validateEnv.ts` and `.env.example` |

## 4. Gaps and risks in the specification

1. The ledger is disproportionate (§1). It also couples the first release to operator work (price tables, budget timezones, reconciliation procedures) that has no owner today.
2. Two external processors double the consent, adapter and failover surface for a benefit that is unmeasured. The spec never asks whether Claude's availability warrants a paid second provider; it assumes the order from the owner's original preference, which pre-dated free access.
3. The consent block on an outdated version is specified but the code path (middleware) is not named; it must be the middleware, not the client, or the block is cosmetic.
4. The spec requires a request fingerprint and idempotency identity but the chat endpoint has no request id today; that is a schema or cache change (idempotency key column on the exchange, or a short-lived Redis claim) and should be named as such.
5. Tool definitions are expressed in Gemini's schema type. The Anthropic tools API takes JSON Schema; the spec's "shared canonical tool contract" means rewriting the 12 definitions once in JSON Schema and generating the Gemini shape from them, which is the right direction but is half a day the estimate should name.
6. The evaluation suite does not exist. The spec's model-selection rule ("finalised with the same evaluation suite") therefore has no instrument; WP-19 must include writing a 20 to 30 prompt set with expected tool calls and golden amounts from a fixed fixture, run against a recorded provider in CI and against the live provider only in the controlled staging smoke.
7. Data retention and processor terms for Anthropic are deferred to "once verified". Do that verification before the disclosure text is final; the current default retention and any zero-retention option should be stated in the consent copy, not promised vaguely.
8. The spec is silent on CI: tests must never reach a provider. State that the Claude adapter is exercised only through a transport stub and recorded responses in CI, and that the staging smoke is the only live call path.
9. Streaming is correctly deferred, but the client already renders one reply at a time, so nothing in the UI blocks a later streaming contract.
10. The spec's SDK-retry rule is right and easy to miss: the Anthropic SDK retries some failures by default; set its retry count to zero explicitly so the application's own single-attempt bound is the only retry policy.

## 5. Recommended shape (replaces the single P16 / WP-19 packet)

Phase A, required for the full product: 3–5 days.
- Provider-neutral contracts (`ai.provider.types.ts`): request, bounded history, tool definitions in JSON Schema, tool-call proposals, response, usage, typed failure categories.
- Claude adapter on the official SDK: configured model, `max_tokens` bound from the remaining request budget, tool definitions, text and tool-use block handling, usage captured per call, abort signal from a request-level deadline, SDK retries set to zero, errors mapped to the typed categories.
- Gemini adapter reduced to conform to the contract behind the same seam, disabled by default (`AI_FALLBACK_PROVIDER` unset).
- Orchestrator: Claude for analysis and explanation, local degraded mode on an eligible provider failure, application errors propagated unchanged, one persisted exchange and one quota charge per logical request, idempotency claim keyed on actor, household and message fingerprint.
- Quotas: existing 50 requests per household per day; new per-household and per-app daily token counters with operator alert thresholds; provider 429/529 recorded and surfaced on the status endpoint as "primary unavailable" distinct from "unconfigured".
- Consent: version bumped to name Anthropic; middleware blocks external calls on an outdated version; owner/admin re-consent flow; disclosure text with verified retention terms.
- Provenance: audit row and message DTO carry `provider`, `model`, `stage outcomes`, `answer_mode` (provider, degraded, unavailable); `used_gemini` kept for historical rows and never set for a Claude answer; client label "Answered using Claude" or "Limited local summary".
- Evaluation: 20 to 30 prompts with expected tool calls and golden amounts against a fixed fixture; recorded-provider run in CI; live run only in the staging smoke with a documented request budget.
- Status endpoint: configured, healthy (last successful call within N minutes), degraded, quota remaining.

Phase B, only if staging shows a need or a paid provider is enabled: 2–4 days.
- Gemini failover per the spec's stage rules and failure categories, with its own consent disclosure.
- The spend ledger from the spec, scoped to the paid provider only.
- Circuit breaker with coordinated recovery across instances.

Net effect on the plan: WP-19 becomes 3–5 days (Phase A) instead of 4–7, and the Fable total moves from 70.5–107.5 to 69.5–105.5 developer-days. Phase B is listed as an owner-triggered option, not scheduled.

## 6. Owner decisions this creates or changes

| ID | Decision | Recommendation |
|---|---|---|
| DEC-11 | Provider policy | Claude only plus local degraded mode for the full-product release (Phase A); Gemini failover deferred to Phase B on evidence |
| DEC-11b | Free-allowance facts | Record the allowance's rate and daily limits and its expiry or review date; set the token quotas from them; name who is alerted when they are hit |
| DEC-11c | Model | Current Sonnet-class model first; evaluate the Haiku-class model on the evaluation set for latency; exact id in `ANTHROPIC_MODEL` |
| DEC-11d | Anthropic data retention and terms in the consent text | Verify current terms and state them; do not promise removal of personal identifiers from typed questions |
| DEC-11e | What happens when the free allowance ends | Either a budgeted paid continuation (then Phase B's ledger applies to Claude) or a switch to local degraded mode only; decide before release so the status copy is honest |

## 7. Acceptance evidence for Phase A

- Claude healthy: both stages on Claude, correct amounts against the fixture, provenance "claude" with model id; zero Gemini calls.
- Claude transient failure at analysis: local degraded answer built through the authorised tool layer, labelled as limited; one exchange, one quota unit; audit row shows the failed Claude attempt.
- Claude failure at explanation: local template over the already sanitised tool results; no tool re-execution.
- Invalid key or model: status shows configuration failure to the operator; chat shows unavailable; no secret in any response or log.
- Outdated consent version: external call refused before dispatch; owner/admin re-consents; member sees non-actionable status.
- Replayed request: one exchange persisted, one quota unit charged, same result returned.
- Deadline expiry or cancel: no second provider call, no late write.
- Private data: a member's private account never appears in another member's tool results (shared test with WP-01).
- Token quota exhaustion: clear limit outcome, no provider call, alert raised.
- CI: no network call to any provider; recorded responses only. Staging: one live smoke with recorded model id, revision and request count.
