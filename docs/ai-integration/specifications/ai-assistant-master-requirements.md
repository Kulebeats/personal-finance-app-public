# Thandiso AI Assistant - Master Requirements (Canonical)

Document Version: 3.0
Date: 2026-07-12
Status: Canonical Requirements (MVP + Primary Enhancements) — reconciled against shipped code (main @ 1da9446)

---

## 0. Thandi v1 Scope Statement (what actually ships)

Given what the server verifiably supports today (`server/modules/ai/`), Thandi v1 is:

**Ships in v1 (server SHIPPED, client UI to be built per the client UI spec):**
- Consent-gated, read-only chat at `/advice` against `POST /api/ai/chat`
  (non-streaming single JSON reply; amounts embedded in reply text).
- 12 sanitized, Money-safe analytics tools (max 2 per query), prompt-injection
  guardrails, per-request token budget, 50/day household quota with headers.
- Household-level consent grant/revoke (admin+) via `GET/POST /api/ai/consent`
  with versioned re-consent, audit rows for every query and consent change.
- Response provenance (`toolsUsed`, data window, freshness) on EVERY reply — this
  shipped in v1, not v1.1 as previously planned.
- **Persistent per-user conversation storage** (SCP-338): every exchange is written
  to `aiConversations`/`aiMessages`, and list/get/delete endpoints are live. The v1
  client uses this only to thread one conversation and restore the latest thread;
  a full history-browsing UI is an open product decision (OPEN-1).

**Deferred (not in v1):**
- Streaming responses (server has no streaming path).
- ~~Multi-turn model context~~ — SHIPPED in v1.1 (OPEN-3): the server now sends up to
  `AI_CONTEXT_MAX_MESSAGES` (default 6) prior messages of the caller's own
  conversation ahead of the current message, within the existing token budget.
- History-browsing UI (rail/search) — server-ready, UI deferred pending OPEN-1.
- Feature flags `ai_assistant_enabled` / `ai_assistant_beta` / `ai_assistant_cache_only`
  / `ai_assistant_tools_enabled`: **NOT implemented in code** (verified by grep,
  2026-07-12). The only kill switches today are removing `GEMINI_API_KEY` (degrades
  to keyword fallback) and revoking consent. Sections 17/21 remain aspirational.
- Tool-result metadata (`resultCount`, `truncated`, `excludedCount`,
  `excludedCurrencies`, `emptyReason`) and `convertedAmount` multi-currency handling
  (FR-AI-011/012/016): not present in the shipped sanitizer/analytics output.
- AI writes, cross-household visibility, multi-provider failover, voice.

Client build contract: `docs/ai-integration/specifications/ai-assistant-api-spec.md`
(v3.0) + `docs/ai-integration/specifications/ai-assistant-client-ui-spec.md` (v1.0).

### Open Product Decisions (SIGNED OFF 2026-07-17 — recommended defaults adopted)

> **Sign-off record:** on 2026-07-17 the product owner approved the
> recommended defaults for OPEN-1…OPEN-6 as written below. Consequences:
> Workstreams A/B/C/E of the v1.1 implementation plan are unblocked;
> Workstream D (consent-gating stored history) is NOT triggered (OPEN-5
> default = history stays readable) unless DPA/legal later reverses it.
> OPEN-2/OPEN-4/OPEN-6 require no further work.

- **OPEN-1 — Conversation-history UI in v1.** Server fully supports list/get/delete.
  Recommended default (applied in the client UI spec): no history rail in v1; restore
  the latest thread on page load; defer browse/delete UI to v1.1.
- **OPEN-2 — Surface provenance/tool chips in the UI.** Provenance ships on every
  reply. Recommended default (applied): show a muted "Based on: … · date window"
  caption under each assistant reply.
- **OPEN-3 — Multi-turn context. RESOLVED (2026-07-19, v1.1 Workstream B).**
  US-AI-005 AC1/AC2 are now implemented: the last `AI_CONTEXT_MAX_MESSAGES`
  (default 6 = 3 turns) messages of the caller's OWN conversation are replayed
  oldest-first ahead of the current message, trimmed to fit inside the existing
  2000-token `AI_REQUEST_TOKEN_BUDGET` (FR-AI-013 caps unchanged — the cap was not
  raised). Stored user messages are re-scanned against the injection blocklist and
  dropped (not failed) on a hit; assistant messages replay verbatim. Foreign/unknown
  conversation ids yield zero history. Audit `details` gained `context_messages` and
  `context_tokens`. UI copy and the consent disclosure were updated accordingly.
- **OPEN-4 — Assistant naming.** System prompt persona is "Thandiso"; UI title is
  "Thandi (AI Assistant)". Recommended default (applied): keep both as-is (Thandi as
  display name); revisit only if brand requires unification.
- **OPEN-5 — History access after consent revoke.** Conversation endpoints have no
  consent gate: persisted threads stay readable after revoke. Recommended default
  (applied): keep readable (consent gates external AI processing, not reads of the
  user's own stored data) — needs DPA/legal confirmation; disclosure copy updated to
  mention stored history.
- **OPEN-6 — "Allow data training" toggle.** No such control exists in code or
  contract; Gemini calls are inference-only per the disclosure. Recommended default:
  out of scope for v1; do not invent UI for it.

## 1. Canonical Rule

This file is the single source of truth for Thandiso requirements in this repository.

- Canonical path: `docs/ai-integration/specifications/ai-assistant-master-requirements.md`
- Mirror files under `docs/specifications` and `docs/architecture` must only point here.
- If a conflict exists, this file wins.

## 2. Overview

Thandiso is a read-only AI assistant for household financial insights. It answers questions about spending, budgets, goals, recurring items, accounts, and cash flow using internal tools and Money-safe calculations.

## 3. Problem Statement

Users need fast, trustworthy answers from financial data without navigating multiple screens.

## 4. Target Users

- Primary: household owners and members managing finances.
- Secondary: power users who need rapid analysis.

## 5. Goals and Non-Goals

Goals:
- Reliable Money-safe answers.
- Consent-first privacy and auditability.
- Predictable latency and error rates.
- Bounded, observable AI cost.

Non-goals (MVP):
- AI-initiated writes.
- SHARED (cross-member) conversation history. *(CORRECTED 2026-07-12: per-user
  persistent history IS shipped server-side — SCP-338. What remains a non-goal is
  sharing threads between household members.)*
- Streaming responses.
- Cross-household visibility.

## 6. Finalized MVP Decisions

- Model: Gemini 2.0 Flash.
- Response mode: single response (non-streaming).
- Rate limit: 50 queries per household per 24h.
- Visibility: requester-only (enforced on chat AND conversation endpoints).
- Conversation storage: **persisted per (household, user)** in
  `aiConversations`/`aiMessages` (SCP-338). *(CORRECTED: previously "ephemeral
  only" — refuted against code.)* Model context remains single-message (see OPEN-3).
- Cache TTL: 5 minutes for cacheable query classes.
- Timeout: 10s provider request timeout.

## 7. Scope

In scope:
- Consent-gated chat.
- 12 internal finance tools.
- Sanitization and minimization.
- Rate limiting, audit logging, observability.
- Feature-flagged rollout.

Out of scope:
- AI writes/actions.
- Multi-provider failover.
- History-browsing UI (server persistence IS in scope and shipped; the browsing UI is
  deferred pending OPEN-1).
- Voice input.

## 8. Success Metrics and Gates

Launch gates (phase progression):
- Error rate < 2% (7-day rolling).
- P95 latency < 5s.
- Tool success rate >= 95%.
- 0 confirmed PII exposure incidents.

90-day objectives:
- 30% active households grant consent.
- 20% active households use AI weekly.
- Tool success rate >= 98%.
- AI error rate <= 2%.
- Cost per query <= $0.01.

## 9. UI Direction (Resolved)

MVP UI is a dedicated `/advice` page with a single-panel conversation layout.

- Keep: suggested prompts, consent gate, inline error states, single active thread
  with latest-thread restore on load.
- Do not include in MVP: floating chat bubble, left history rail (pending OPEN-1).

Buildable requirements (UI-AI-001…008):
`docs/ai-integration/specifications/ai-assistant-client-ui-spec.md`.

## 10. Architecture Summary

Core components:
- Client: Advice page and AI settings controls.
- API: `/api/ai/*` endpoints.
- AI service: tool orchestration and provider calls.
- Data layer: PostgreSQL + Drizzle.
- Audit and telemetry: BusinessAuditService + analytics events.

## 11. Functional Requirements

- FR-AI-001: Household consent required before chat processing.
- FR-AI-002: `POST /api/ai/chat` with strict validation.
- FR-AI-003: Deterministic tool execution (max 2 tools/query).
- FR-AI-004: Money class used for all monetary calculations.
- FR-AI-005: Conversations persist per (household, user) with list/get/delete APIs;
  requester-only visibility. *(CORRECTED 2026-07-12: was "session context only; no
  persisted history" — refuted against code, SCP-338.)*
- FR-AI-006: 50/day household rate limiting with headers.
- FR-AI-007: Data minimization (top-N caps and bounded payloads).
- FR-AI-008: PII sanitization before external provider call.
- FR-AI-009: Audit record for each AI request.
- FR-AI-010: Consistent error taxonomy.
- FR-AI-011: Multi-currency uses `convertedAmount` where available.
- FR-AI-012: Exclude non-convertible items and report exclusions.
- FR-AI-013: Context cap = last 10 messages or 2000 tokens. *(STATUS 2026-07-19: BINDING
  and exercised. OPEN-3 multi-turn context landed in PR #136, so this cap is now enforced
  — history is trimmed newest-first against the token budget, always reserving room for
  the current message (`ai.guardrails.ts`). Supersedes the 2026-07-12 note that read "not
  yet exercised — the shipped server sends only the current message to the provider".)*
- FR-AI-014: Consent APIs support status and updates.
- FR-AI-015: Privacy filters exclude deleted/archived/hidden/private data.
- FR-AI-016: Explicit empty-state responses (no hallucinated placeholders).
- FR-AI-017: Re-consent required if consent version is outdated.
- FR-AI-018: Redact PII in error logs and truncate raw prompt logging.
- FR-AI-019: Prompt-injection guardrails (tool allowlist + input hardening) are mandatory.
- FR-AI-020: Token budget caps are mandatory and enforced per request.
- FR-AI-021: Response provenance metadata is required in v1.1 (`toolsUsed`, data window, freshness timestamp).
- FR-AI-022: Eval pack gates prompt/model releases in CI before rollout.

## 12. API Contract (Canonical)

The full, code-verified contract lives in
`docs/ai-integration/specifications/ai-assistant-api-spec.md` (v3.0) — that file is
the contract of record for client builds. Summary of what changed vs the previous
revision of this section *(all CORRECTED 2026-07-12 against `server/modules/ai/`)*:

- The route surface is SEVEN endpoints, not four: `POST /chat`, `GET /status`,
  `GET/POST /consent`, plus shipped conversation endpoints
  `GET /conversations`, `GET /conversations/:id`, `DELETE /conversations/:id`.
- Success bodies are raw JSON (no V7 envelope); error bodies ARE V7-enveloped.
- `provenance` ships on every chat reply today (it is not a future v1.1 field).
- Real HTTP error codes: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403
  (consent absent / insufficient role), `CSRF_INVALID` 403, `NOT_FOUND` 404,
  `RATE_LIMIT_EXCEEDED` 429, `INTERNAL_ERROR` 500. The former list
  (`CONSENT_REQUIRED`, `INVALID_INPUT`, `EXTERNAL_API_ERROR`,
  `TOOL_EXECUTION_FAILED`) is the internal `AIErrorCode` enum and is never surfaced
  over HTTP.
- Rate-limit headers are present on admitted `/chat` responses only; a 429 carries no
  headers — clients read reset time from `GET /status`.
- `GET /status` `available` is hardcoded `true` and must not drive outage UI.

## 13. Consent Governance (Resolved)

- Consent applies at household level.
- Grant/revoke authority: household `admin` or `owner` (admin+).
- Consent state fields stay in `households`.
- Consent actor identity is captured in audit logs (`userId`, `householdId`, timestamp, IP, action details).

## 14. Data Schema

`households`:
- `ai_consent_given BOOLEAN DEFAULT FALSE`
- `ai_consent_date TIMESTAMP NULL`
- `ai_consent_version VARCHAR(10) DEFAULT 'v1.0'`

`audit_logs`:
- AI query and consent event records retained 24 months.

## 15. Data Handling Matrix (Resolved)

| Data Stage | Purpose | Allowed Data | Forbidden Data |
|---|---|---|---|
| Raw tool output (server only) | internal computation | full internal fields required for joins | raw output must not be sent externally |
| Sanitized provider payload | model grounding | aggregates, category labels, merchant labels, money amounts, bounded top-N | PII, internal IDs, account numbers, raw notes |
| Audit payload | compliance trace | sanitized tool summary, tools used, response summary, timing, token count | raw PII, raw internal IDs |
| Client response | user UX | reply text, tools used, token count, remaining quota | hidden identifiers, sensitive internal metadata |

Rule: when requirements say "tool outputs logged", it means sanitized tool outputs only.

## 16. Tooling Policy

MVP tool set: 12 tools from tool specification.

Mandatory execution policy:
- Maximum 2 tools per query.
- Deterministic priority order for ambiguous intents.
- Empty-data result contracts are explicit.
- Soft-delete/privacy filters are always applied.

## 17. Feature Flags (Planned — NOT implemented)

*(STATUS 2026-07-12: none of these flags exist in code — verified by repo-wide grep.
Today's operational levers are `GEMINI_API_KEY` absence (degrades chat to the keyword
fallback) and household consent revocation. Implement before the beta rollout phase.)*

- `ai_assistant_enabled`: global kill switch.
- `ai_assistant_beta`: cohort gate.
- `ai_assistant_cache_only`: no provider calls.
- `ai_assistant_tools_enabled`: toggle tool execution path.

## 18. Cost and Safety Guardrails (Primary)

Request-level:
- Max input length: 1000 chars.
- Token budget cap per request: 2000 tokens.
- Tool call cap: 2.

Environment guardrails:

| Environment | Soft Daily Alert | Hard Daily Action |
|---|---:|---:|
| dev | $5 | $10 (disable provider calls) |
| beta | $15 | $25 (enable cache-only + reduce quota) |
| prod (<500 households phase) | $20 | $30 (cache-only + beta gate) |

Monthly budget target during early production: <= $500.

## 19. Observability, Provenance, and Eval Pack

Must track:
- Latency (P50/P95/P99), tool success/failure, rate-limit events, cache hit/miss, token counts, estimated cost.
- Prompt/model version on each response.
- Security events for blocked prompt-injection attempts.

Primary enhancements:
- Response provenance block in v1.1: data window, freshness timestamp, tool provenance.
- Eval pack in CI: gold prompts, finance correctness checks, privacy guard checks, regression threshold enforcement.

## 20. Testing and Traceability

- Security tests include prompt injection, PII redaction, and oversized input rejection.
- Performance tests include token-cap enforcement and concurrency under household limits.
- Traceability matrix is maintained at:
  - `docs/ai-integration/specifications/ai-assistant-requirements-traceability.md`

## 21. Rollout

1. Internal QA.
2. Beta cohort with tighter limits.
3. Public MVP rollout at standard limits.
4. Production tuning with eval-gated prompt/model releases.

## 22. Open Questions

- Hosting platform target.
- Final legal wording for consent disclosure (including stored conversation history —
  see OPEN-5).
- ~~v1.1 provenance payload fields finalized for API response.~~ RESOLVED: provenance
  shipped in v1 (`dataWindow`, `freshnessTs`, `tools`).
- ~~Product decisions OPEN-1…OPEN-6 (section 0) need human sign-off.~~
  RESOLVED 2026-07-17: recommended defaults adopted by the product owner
  (see the sign-off record in section 0).

## 23. References

- `docs/ai-integration/prd/ai-assistant-prd.md`
- `docs/ai-integration/specifications/ai-assistant-srs.md`
- `docs/ai-integration/specifications/ai-assistant-api-spec.md`
- `docs/ai-integration/specifications/ai-assistant-client-ui-spec.md`
- `docs/ai-integration/specifications/ai-assistant-tool-specs.md`
- `docs/ai-integration/specifications/ai-assistant-testing-matrix.md`
- `docs/ai-integration/specifications/ai-assistant-rollout-plan.md`
- `docs/ai-integration/specifications/ai-assistant-analytics-plan.md`
- `docs/ai-integration/specifications/ai-assistant-consent-disclosure-copy.md`
- `docs/ai-integration/operations/ai-assistant-ops-runbook.md`
- `docs/ai-integration/architecture/ai-assistant-technical-design.md`
