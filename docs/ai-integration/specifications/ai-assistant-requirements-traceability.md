# Thandiso AI Requirements Traceability Matrix

Version: 2.0
Date: 2026-07-12
Status: Active — statuses code-verified against `server/modules/ai/` (main @ 1da9446)

Source requirements:
- `docs/ai-integration/specifications/ai-assistant-master-requirements.md`
- `docs/ai-integration/specifications/ai-assistant-srs.md`
- `docs/ai-integration/specifications/ai-assistant-client-ui-spec.md` (UI-AI rows)

Status legend: **Shipped (verified)** = implementation read in code and covered by a
merged test; **Shipped (needs test)** = code verified, dedicated test coverage thin;
**Not implemented** = requirement text exists, no code; **Planned** = future work.

---

## Server / API Requirements

| Requirement ID | Requirement Summary | API/Component | Primary Test Coverage | Owner | Status |
|---|---|---|---|---|---|
| FR-AI-001 | consent gate before AI processing | `POST /api/ai/chat`, `consentCheckMiddleware` (`ai.middleware.ts:170`) | `__tests__/ai.consent.realdb.integration.test.ts` (real-DB 403) | Backend | Shipped (verified) |
| FR-AI-002 | validated chat API input | `chatRequestSchema` (`ai.validation.ts:23`) | `__tests__/ai.integration.test.ts` validation cases | Backend | Shipped (verified) |
| FR-AI-003 | deterministic max-2 tool execution | `enforceToolAllowlist` (`ai.guardrails.ts:102`) | `__tests__/ai.guardrails.test.ts` | Backend | Shipped (verified) |
| FR-AI-004 | Money-safe calculations | `ai.analytics.service.ts`, `ai.sanitizer.ts` (Money aggregation) | `__tests__/ai.sanitizer.test.ts` | Backend | Shipped (verified) |
| FR-AI-005 | persisted per-user conversations (CORRECTED from "session-only") | `ai.conversation.service.ts` / `.repository.ts`; `GET/DELETE /api/ai/conversations*` | `__tests__/ai.conversation.persistence.db.test.ts` (real-DB) | Backend | Shipped (verified) |
| FR-AI-006 | 50/day household rate limit + headers | `rateLimitMiddleware` (`ai.middleware.ts:100`), Redis-backed | `__tests__/ai.middleware.test.ts`, `ai.redis-backend.test.ts` | Backend | Shipped (verified) |
| FR-AI-007 | data minimization (top-N caps) | `ai.sanitizer.ts:72-76` caps | `__tests__/ai.sanitizer.test.ts` | Backend | Shipped (verified) |
| FR-AI-008 | PII sanitization on ALL tools, fail closed | `sanitizeToolResult` (`ai.sanitizer.ts:380`), `ai.service.ts:471-485` | `__tests__/ai.service.sanitization.test.ts` | Backend | Shipped (verified) |
| FR-AI-009 | audit logging per query (incl. failures, honest `data_sanitized`) | `ai.service.ts:297-316,374-388` | `__tests__/ai.integration.test.ts` audit assertions | Backend | Shipped (verified) |
| FR-AI-010 | error taxonomy over HTTP | `HttpError` classes + `server/utils/errorHandler.ts` (see api-spec §3.4 for the REAL codes) | unit: error mapping | Backend | Shipped (verified) |
| FR-AI-011 | multi-currency `convertedAmount` handling | analytics query layer | — | Backend | Not implemented (verified 2026-07-12: no `convertedAmount` usage in `ai.analytics.service.ts`) |
| FR-AI-012 | non-convertible exclusion metadata | analytics + sanitizer metadata | — | Backend | Not implemented (no `excludedCount`/`excludedCurrencies` fields in code) |
| FR-AI-013 | context cap 10 msgs / 2000 tokens | `ai.guardrails.ts` (newest-first trim, reserves current message) | `ai.context-history.test.ts`, `ai.multi-turn-context.db.test.ts` | Backend | BINDING as of PR #136 (2026-07-19) — was "Not applicable yet (server sends current message only)" |
| FR-AI-014 | consent get/set APIs | `GET/POST /api/ai/consent` (`ai.controller.ts:195,233`) | `__tests__/ai.consent.realdb.integration.test.ts` | Backend | Shipped (verified) |
| FR-AI-015 | soft-delete/private filters | `ai.privacy-filters.ts` | security-filter unit tests | Backend | Shipped (verified) |
| FR-AI-016 | explicit empty data handling (`emptyReason`) | tool result contracts | — | Backend | Not implemented (no `emptyReason` in code; model instructed to state empty data in prose) |
| FR-AI-017 | re-consent on version upgrade | `needsReconsent` (`ai.controller.ts:221`) | consent integration tests | Backend | Shipped (verified) |
| FR-AI-018 | PII-redacted error logging | logger usage truncates query to 100-200 chars | log redaction spot checks | Backend | Shipped (needs test) |
| FR-AI-019 | prompt-injection guardrails | `detectPromptInjection`, `hardenUserMessage`, allowlist (`ai.guardrails.ts`); tool-arg Zod validation (`ai.validation.ts:237`) | `__tests__/ai.guardrails.test.ts`, `ai.tool-arg-validation.test.ts` | Backend | Shipped (verified) |
| FR-AI-020 | request token budget cap | `getRequestTokenBudget` (`ai.guardrails.ts:61`), enforced in `ai.service.ts` | guardrails tests | Backend | Shipped (verified) |
| FR-AI-021 | response provenance metadata | `buildProvenance` (`ai.service.ts:649`) — ships on EVERY reply (v1, not v1.1) | `__tests__/ai.integration.test.ts:183` | Backend | Shipped (verified) |
| FR-AI-022 | CI eval gating for prompt/model | `ai.eval-pack.ts` + `__tests__/ai.eval-pack.test.ts` | eval pack test suite | Platform | Shipped (needs CI gate wiring) |

## Client Chat UI Requirements (v1 build — packet R16)

| Requirement ID | Requirement Summary | Endpoint(s) consumed | Testing-matrix row | Owner | Status |
|---|---|---|---|---|---|
| UI-AI-001 | `/advice` entry replaces static stub; single-panel layout | — (route `client/src/App.tsx:88`) | T-UI-1 | Frontend | Not started |
| UI-AI-002 | consent-first flow, role-aware (admin can grant; member sees notice) | `GET /api/ai/consent`, `POST /api/ai/consent` | T-UI-2 | Frontend | Not started |
| UI-AI-003 | conversation UX: optimistic send, typing indicator, non-streaming reply, New chat, suggested prompts, independent-turns copy | `POST /api/ai/chat` | T-UI-3 | Frontend | Not started |
| UI-AI-004 | reply rendering + provenance caption + quota indicator; client money formatter for any UI-computed values | `POST /api/ai/chat`, `GET /api/ai/status` | T-UI-4 | Frontend | Not started |
| UI-AI-005 | full state coverage: empty/loading/validation/quota/consent-absent/outage/unauthenticated/guardrail | chat + status + consent | T-UI-5 | Frontend | Not started |
| UI-AI-006 | latest-thread restore on load; history browsing deferred (OPEN-1) | `GET /api/ai/conversations`, `GET /api/ai/conversations/:id` (+ `DELETE` if OPEN-1 lands) | T-UI-6 | Frontend | Not started |
| UI-AI-007 | accessibility: aria-live log, labels, keyboard, alerts, reduced motion | — | T-UI-7 | Frontend | Not started |
| UI-AI-008 | code constraints: feature module, <300 LOC components, typed payloads, ≥50% UI coverage | — | T-UI-8 | Frontend | Not started |

## Notes

- Update `Owner` with named owner before each milestone.
- Move `Status` to Shipped (verified) only after code AND a merged test are confirmed —
  Rule 5 (Previous Session Audit Rule) applies.
- Keep test labels aligned with `docs/ai-integration/specifications/ai-assistant-testing-matrix.md`.
