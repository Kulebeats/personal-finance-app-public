# Software Requirements Specification (SRS)

## Thandiso AI Assistant

Version: 2.0  
Date: 2026-02-07  
Status: Canonical SRS

Primary reference: `docs/ai-integration/specifications/ai-assistant-master-requirements.md`

---

## 1. Purpose and Scope

This SRS defines functional and non-functional software requirements for Thandiso MVP and primary enhancements.

Scope includes:
- Read-only AI chat for finance insights.
- Consent, privacy, auditability, and cost controls.
- Tool-grounded responses only.

Out of scope for MVP:
- AI writes.
- Streaming responses.
- SHARED (cross-member) conversation history. *(CORRECTED 2026-07-12: per-user
  persistent history IS shipped — SCP-338.)*

## 2. System Context

- Client: React + TypeScript `/advice` page.
- Server: Express AI module under `server/modules/ai`.
- Data: PostgreSQL + Drizzle.
- Provider: Gemini 2.0 Flash.

## 3. External Interfaces

### 3.1 User Interface

- Dedicated `/advice` route.
- Single-panel conversation experience.
- Inline consent gate and error states.

### 3.2 API Interfaces (shipped)

- `POST /api/ai/chat`
- `GET /api/ai/consent`
- `POST /api/ai/consent` (admin+)
- `GET /api/ai/status`
- `GET /api/ai/conversations`
- `GET /api/ai/conversations/:id`
- `DELETE /api/ai/conversations/:id` (member+)

Contract of record: `docs/ai-integration/specifications/ai-assistant-api-spec.md` (v3.0).

### 3.3 Data Interfaces

- `households` consent fields.
- `audit_logs` for AI query and consent events.
- `ai_conversations` / `ai_messages` for persisted threads (`shared/schema.ts:3211,3241`).

## 4. Functional Requirements

- FR-AI-001 Consent Gate: AI chat requires household consent.
- FR-AI-002 Chat API: accepts validated message + optional UUID conversationId.
- FR-AI-003 Tool Grounding: deterministic execution with max 2 tools/query.
- FR-AI-004 Money Safety: all amounts use Money class.
- FR-AI-005 Conversation Persistence: exchanges persist per (household, user) with
  list/get/delete APIs; model context remains single-message (see master requirements
  OPEN-3). *(CORRECTED 2026-07-12: was "session-scoped only".)*
- FR-AI-006 Rate Limiting: 50 requests/household/24h with response headers.
- FR-AI-007 Data Minimization: bounded top-N and payload limits.
- FR-AI-008 PII Sanitization: sanitize before provider call.
- FR-AI-009 Audit Logging: capture request summary, tools, sanitized outputs, latency, token usage.
- FR-AI-010 Error Taxonomy: return the HTTP error codes defined in api-spec v3.0 §3.4
  (`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
  `RATE_LIMIT_EXCEEDED`, `INTERNAL_ERROR`); the internal `AIErrorCode` enum is not an
  HTTP surface.
- FR-AI-011 Multi-Currency: use converted amount in base currency where available.
- FR-AI-012 Non-Convertible Handling: exclude non-convertible rows and report exclusion counts.
- FR-AI-013 Context Limits: max 10 messages or 2000 tokens.
- FR-AI-014 Consent Endpoints: support retrieval and updates.
- FR-AI-015 Privacy Filters: exclude deleted, archived, hidden, private data.
- FR-AI-016 Empty Data Handling: explicit empty-state outputs.
- FR-AI-017 Consent Version Upgrade: block stale consent until re-consent.
- FR-AI-018 Log Redaction: redact PII from application error logs.
- FR-AI-019 Prompt Injection Guardrails: allowlisted tools only, with blocked query handling.
- FR-AI-020 Token Budget Cap: enforce per-request token budget.
- FR-AI-021 Response Provenance (v1.1): include data window and freshness metadata.
- FR-AI-022 Eval Pack Gating: prompt/model updates require passing eval thresholds.

## 5. Consent Governance Requirements

- Only admin+ can grant/revoke consent.
- Consent actor identity is captured in audit records.
- Consent state fields remain in `households`.

## 6. Non-Functional Requirements

- Security: household isolation, validated inputs, rate limits, prompt-injection controls.
- Privacy: no raw PII or internal IDs in provider payloads.
- Performance: P95 < 5 seconds.
- Reliability: consistent errors and retry-safe behavior.
- Compliance: auditable consent and query trail retention (24 months).
- Maintainability: modular AI module and traceable requirement-to-test links.

## 7. Testability and Traceability

- Every FR maps to API behavior and one or more test cases.
- Canonical matrix:
  - `docs/ai-integration/specifications/ai-assistant-requirements-traceability.md`

## 8. Related Documents

- `docs/ai-integration/prd/ai-assistant-prd.md`
- `docs/ai-integration/specifications/ai-assistant-api-spec.md`
- `docs/ai-integration/specifications/ai-assistant-tool-specs.md`
- `docs/ai-integration/specifications/ai-assistant-testing-matrix.md`
- `docs/ai-integration/specifications/ai-assistant-rollout-plan.md`
