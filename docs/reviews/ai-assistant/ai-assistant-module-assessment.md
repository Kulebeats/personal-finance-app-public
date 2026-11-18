# AI Assistant Module Assessment

**Assessment Date:** 2026-07-06
**Assessment Type:** Provisional W6 canonical assessment; W10 is the authoritative post-staging reassessment.
**Overall Score:** 86/100 | Status: PROVISIONAL - production path materially remediated, staging Gemini smoke still required

---

## Executive Summary

The AI Assistant module has closed the June P0 issues that made the external AI boundary unsafe: tool outputs now flow through a central sanitizer before they can reach Gemini, `data_sanitized` is derived from the real sanitizer result, Gemini-supplied tool arguments are validated before query execution, and conversation history persists with household/user scoping.

The remaining gap is not a known code blocker; it is missing live staging proof. W9 must exercise the configured Gemini path, consent gate, audit/tracking records, and rollback behavior before W10 can score this module at 100.

---

## Evidence Snapshot

| Area | Current Evidence |
|---|---|
| Routes and access control | `server/modules/ai/ai.routes.ts` applies `requireAuth`, `householdGuard`, consent middleware, household rate limiting, and member-only delete for conversations. |
| Sanitized external egress | `server/modules/ai/ai.service.ts` routes Gemini tool results through `sanitizeToolResult`; unknown sanitizer branches are withheld instead of forwarded. |
| Honest audit attestation | `server/modules/ai/ai.service.ts` records `data_sanitized` from sanitizer output rather than a hardcoded value. |
| Tool argument validation | `server/modules/ai/ai.validation.ts` exposes `validateToolArgs`; `ai.service.ts` validates model-provided args before executing tool queries. |
| Conversation persistence | `server/modules/ai/ai.conversation.repository.ts` and `ai.conversation.service.ts` persist conversations/messages and scope all reads/deletes by household and user. |
| Rate limits and cache | `server/modules/ai/ai.middleware.ts` and `ai.cache.ts` support Redis-backed quota/cache with in-memory fallback. |
| Test coverage | `server/modules/ai/__tests__/ai.service.sanitization.test.ts`, `ai.tool-arg-validation.test.ts`, `ai.conversation.persistence.db.test.ts`, `ai.redis-backend.test.ts`, guardrail/sanitizer/cache/tracking tests. |

---

## CLAUDE.md Compliance Summary

| Rule | Status | Evidence |
|---|---|---|
| Rule 1 (Money) | PASS | AI analytics/tool output paths use structured money data and tests cover Money formatting/integration. |
| Rule 2 (LOC) | PARTIAL | Module is split by concern; large analytics/Gemini service surfaces should be revisited in W10 if still above local limits. |
| Rule 5 (Controller) | PASS | `ai.controller.ts` delegates orchestration to service/repository layers. |
| Rule 6 (Response) | PARTIAL | Main endpoints return structured JSON, but the module should be aligned with the final V7 response-envelope standard during W10. |
| Rule 7 (Errors) | PASS | Validation and operational errors are surfaced through established error paths. |
| Rule 8 (Validation) | PASS | User input and Gemini tool args use Zod validation. |
| Rule 9 (Audit) | PASS | AI usage, consent, rate-limit, and sanitization facts are tracked/audited with explicit egress metadata. |
| Rule 12 (Rate Limit) | PASS | Routes inherit the global `/api` limiter and query endpoints apply household-level AI limits. |
| Rule 16 (No any) | PARTIAL | No current P0 from type casts, but W10 should rerun a focused `as any` sweep across AI files. |
| Rule 17 (Tests) | PASS | Unit, security, Redis fallback, and real-DB conversation persistence coverage exist. |

---

## Open Items Before 100

| ID | Severity | Item | Required Closure |
|---|---|---|---|
| AI-STAGING-001 | P1 | Live Gemini path not smoke-tested in staging in this W6 packet. | W9 must run the AI consent/query path with the configured provider or explicitly document AI disabled in staging. |
| AI-ASSESS-001 | P2 | This file is provisional. | W10 must reassess the module against live code, CI, dependency audit, and staging evidence. |

---

## Provisional Verdict

Production code is materially remediated from the June AI findings, but the module cannot be marked 100/100 until the live provider path and consent/audit behavior are proven in staging and re-scored in W10.
