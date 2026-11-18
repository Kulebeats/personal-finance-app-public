# Thandiso AI Testing Matrix (MVP)

Version: 3.0
Date: 2026-07-12
Status: Canonical Testing Matrix — aligned to shipped contract (api-spec v3.0)

---

## 1. Unit Tests

- Sanitizer removes PII and internal IDs from outbound/log payloads.
- Tool selection enforces max 2 tools/query and deterministic priority.
- ~~Session context truncation enforces 10 message / 2000 token cap.~~ *(Deferred with
  OPEN-3: the shipped server sends only the current message to the provider.)*
- Conversation persistence: exchange appended atomically; cross-tenant id treated as
  new thread (`ai.conversation.persistence.db.test.ts`).
- Rate limiter enforces 50/day household quota.
- Token budget cap enforcement logic.
- Consent version mismatch sets `needsReconsent`.

## 2. Integration Tests

- `POST /api/ai/chat` happy path (raw JSON body incl. `provenance`).
- `GET /api/ai/consent` and `POST /api/ai/consent` shape and role enforcement
  (403 `FORBIDDEN` for non-admin grant/revoke).
- `GET /api/ai/status` exposes rate-limit state.
- `GET/DELETE /api/ai/conversations*`: list pagination, get with messages,
  delete → 204 + cascade, 404 on cross-tenant id (no existence leak).
- 403 `FORBIDDEN` on missing consent (chat only; conversation reads unaffected).
- 429 `RATE_LIMIT_EXCEEDED` on quota breach — assert NO rate-limit headers on the 429
  itself; headers assert on admitted responses (api-spec §3.3).
- Tool/provider failure returns 500 `INTERNAL_ERROR` and writes a failure audit row.
- Household isolation blocks cross-household data access.

## 3. End-to-End Tests

- Consent enable -> chat -> grounded response.
- Consent revoke -> chat blocked.
- Re-consent required when consent version changes.
- Repeated query cache hit path.
- Provider outage fallback behavior.

## 4. Security Tests

- Prompt injection attempts cannot trigger disallowed tools.
- PII redaction validation for outbound payloads and logs.
- Oversized input rejected.
- Private/hidden/deleted records excluded.

## 5. Performance and Cost Tests

- P95 latency < 5 seconds under representative load.
- Concurrency respects per-household limits.
- Token cap enforced under long prompts.
- Cost telemetry emitted and guardrail thresholds exercised.

## 6. Client Chat UI Tests (T-UI rows — map to UI-AI-001…008)

| Row | Covers | Cases |
|---|---|---|
| T-UI-1 | UI-AI-001 | `/advice` renders chat container; route/lazy boundary intact |
| T-UI-2 | UI-AI-002 | admin sees enable button; member sees "ask your admin" notice (no 403-able button); `needsReconsent` shows re-consent copy; grant flips gate to composer |
| T-UI-3 | UI-AI-003 | optimistic user bubble; typing indicator while pending; reply replaces placeholder; `conversationId` resent on next message; New chat resets thread; Enter sends / Shift+Enter newline; 1000-char cap + counter |
| T-UI-4 | UI-AI-004 | provenance caption rendered from response; quota counter seeds from `/status` and updates from `remainingQueries`; no ad-hoc money formatting |
| T-UI-5 | UI-AI-005 | one test per state row (§5 of client UI spec): empty, loading, 400 field error, 429 quota (fetches `/status` for reset), 403 consent fallback, 500 outage retry, guardrail refusal rendered as normal reply |
| T-UI-6 | UI-AI-006 | latest-thread restore on mount (list limit=1 → get); empty history renders empty state; 204-aware delete (if OPEN-1 ships) |
| T-UI-7 | UI-AI-007 | log has `role="log"` + `aria-live="polite"`; composer labelled; alerts `role="alert"`; keyboard-only walkthrough |
| T-UI-8 | UI-AI-008 | components <300 LOC; typed payloads; UI coverage >= 50% (Rule 17) |

Accessibility (kept from v2.0, folded into T-UI-7):
- Consent gate keyboard flow.
- Input and action controls have accessible labels.
- Error states announced to assistive technologies.

## 7. Traceability

Detailed FR/UI mappings live in:
- `docs/ai-integration/specifications/ai-assistant-requirements-traceability.md`
