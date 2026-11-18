# Thandiso Thandiso AI Assistant Supplemental Issues - Remediation Plan

> **HISTORICAL — 2026-07-12 status note.** All four issues in scope were since
> implemented in `server/modules/ai/` (central sanitizer with fail-closed egress,
> per-query audit logging incl. failures, per-household Redis-backed rate limit,
> service-layer architecture). Live status:
> `docs/ai-integration/specifications/ai-assistant-requirements-traceability.md`.
> Retained for history; do not treat "Not Implemented" below as current.

**Date:** 2026-01-29
**Status:** Historical (was: Proposed - Not Implemented)
**Scope:** AI-DATA-001, AI-AUDIT-001, AI-RATE-001, AI-ARCH-001

---

## Disclaimer

This document captures planned remediation steps for Thandiso Thandiso AI Assistant gaps. No code changes have been merged or verified.

---

## Issues and Proposed Resolutions

### AI-DATA-001 (P0 Critical): Data Protection Gaps

**Problem:** Excessive data could be sent to an external AI API without sanitization.

**Proposed Solution:**
- Add a sanitization layer to remove PII and minimize payloads.
- Limit tool outputs (top N categories, goals, transactions).
- Convert Money values to safe string representations before external calls.

**Planned Files:**
- `server/modules/ai/ai.sanitizer.ts`
- `server/modules/ai/ai.service.ts` (call sanitization before external requests)

**Acceptance Criteria:**
- No personal names, emails, account numbers, or IP addresses sent externally.
- Sanitization applied to all tool results.

---

### AI-AUDIT-001 (P1): Missing Audit Logging

**Problem:** No audit trail for AI tool invocations and data access.

**Proposed Solution:**
- Log each AI query with BusinessAuditService.
- Store user ID, household ID, tools used, response summary, and latency.

**Planned Files:**
- `server/services/BusinessAuditService.ts` (add `ai_query` entity type)
- `server/modules/ai/ai.service.ts`

**Acceptance Criteria:**
- Every AI request produces an audit log entry.
- Errors are logged with failure context.

---

### AI-RATE-001 (P1): Missing Rate Limiting

**Problem:** AI endpoints could be abused without per-household limits.

**Proposed Solution:**
- Add per-household rate limiting (target: 50 requests per 24 hours).
- Return 429 responses with retry information when exceeded.

**Planned Files:**
- `server/modules/ai/ai.middleware.ts`

**Acceptance Criteria:**
- Limits enforced per household, not per user.
- Limits and reset timing are observable in logs.

---

### AI-ARCH-001 (P2): Missing Service Layer

**Problem:** AI logic should follow modular service architecture.

**Proposed Solution:**
- Implement a dedicated `server/modules/ai/` module with routes, controllers, services, and validation.
- Keep file sizes within CLAUDE.md LOC limits.

**Planned Files:**
- `server/modules/ai/ai.routes.ts`
- `server/modules/ai/ai.controller.ts`
- `server/modules/ai/ai.service.ts`
- `server/modules/ai/ai.analytics.service.ts`
- `server/modules/ai/ai.validation.ts`
- `server/modules/ai/ai.types.ts`

**Acceptance Criteria:**
- No monolithic route files for AI.
- Clear separation of HTTP, business logic, and data access.

---

## Planned Schema Changes

- `households.ai_consent_given` (boolean, default false)
- `households.ai_consent_date` (timestamp, nullable)
- Optional: `ai_conversations` table for conversation metadata

---

## Planned API Endpoints

- `POST /api/ai/chat` - primary chat endpoint
- `GET /api/ai/conversations` - optional list of recent conversations

---

## Post-Implementation Verification Checklist

- [ ] Consent gating enforced before any AI processing
- [ ] Rate limiting enforced per household
- [ ] Audit log entries created for success and failure
- [ ] Sanitization removes PII from AI payloads
- [ ] Money class used for all currency values
- [ ] Module files within LOC limits

---

## Notes

- For multi-instance deployments, replace in-memory rate limiting with Redis.
- AI log retention policy should align with compliance requirements.
