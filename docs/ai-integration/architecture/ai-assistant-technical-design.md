# Thandiso AI Assistant - Technical Design

Version: 2.1  
Date: 2026-02-07  
Status: Canonical Technical Design

Primary requirements source:
- `docs/ai-integration/specifications/ai-assistant-master-requirements.md`

---

## 1. System Architecture

### 1.1 Components

- Client: `/advice` page and AI settings controls.
- API: `server/modules/ai/ai.routes.ts`.
- Orchestration: `AIService` and provider adapter.
- Data tools: `AIAnalyticsService`.
- Sanitization: `AISanitizer`.
- Cache: `AICacheService`.
- Telemetry: `ai.tracking.ts` + audit logs.

### 1.2 Route Surface

- `POST /api/ai/chat`
- `GET /api/ai/consent`
- `POST /api/ai/consent` (admin+)
- `GET /api/ai/status`
- `GET /api/ai/conversations`
- `GET /api/ai/conversations/:id`
- `DELETE /api/ai/conversations/:id` (member+)

*(CORRECTED 2026-07-12: the conversation endpoints are NOT placeholders — they are
fully implemented with atomic persistence to `aiConversations`/`aiMessages` and
(household, user) scoping (SCP-338). See api-spec v3.0 §7. Whether the v1 UI surfaces
history browsing is OPEN-1 in the master requirements.)*

## 2. Data Flow

1. Client sends chat request.
2. Server validates auth and household context.
3. Consent and rate limit middleware enforce gating.
4. AI service resolves intent and selects max 2 tools.
5. Tools query household-scoped data with Money-safe calculations.
6. Sanitizer prepares bounded, non-PII provider payload.
7. Provider generates reply.
8. Service stores sanitized audit record and emits analytics.
9. Response returns with rate-limit state.

## 3. Module Layout

- `ai.routes.ts`: route declarations.
- `ai.controller.ts`: endpoint handlers.
- `ai.service.ts`: orchestration.
- `ai.conversation.service.ts` / `ai.conversation.repository.ts`: persisted
  conversation threads (SCP-338).
- `ai.gemini.ts`: provider client, tool declarations, system prompt.
- `ai.guardrails.ts`: prompt hardening, injection detection, allowlist, token budget.
- `ai.analytics.service.ts`: internal tool queries.
- `ai.privacy-filters.ts`: soft-delete/archive/privacy predicates for tool queries.
- `ai.sanitizer.ts`: redaction and minimization.
- `ai.cache.ts`: 5-minute cache for cacheable classes (L1 + optional Redis L2).
- `ai.middleware.ts`: consent + rate limit.
- `ai.validation.ts`: zod schemas (requests AND model-supplied tool args).
- `ai.types.ts`: types and error codes.
- `ai.tracking.ts`: analytics events.

## 4. API Contract

Design aligns to canonical API spec:
- `docs/ai-integration/specifications/ai-assistant-api-spec.md` (v3.0, code-verified)

Shipped chat response fields:
- `reply`, `conversationId`, `toolsUsed`, `tokenCount`, `remainingQueries`,
  `provenance` *(CORRECTED 2026-07-12: provenance shipped in v1 on every reply; it is
  not a planned v1.1 field)*

Success bodies are raw JSON; error bodies use the V7 error envelope (api-spec §1).

## 5. Security Design

### 5.1 Isolation and Access

- All queries scoped by `req.householdContext.householdId`.
- Consent grant/revoke is admin+.

### 5.2 Privacy Controls

- PII stripping and internal ID removal before provider call.
- Sanitized summaries only in audit records.
- Error logs redact sensitive content.

### 5.3 Injection and Abuse Controls

- Tool allowlist with deterministic selection.
- Max 2 tools/query.
- Input length cap (1000 chars).
- Token budget cap (2000/request).

## 6. Performance and Reliability

Targets:
- P50 < 2s, P95 < 5s, timeout 10s.

Controls:
- Cache for common query classes (5m TTL).
- Clear error taxonomy and fallback paths.
- Cache-only and tools flags for degraded mode.

## 7. Cost Controls

- Household quota: 50/day.
- Token cap per request: 2000.
- Environment guardrails:
  - dev soft/hard: $5/$10 day.
  - beta soft/hard: $15/$25 day.
  - prod soft/hard: $20/$30 day.
- Early production monthly target: <= $500.

## 8. Testing Strategy

Reference:
- `docs/ai-integration/specifications/ai-assistant-testing-matrix.md`

Required coverage domains:
- correctness and Money usage
- security and privacy
- performance and cost guards
- role and consent enforcement
- traceability to FR set

## 9. Eval Pack and Release Governance

Prompt/model changes require CI eval pass:
- finance correctness set
- privacy guard checks
- regression threshold checks

## 10. Known Deferred Items

- streaming responses
- feature flags from §rollout (not implemented in code as of 2026-07-12)
- multi-provider failover

*(No longer deferred, corrected 2026-07-19: the conversation history-browsing UI
shipped in PR #126 (OPEN-1, `client/src/features/ai/components/HistoryPanel.tsx`),
and multi-turn model context shipped in PR #136 (OPEN-3, `loadHistoryForContext`
in `ai.service.ts` + `buildContents` in `ai.gemini.ts`). Both were listed here as
deferred after they had already merged.)*

## 11. References

- `docs/ai-integration/specifications/ai-assistant-master-requirements.md`
- `docs/ai-integration/specifications/ai-assistant-srs.md`
- `docs/ai-integration/specifications/ai-assistant-api-spec.md`
- `docs/ai-integration/specifications/ai-assistant-tool-specs.md`
- `docs/ai-integration/operations/ai-assistant-ops-runbook.md`
