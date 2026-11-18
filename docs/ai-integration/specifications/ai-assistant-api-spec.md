# Thandiso AI API Specification

Version: 3.1
Date: 2026-07-17 (v3.0 base: 2026-07-12)
Status: Canonical API Contract — verified against shipped code (v3.0 base: main @ 1da9446)

> **v3.2 amendment (2026-07-19).** §3.2 and §3.3. Multi-turn context shipped
> (PR #136), so §3.2's "NOT implemented" note is superseded. The §3.3 headers
> were renamed from the hand-rolled `X-RateLimit-*` to the IETF `RateLimit-*`
> family with `Reset` as delta-seconds (PR #135), and `Retry-After` is now
> emitted centrally for every `RateLimitError` thrower (PR #127). Superseded
> notes are retained inline in each section.
>
> **v3.1 amendment (2026-07-17).** §3.3 only: the AI limiter now emits the full
> quota trio plus `Retry-After` on a `429` (v1.1 Workstream C). The
> superseded v3.0 note is retained inline in §3.3. All other sections remain as
> verified at v3.0 against main @ `1da9446`.

> **Contract of record.** This document was reconciled line-by-line against the live
> server module (`server/modules/ai/`). Where an earlier revision of this spec and the
> code disagreed, the code won and the correction is noted inline with a `CORRECTED`
> marker. Source files: `ai.routes.ts`, `ai.controller.ts`, `ai.service.ts`,
> `ai.conversation.service.ts`, `ai.conversation.repository.ts`, `ai.middleware.ts`,
> `ai.validation.ts`, `ai.types.ts`, `server/utils/errorHandler.ts`,
> `server/core/errors/*`.

---

## 1. Transport and Envelope Rules

- All endpoints live under `/api/ai` and require an authenticated session plus
  household membership (`requireAuth`, `householdGuard` applied router-wide,
  `ai.routes.ts:19`).
- **Success responses are RAW JSON payloads, NOT the V7 `{ success, data }` envelope.**
  Every handler calls `res.status(200).json(payload)` directly (`ai.controller.ts`).
  Client code must not attempt envelope unwrapping on AI success responses.
  *(CORRECTED: earlier doc revisions were silent on this; the repo-wide V7 rule does
  not apply to this module's success bodies.)*
- **Error responses ARE V7-enveloped** by the global error middleware
  (`server/utils/errorHandler.ts:114` → `HttpError.toJSON()`):

  ```json
  { "success": false, "error": { "code": "FORBIDDEN", "message": "...", "timestamp": "2026-07-12T10:00:00.000Z" } }
  ```

  `timestamp` is present for errors raised as `HttpError` subclasses; auth/role
  middleware errors (`server/auth.ts:26`, `server/middleware/validateEntity.ts:292`)
  use the same `{ success:false, error:{ code, message } }` shape without `timestamp`.
- **Response mode is a single JSON body. There is NO streaming** (no SSE, no chunked
  tokens). The provider call has a 10s timeout (`ai.gemini.ts:27`).
- **CSRF:** all mutating methods (`POST`, `DELETE`) require the `x-csrf-token` header
  (`server/app.ts:195-214`). The shared client helper `apiCall`
  (`client/src/lib/api.ts:331`) attaches it and self-heals a stale token
  (403 `CSRF_INVALID` → one retry).

## 2. Authentication and Authorization Summary

| Endpoint | Auth | Consent gate | AI rate limit | Role |
|---|---|---|---|---|
| `POST /api/ai/chat` | session + household | yes | yes (50/day) | member+ |
| `GET /api/ai/status` | session + household | no | no | member+ |
| `GET /api/ai/consent` | session + household | no | no | member+ |
| `POST /api/ai/consent` | session + household | no | no | **admin+** (`requireRole('admin')`, `ai.routes.ts:64`) |
| `GET /api/ai/conversations` | session + household | **no** | no | member+ |
| `GET /api/ai/conversations/:id` | session + household | **no** | no | member+ |
| `DELETE /api/ai/conversations/:id` | session + household | **no** | no | member+ (`requireRole('member')`, `ai.routes.ts:88`) |

*(CORRECTED: consent + AI rate limiting apply ONLY to `/chat` — `ai.routes.ts:22,37`.
Conversation history remains readable after consent is revoked; consent gates external
AI processing, not reads of already-persisted local data. Flagged as an open product/
DPA decision in the master requirements.)*

## 3. `POST /api/ai/chat`

### 3.1 Request

```json
{
  "message": "How much did we spend on groceries this month?",
  "conversationId": "9f3a8614-72b2-4bb6-a4a4-5ba8af59e7a2"
}
```

Rules (`chatRequestSchema`, `ai.validation.ts:23`):
- `message`: required, trimmed, 1–1000 chars.
- `conversationId`: optional UUID. When supplied and owned by the caller, the exchange
  is appended to that thread; when absent or not owned, a new thread is created and its
  id returned. **The client must persist and resend the returned `conversationId` to
  keep one thread.**

### 3.2 Response `200`

```json
{
  "reply": "You spent K2,145.00 on groceries this month.",
  "conversationId": "9f3a8614-72b2-4bb6-a4a4-5ba8af59e7a2",
  "toolsUsed": ["get_spending_by_category"],
  "tokenCount": 842,
  "remainingQueries": 49,
  "provenance": {
    "dataWindow": { "start": "2026-06-12", "end": "2026-07-12" },
    "freshnessTs": "2026-07-12T14:10:00Z",
    "tools": ["get_spending_by_category"]
  }
}
```

- `provenance` is **always present** in shipped responses, including blocked-prompt
  replies (`ai.service.ts:154,347` builds it on every path). *(CORRECTED: earlier
  revisions called it an optional "v1.1 additive" field; it shipped in v1.)*
- `remainingQueries` comes from the quota state the limiter publishes on the request
  (`req.aiRateLimit.remaining`, set in `ai.middleware.ts`). *(CORRECTED 2026-07-19,
  PR #135: it was previously read back out of the `X-RateLimit-Remaining` response
  header, which made an outbound header name load-bearing for an internal value.)*
- **Amounts are embedded in `reply` as text** (the model is instructed to use the
  household currency; the non-Gemini fallback renders `"<CUR> <amount>"`). The chat
  response contains **no structured amount fields** — there is no `MoneyDto` in this
  payload. Clients render `reply` as text.
- **Guardrail outcomes are still `200`s, not errors:** a blocked prompt-injection
  attempt returns a fixed refusal `reply` (`ai.service.ts:57`), and a token-budget
  exhaustion returns a fixed "shorten the question" `reply` (`ai.service.ts:59`).
  The UI needs no special handling beyond rendering the reply.
- **Multi-turn context IS implemented** (v1.1 Workstream B / OPEN-3, PR #136). Prior
  turns of the thread identified by `conversationId` are loaded
  (`ai.service.ts`, `loadHistoryForContext`) and sent to the provider as
  `role: "user"` / `role: "model"` turns (`ai.gemini.ts`, `buildContents`).
  Follow-up questions relying on pronouns or prior turns **do** resolve.
  Each history message is re-scanned for prompt injection and the history is
  token-trimmed newest-first, always reserving room for the current message
  (`ai.guardrails.ts`). History loading degrades to "no history" rather than
  failing the request, and a `conversationId` belonging to another household or
  user yields zero history.

> *(SUPERSEDED 2026-07-19 — v1.1 Workstream B, PR #136. The previous note read:
> "**Multi-turn context is NOT implemented.** Only the current `message` is sent
> to the provider (`ai.service.ts:183-186`); `conversationId` threads persistence
> only. Follow-up questions relying on pronouns/prior turns will not resolve."
> That was accurate before #136 and is retained for auditability. Verified by
> `ai.context-history.test.ts` and the real-DB `ai.multi-turn-context.db.test.ts`.)*

### 3.3 Rate-limit headers (all responses, including `429`)

Set on **every** response from the limiter — admitted or rejected
(`ai.middleware.ts`, `setRateLimitHeaders`):

- `RateLimit-Limit`: `50`
- `RateLimit-Remaining` (`0` on a `429`)
- `RateLimit-Reset`: **delta-seconds** (a positive integer), NOT an ISO timestamp

These are the IETF draft-6 `RateLimit-*` names, the same family
`express-rate-limit` emits for every other limiter in the app
(`server/middleware/rateLimit.ts` sets `standardHeaders: true`). One dialect
across the API, and `Reset` means delta-seconds everywhere.

Additionally, **on a `429` only**:

- `Retry-After`: **delta-seconds** (a positive integer, e.g. `14237`), per
  RFC 9110 §10.2.3. Not an HTTP-date. It is the same instant as
  `RateLimit-Reset`, in the same units, so the two agree.

`Retry-After` is emitted centrally for **every** `RateLimitError` thrower by
`apiErrorMiddleware` (`server/utils/errorHandler.ts`), not per-limiter, so any
429 in the API carries it — not just the AI endpoints.

A `429` is therefore self-describing: a client can render "resets in about N
hours" from the error response alone, with **no** follow-up `GET /api/ai/status`
round-trip. `GET /api/ai/status` remains valid and is still the right call for
proactive/pre-flight quota display.

> *(SUPERSEDED 2026-07-19 — PR #135 renamed this family from the hand-rolled
> `X-RateLimit-*` to the IETF `RateLimit-*`, and changed `Reset` from an ISO
> timestamp to delta-seconds, so the AI endpoints match the other eight limiters
> and `Reset` no longer carries two incompatible types depending on route. PR
> #127 moved `Retry-After` emission into `apiErrorMiddleware` so every thrower
> gets it. The section above documented the pre-#135 `X-RateLimit-*` names until
> this correction. Verified by `ai.ratelimit-429-headers.test.ts`, which also
> asserts the legacy family is no longer emitted.)*
>
> *(SUPERSEDED 2026-07-17 — v1.1 Workstream C, PR `fix/ai-rate-limit-429-headers`.
> The previous CORRECTED note read: "**On a `429` these headers are ABSENT** (the
> limiter throws before setting them, `ai.middleware.ts:109-131`), and no
> `Retry-After` header is sent. To display reset time after a 429, call
> `GET /api/ai/status`." That was accurate against the code at spec v3.0
> (main @ `1da9446`) and is retained here for auditability. The limiter now sets
> all four headers **before** throwing `RateLimitError`; the headers survive the
> global error middleware because `apiErrorMiddleware` only calls
> `res.status().json()`, which does not clear already-set headers. Verified by
> `server/modules/ai/__tests__/ai.ratelimit-429-headers.test.ts`, which asserts
> the headers on a real supertest `429` across both limiter backends
> (in-process fallback and Redis-backed).)*
>
> *(CORRECTED, historical: earlier revisions than v3.0 implied headers on all
> responses — which is once again true as of this supersession, but was not true
> at v3.0.)*

**Client note.** The shipped client (PR #120) compensates for the old behavior with
an extra `GET /api/ai/status` after a 429. That fallback is intentionally retained:
it must keep working against older deployments and for non-429 error paths. Reading
`Retry-After` in `useThandiChat` is a separate, optional client packet.

### 3.4 Errors (actual HTTP surface)

| Status | `error.code` | Trigger | Message (verbatim where fixed) |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | body fails Zod schema | "Invalid request"; `error.fields[]` lists `{ field, message, code }` |
| 401 | `UNAUTHORIZED` | no session / deleted user | "Authentication required" |
| 403 | `FORBIDDEN` | household consent absent | "AI features require consent. Please enable AI assistant in Settings." |
| 403 | `CSRF_INVALID` | missing/stale `x-csrf-token` | "Invalid or expired security token. Please retry." |
| 429 | `RATE_LIMIT_EXCEEDED` | 50/household/24h quota exhausted | "Too many requests. Please try again later." |
| 500 | `INTERNAL_ERROR` | provider outage/timeout, tool orchestration failure | "Failed to process AI query" |

*Client integration note (PR #120): the shared `apiCall` helper
(`client/src/lib/api.ts`) exposes `error.fields` on the thrown error, so
callers can render the specific field message (`fields[0].message`) instead of
the generic "Invalid request".*

*(CORRECTED — this is the largest drift fixed in this revision. The previously listed
codes `CONSENT_REQUIRED`, `INVALID_INPUT`, `EXTERNAL_API_ERROR`, `TOOL_EXECUTION_FAILED`
are values of the internal `AIErrorCode` enum (`ai.types.ts:290`) and are NEVER
surfaced over HTTP. Consent absence surfaces as `403 FORBIDDEN`; validation as
`400 VALIDATION_ERROR`; provider/tool failures as `500 INTERNAL_ERROR`. Clients must
branch on HTTP status + the codes in this table.)*

## 4. `GET /api/ai/status`

Response `200`:

```json
{
  "available": true,
  "rateLimit": {
    "remaining": 37,
    "resetTime": "2026-07-13T00:00:00.000Z",
    "isLimited": false
  }
}
```

- `available` is **hardcoded `true`** (`ai.controller.ts:86`). It does NOT indicate
  the Gemini provider is configured or reachable; when `GEMINI_API_KEY` is absent the
  chat endpoint silently degrades to a keyword-matching fallback and `available` still
  reads `true`. Do not build provider-outage UI on this field. *(CORRECTED.)*
- Reading status does not consume quota.

## 5. `GET /api/ai/consent`

Response `200` (`ai.controller.ts:216-223`):

```json
{
  "consentGiven": true,
  "consentDate": "2026-02-01T10:00:00.000Z",
  "consentVersion": "v1.0",
  "currentVersion": "v1.0",
  "needsReconsent": false
}
```

- `consentDate` is `null` when consent was never set.
- `consentVersion` falls back to `currentVersion` when the stored value is null
  (`ai.controller.ts:219`), so it is non-null in GET responses.
- Current consent version constant: `v1.0` (`ai.controller.ts:28`).

## 6. `POST /api/ai/consent`

Admin+ only. Request:

```json
{ "consentGiven": true }
```

Response `200`:

```json
{
  "consentGiven": true,
  "consentDate": "2026-07-12T15:00:00.000Z",
  "consentVersion": "v1.0"
}
```

- On revoke (`consentGiven: false`) the response `consentVersion` is `null`.
- Errors: `403 FORBIDDEN` with message "This action requires admin role or higher"
  for non-admin members (`validateEntity.ts:292-298`); `400 VALIDATION_ERROR` for a
  non-boolean body.
- Writes a `BusinessAuditService` row (`entityType: 'ai_consent'`, action
  `CREATE`/`DELETE`, `ai.controller.ts:267-279`).

## 7. Conversation History Endpoints (SHIPPED — SCP-338)

*(CORRECTED: earlier revisions omitted these or called them "placeholder-only". They
are fully implemented with real persistence: `aiConversations` / `aiMessages` tables
in `shared/schema.ts:3211,3241`, written atomically per exchange. All reads/writes are
scoped to BOTH `householdId` AND `userId` — a member can never see another member's
threads (Rule 11; `ai.conversation.repository.ts`).)*

### 7.1 `GET /api/ai/conversations`

Query params (`conversationListQuerySchema`): `limit` 1–50 (default 10), `offset` >= 0
(default 0).

Response `200`:

```json
{
  "conversations": [
    {
      "id": "9f3a8614-72b2-4bb6-a4a4-5ba8af59e7a2",
      "createdAt": "2026-07-10T09:00:00.000Z",
      "updatedAt": "2026-07-12T14:10:00.000Z",
      "messageCount": 6,
      "preview": "How much did we spend on groceries this month?"
    }
  ],
  "total": 3,
  "hasMore": false
}
```

Ordered most-recently-updated first. `preview` is the first user message (falls back
to the stored title).

### 7.2 `GET /api/ai/conversations/:id`

Response `200`:

```json
{
  "id": "9f3a8614-72b2-4bb6-a4a4-5ba8af59e7a2",
  "householdId": "…",
  "userId": "…",
  "messages": [
    { "role": "user", "content": "…", "timestamp": "2026-07-12T14:09:58.000Z" },
    { "role": "assistant", "content": "…", "timestamp": "2026-07-12T14:10:00.000Z", "toolsUsed": ["get_spending_by_category"] }
  ],
  "createdAt": "2026-07-10T09:00:00.000Z",
  "updatedAt": "2026-07-12T14:10:00.000Z"
}
```

Messages oldest-first. `404 NOT_FOUND` ("Conversation not found") when absent OR
owned by another household/user — existence is not leaked cross-tenant.

### 7.3 `DELETE /api/ai/conversations/:id`

- Success: **`204 No Content` with an EMPTY body** (`ai.controller.ts:185`).
  **Client integration note:** the shared `apiCall` helper unconditionally calls
  `response.json()` and will throw on an empty 204 body — use a raw `fetch` (with CSRF
  header) or a 204-aware wrapper for this endpoint.
- `404 NOT_FOUND` when absent or cross-tenant. `400 VALIDATION_ERROR` for a non-UUID id.
- Messages are removed via `ON DELETE CASCADE`.

## 8. Security and Limits (verified values)

- Rate limit: 50 queries per household per rolling 24h window
  (`ai.middleware.ts:37-38`), Redis-backed when configured, in-process fallback
  otherwise (SCP-328).
- Token budget cap per request: 2000 default, `AI_REQUEST_TOKEN_BUDGET` env override
  (`ai.guardrails.ts:11,61`).
- Tool cap per request: 2 (`AI_TOOL_CALL_CAP`, `ai.guardrails.ts:12`).
- Provider: Gemini 2.0 Flash, 10s timeout, temperature 0.2 (`ai.gemini.ts:26-27,347`).
- Prompt-injection controls: input hardening + pattern blocklist + tool allowlist +
  Zod validation of ALL model-supplied tool args before any SQL filter
  (`ai.guardrails.ts`, `ai.validation.ts:237`).
- Every tool result passes the central PII sanitizer before reaching the provider;
  tools without a sanitizer branch fail closed (`ai.service.ts:471-485`).
- Every chat request writes an audit row (`entityType: 'ai_query'`) including tools
  used, truncated query/response, token count, honest `data_sanitized`, and timing
  (`ai.service.ts:297-316`); failures are audited too (`ai.service.ts:374-388`).

## 9. Notes

- API payloads sent to the provider and audit logs use sanitized summaries only.
- Internal IDs and PII must never be sent to the provider.
- Sanitized amounts are plain decimal strings (e.g. `"245.00"`) with currency supplied
  as context — not `MoneyDto` objects (see `SanitizedTransactionData` et al.,
  `ai.types.ts:174-275`).
