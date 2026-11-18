# Thandiso (AI Assistant) PRD

Version: 2.0  
Date: 2026-02-07  
Status: Canonical Product Requirements

Primary reference: `docs/ai-integration/specifications/ai-assistant-master-requirements.md`

---

## 1. Product Summary

Thandiso adds a natural language interface to household finance data. MVP is read-only, consent-gated, auditable, cost-controlled, and built on internal tool grounding.

## 2. Problem

Users spend too long navigating reports and pages to answer straightforward finance questions.

## 3. Target Users

- Household owners/admins and members who manage budgets, goals, and spending.
- Power users seeking rapid, conversational analysis.

## 4. Product Goals

- Reduce time-to-insight for common finance questions.
- Preserve Money-safe correctness.
- Enforce privacy and consent boundaries.
- Maintain predictable latency, quality, and cost.

## 5. Non-Goals (MVP)

- No AI write operations.
- No SHARED (cross-member) conversation history. *(CORRECTED 2026-07-12: per-user
  persistent history IS shipped server-side — SCP-338; the history-browsing UI is
  deferred pending OPEN-1 in the master requirements.)*
- No streaming responses.
- No cross-household visibility.

## 6. UI/UX Direction (Resolved)

MVP uses a dedicated `/advice` page.

Included:
- Single-panel chat surface.
- Suggested prompts.
- Inline consent gate.
- Inline loading/error/rate-limit states.
- Single active thread with latest-thread restore on load.

Excluded in MVP:
- Floating chat bubble.
- Left conversation history rail (pending OPEN-1).

Buildable client requirements:
`docs/ai-integration/specifications/ai-assistant-client-ui-spec.md`.

## 7. MVP Features

1. Household consent and governance.
2. Chat endpoint and orchestration.
3. 12 internal money-safe tools.
4. Sanitization and minimization.
5. Audit logging, quotas, and cost controls.
6. Observability and analytics instrumentation.
7. Cache for common query classes.

## 8. API Contract (v1.0)

### `POST /api/ai/chat`

Request:
- `message` (required, 1-1000 chars)
- `conversationId` (optional UUID)

Response:
- `reply`
- `conversationId`
- `toolsUsed`
- `tokenCount`
- `remainingQueries`

Response also includes `provenance` on every reply (shipped in v1).

Errors *(CORRECTED 2026-07-12 — actual HTTP codes; see api-spec v3.0 §3.4)*:
- 400 `VALIDATION_ERROR`, 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (consent absent),
  429 `RATE_LIMIT_EXCEEDED`, 500 `INTERNAL_ERROR`.

Headers (on **every** response, admitted or 429):
- `RateLimit-Limit`
- `RateLimit-Remaining`
- `RateLimit-Reset` (delta-seconds)

Plus `Retry-After` (delta-seconds) on a 429.

*(CORRECTED 2026-07-19: this previously listed the `X-RateLimit-*` names and said
they were "absent on 429". Both are wrong — PR #124 put the headers on the 429 too,
and PR #135 moved to the IETF `RateLimit-*` family.)*

### Consent, Status, and Conversation Endpoints

- `GET /api/ai/consent`
- `POST /api/ai/consent` (admin+)
- `GET /api/ai/status`
- `GET /api/ai/conversations`, `GET /api/ai/conversations/:id`,
  `DELETE /api/ai/conversations/:id` (shipped — SCP-338)

## 9. Consent Governance (Resolved)

- Household-level consent.
- Consent grant/revoke authority is admin+ (admin or owner).
- Consent actor is captured in audit logs.
- Re-consent required when consent version changes.

## 10. Privacy and Logging Policy (Resolved)

- Provider payloads must be sanitized and minimized.
- Audit records must store sanitized tool output summaries only.
- Raw internal IDs and PII are forbidden in outbound payloads and logs.
- Error logs must redact PII.

## 11. Quality, Performance, and Cost Targets

Launch gates:
- Error rate < 2%.
- P95 latency < 5s.
- Tool success >= 95%.
- 0 PII incidents.

90-day objectives:
- Consent adoption 30% of active households.
- Weekly AI usage 20% of active households.
- Tool success >= 98%.
- Cost/query <= $0.01.

## 12. Feature Flags (Planned — NOT implemented as of 2026-07-12)

- `ai_assistant_enabled`
- `ai_assistant_beta`
- `ai_assistant_cache_only`
- `ai_assistant_tools_enabled`

None of these exist in code yet (verified by grep); see master requirements §17.

## 13. Primary Enhancements (Now Required)

1. Prompt injection guardrails are mandatory (tool allowlist + blocked-intent handling).
2. Token budget caps are mandatory.
3. Response provenance is required in API v1.1.
4. Eval pack is required for prompt/model release gating.
5. Environment-specific cost guardrails are enforced.

## 14. Rollout

1. Internal QA.
2. Beta cohort.
3. Public MVP rollout.
4. Ongoing tuning with eval-gated releases.

## 15. Traceability

Requirements traceability matrix lives at:
`docs/ai-integration/specifications/ai-assistant-requirements-traceability.md`
