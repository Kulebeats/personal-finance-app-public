# Thandi AI Assistant — v1.1+ Implementation Plan

Version: 1.0
Date: 2026-07-17
Status: SIGNED OFF 2026-07-17 (Decision Gate §1) — implementation COMPLETE as of
2026-07-19. Workstream A shipped in PR #126, B in #136, C in #124 (extended by #127
and #135), E in #137. D required no work: OPEN-5 was resolved by product decision
(history stays readable after consent revoke). One optional item from C remains
unbuilt by choice — surfacing Retry-After through `apiCall` to skip the follow-up
GET /api/ai/status after a 429.
Baseline: v1 chat UI shipped in PR #120 (`feat/ai-assistant-chat-ui`,
`client/src/features/ai/`), built against the shipped server contract
(`ai-assistant-api-spec.md` v3.0, verified in `server/modules/ai/`).

Everything in this plan is grounded in code as it exists on main today; each
workstream lists the exact files it touches, its test plan (TDD, per repo
rules), risks, and a Definition of Done. Workstreams are independent unless a
dependency is stated.

---

## 0. Current State (what v1 delivers)

- Consent-first chat at `/advice`: role-aware gate (POST `/api/ai/consent` is
  admin+), non-streaming send, `conversationId` threading, latest-thread
  restore on mount, provenance captions, quota indicator, all 8 §5 states,
  WCAG 2.1 AA. 37 client tests; `src/features/ai/**` coverage-gated in CI
  (85/78/85/85 floor).
- Server (pre-existing, functional): 12 sanitized analytics tools, guardrails
  (2000-token budget, 2-tool cap, injection blocklist, Zod-validated tool
  args), per-household 50/day rate limit, full conversation persistence
  (household+user scoped), audit rows on every query.
- NOT in v1 (this plan): history-browsing UI, multi-turn context, timestamp
  display, naming unification, consent posture on stored history, 429
  ergonomics.

## 1. Decision Gate (product/legal sign-off needed BEFORE the workstreams)

| # | Decision | v1 default (shipped) | If reversed | Cost of reversal |
|---|---|---|---|---|
| OPEN-1 | History-browsing UI | No rail; restore latest thread only | Build Workstream A | Client-only, no server work |
| OPEN-2 | Provenance caption | Shown under every reply | Remove/collapse caption | Trivial |
| OPEN-3 | Multi-turn context | Descoped; copy sets expectations | Build Workstream B | Server + guardrails work |
| OPEN-4 | Thandi (UI) vs Thandiso (persona) | Both kept | One-line prompt edit OR UI rename | Trivial (Workstream E3) |
| OPEN-5 | History readable after consent revoke | Readable (consent gates external AI processing, not reads) | Gate conversation reads on consent (Workstream D) | Small server change + DPA copy |
| OPEN-6 | Data-training toggle | Out of scope (no such server control; Gemini calls are inference-only) | Requires new server capability + provider contract review | Large; not recommended |

Recommended order once signed off: **A → C → B → D/E** (A is pure client value
with zero server risk; C is a tiny server QoL fix; B is the only substantive
server change; D waits on legal; E is opportunistic polish).

---

## 2. Workstream A — Conversation History UI (OPEN-1) — client-only, size M

Server already ships everything needed: `GET /api/ai/conversations`
(paged `limit`/`offset`, `hasMore`, newest-first, previews),
`GET /api/ai/conversations/:id` (messages oldest-first),
`DELETE /api/ai/conversations/:id` (204, cascade), all household+user scoped
(Rule 11 enforced server-side in `ai.conversation.repository.ts`).

### A1. History panel
- New `client/src/features/ai/components/HistoryPanel.tsx` (<300 LOC):
  collapsible side rail on ≥lg viewports, sheet/drawer on mobile (reuse the
  app's existing Sheet primitive). Lists `preview` + relative `updatedAt` +
  `messageCount`. Infinite "Load more" via `hasMore` (10/page, matching the
  server default), TanStack `useInfiniteQuery` keyed
  `["aiConversations", "list"]`.
- Selecting a thread loads it via `fetchConversation(id)` and replaces the
  active transcript; `useThandiChat` gains
  `loadConversation(details: ConversationDetails)` (sets messages +
  `conversationIdRef`, marks interacted).

### A2. Delete with confirm
- `DELETE` returns **204 with an empty body — `apiCall` calls
  `response.json()` unconditionally and will throw**. Add
  `deleteConversation(id)` to `client/src/features/ai/api.ts` using a raw
  `fetch` with the CSRF header from `@/lib/csrf` (or extend `apiCall` with a
  204-aware branch — preferred, benefits the whole app; additive change in
  `client/src/lib/api.ts` mirroring the `error.fields` precedent).
- Confirm via the existing AlertDialog primitive. If the deleted thread is the
  active one, fall back to a fresh chat. Invalidate
  `["aiConversations", "list"]` and `["aiConversations", "latest"]`.

### A3. Tests (TDD, extend the existing fetch-router harness)
- List renders pages, Load more appends, `hasMore:false` hides the control.
- Selecting a thread swaps the transcript and threads the id on next send.
- Delete: confirm dialog, 204 handled (no throw), active-thread fallback,
  list invalidation. 404 on already-deleted → toast, list refresh.
- A11y: rail is a labeled `nav`/list, items are buttons, focus management on
  open/close (mobile sheet), delete confirm is focus-trapped.

### Risks / notes
- Keep `useThandiChat` under 300 LOC — if `loadConversation` pushes it over,
  extract the restore/threading logic to `useConversationThread.ts`.
- The latest-thread auto-restore (UI-AI-006a) and the rail must not fight:
  the rail's selection sets `interactedRef` so the mount-restore never
  clobbers it (mechanism already in place, race-tested in PR #120).

**DoD:** all states tested incl. 204 delete; coverage floor holds; CI green;
no server changes.

---

## 3. Workstream B — Multi-Turn Context (OPEN-3) — server, size L, Opus-tier

Today `ai.service.ts` sends ONLY the current message to Gemini
(`processQuery` → single-message contents); `conversationId` threads
persistence, not model context. US-AI-005's follow-up promise is therefore
unimplemented. This is the only workstream that changes what leaves the
household boundary, so it carries the Rule 4 obligations in full.

### B1. Design
- Feed the last N exchanges (suggest N=6 messages / 3 turns, config
  `AI_CONTEXT_MAX_MESSAGES`) from `aiMessages` into the provider call,
  oldest-first, ahead of the current message.
- **Token budget:** the shipped guardrail caps a request at 2000 tokens
  (`AI_REQUEST_TOKEN_BUDGET`, `ai.guardrails.ts`). History must fit INSIDE
  that cap: estimate tokens per message (existing estimator in guardrails),
  drop oldest-first until the current message + history + system prompt fit.
  Never raise the cap as a side effect.
- **Safety:** stored user messages are untrusted input replayed into a new
  prompt — re-run the prompt-injection blocklist over each history message at
  send time; drop (don't fail) messages that trip it, and log the drop.
  Assistant messages are re-sent verbatim (they were already
  sanitizer-derived).
- **Privacy:** history messages contain only what was already exposed in
  prior replies (sanitizer ran before persistence on the way in); no new PII
  surface. State this explicitly in the disclosure copy update.

### B2. Changes
- `server/modules/ai/ai.service.ts`: load history via
  `aiConversationService.get` when `conversationId` is supplied and owned;
  build multi-turn contents; include history token count in the budget check.
- `server/modules/ai/ai.gemini.ts`: `buildContents` accepts prior turns
  (user/model roles).
- `server/modules/ai/ai.guardrails.ts`: history-aware budget + per-message
  injection re-scan helper.
- Audit (`entityType: 'ai_query'`): add `context_messages` count and the
  post-trim token estimate to `details` — DPA visibility on what was sent.
- Client: delete the "Each question is answered on its own" empty-state copy
  (`AdviceChat.tsx`) and the UI-AI-003f caveat; update
  `ai-assistant-client-ui-spec.md` and US-AI-005 traceability.

### B3. Tests
- Unit: budget trimming (drops oldest first, current message always
  survives), injection-tripping history message dropped + logged, N cap.
- Real-DB integration (per Rule 17 — real HTTP against real Postgres, pattern
  of `ai.conversation.persistence.db.test.ts`): two-turn conversation → the
  second provider call's contents include turn one; revoked-consent and
  foreign-conversation ids never leak history.
- Eval-pack: add follow-up-question cases ("what about last month?") to
  `ai.eval-pack.ts`.

### Risks
- Token cost per query grows ~2-4×; the 50/day household cap bounds spend,
  but note it in the ops runbook cost section.
- Provider timeout is 10s; larger prompts nudge latency — keep N modest.

**DoD:** real-DB tests green in CI; audit rows show context counts; disclosure
copy updated; client caveat removed only after server ships.

---

## 4. Workstream C — 429 Ergonomics (no OPEN gate) — server, size S

The rate limiter throws BEFORE setting `X-RateLimit-*` headers
(`ai.middleware.ts`), so a 429 carries no reset information and no
`Retry-After`; the client compensates with an extra `GET /api/ai/status`
round-trip (shipped in PR #120).

- Set `X-RateLimit-Limit/Remaining/Reset` and `Retry-After` on the 429
  response path in `ai.middleware.ts` before the `RateLimitError` is thrown
  (attach to `res` in the catch/limit branch).
- Client follow-up (optional, after server ships): read `Retry-After` from
  the error response in `useThandiChat` and skip the status refetch when
  present. Requires exposing response headers through `apiCall` — additive,
  mirror the `error.fields` pattern (`error.retryAfter`).
- Tests: middleware unit test asserting headers on the 429; client hook test
  for the header-present path (keep the status-refetch fallback and its test
  — older deployments and other error paths still need it).

**DoD:** spec §3.3 updated (the "headers ABSENT on 429" CORRECTED note gets a
dated supersession), both tests green.

---

## 5. Workstream D — Consent Posture on Stored History (OPEN-5) — blocked on legal

Only if DPA/legal decides revoked households must lose read access:
- Add `consentCheckMiddleware` to the three conversation routes in
  `ai.routes.ts` (currently consent gates `/chat` only — deliberate, per
  api-spec §2 CORRECTED note).
- Decide data disposition on revoke: retain-but-hide (middleware only) vs
  purge (delete rows on revoke — needs an audit row and a grace period).
  Recommend retain-but-hide; purge interacts with the 24-month audit
  retention commitment.
- Update `ai-assistant-consent-disclosure-copy.md` (it already mentions
  stored history) and the client: the gate state must also hide the History
  panel (Workstream A) when consent is absent.
- Tests: real-DB — revoke → list/get/delete return 403; re-grant → history
  intact (retain-but-hide).

**DoD:** legal sign-off recorded in the master requirements OPEN-5 entry;
tests green; disclosure copy versioned (bump `CURRENT_CONSENT_VERSION` →
forces re-consent, which the shipped `needsReconsent` flow already handles).

---

## 6. Workstream E — Polish (size S each, batchable)

- **E1 Timestamps:** show a muted relative time on hover/focus per bubble
  (data already in `ThandiMessage.timestamp`, incl. restored threads). A11y:
  `<time dateTime=…>`.
- **E2 Quota meter:** replace the plain "N questions left today" text with a
  subtle meter at <10 remaining; already-tested `formatRelativeReset` covers
  the copy.
- **E3 Naming (OPEN-4):** if product wants unification, prefer changing the
  system-prompt persona string in `ai.gemini.ts` ("Thandiso" → "Thandi") —
  one line, no UI churn, no consent-version bump.
- **E4 Availability honesty:** `GET /api/ai/status` hardcodes
  `available: true` even with no `GEMINI_API_KEY` (keyword-matching fallback
  answers instead). Either wire `available` to real provider configuration or
  add a `degraded: boolean`; then the client may show a "answers may be
  limited" notice. Server change is trivial; decide the product stance first
  (silent fallback was a deliberate choice).

---

## 7. Sequencing, Routing, and Standing Rules

| Order | Item | Depends on | Suggested routing |
|---|---|---|---|
| 0 | Decision Gate sign-off | user | — |
| 1 | A (history UI) | OPEN-1 yes | Sonnet (client-only, pattern established) |
| 2 | C (429 headers) | none | Sonnet (mechanical) |
| 3 | B (multi-turn) | OPEN-3 yes | Opus (guardrails/privacy-critical) + verifier pass |
| 4 | D (consent posture) | legal | Opus (DPA-critical) |
| 5 | E1-E4 | none | Sonnet, batch into one PR |

Standing rules for every workstream (repo CLAUDE.md): TDD with RED verified;
real-DB integration tests for any server change; zero `any`; components
<300 LOC / server files <500 LOC; audit rows for anything that changes what
leaves the household boundary; `npm run check` + full suites + CI green before
merge; adversarial verifier pass before claiming done; one conventional-commit
PR per workstream.
