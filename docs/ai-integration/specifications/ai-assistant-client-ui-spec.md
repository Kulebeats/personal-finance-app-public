# Thandi Chat UI — Client Requirements Specification (v1)

Version: 1.1
Date: 2026-07-17 (v1.0: 2026-07-12)
Status: Canonical Client UI Requirements — IMPLEMENTED by PR #120
(`feat/ai-assistant-chat-ui`, `client/src/features/ai/`); v1.1 adds the
implementation reconciliations noted inline (UI-AI-003c error handling,
UI-AI-006a timestamp display)

Contract of record: `docs/ai-integration/specifications/ai-assistant-api-spec.md` (v3.0,
verified against `server/modules/ai/` on main @ 1da9446). Every requirement below is
implementable with endpoints that exist today; nothing here requires server changes.

Naming: the page/product display name is **"Thandi (AI Assistant)"**; the assistant's
system-prompt persona is "Thandiso" (`ai.gemini.ts:266`). See OPEN-2 in the master
requirements if product wants these unified.

---

## 1. Placement and Entry (UI-AI-001)

- **UI-AI-001a** The chat UI replaces the static content of the existing `/advice`
  page (`client/src/pages/Advice.tsx`, routed in `client/src/App.tsx:88`). The route,
  lazy-loading, and error boundary wiring stay as-is.
- **UI-AI-001b** Page title stays "Thandi (AI Assistant)". The existing three info
  cards (read-only, consent, quota) may be kept above or collapsed behind an "About"
  affordance — DECIDED: collapse into a single dismissible intro block above the chat
  so the conversation owns the page.
- **UI-AI-001c** Layout: single-panel conversation (message list + composer), max
  content width consistent with other pages (`Layout` component). No floating chat
  bubble, no left history rail in v1 (master requirements §9).

## 2. Consent-First Flow (UI-AI-002)

- **UI-AI-002a** On mount, resolve consent via the existing `useAIConsent()` hook
  (`client/src/hooks/use-settings.ts:2038`, GET `/api/ai/consent`, raw JSON).
- **UI-AI-002b** While consent is `false`: render the consent gate INSTEAD of the
  composer. Gate copy comes from
  `docs/ai-integration/specifications/ai-assistant-consent-disclosure-copy.md`
  ("First-Use Consent Modal" section, rendered inline rather than as a modal —
  DECIDED: inline panel; a modal adds a step with no benefit on a dedicated page).
- **UI-AI-002c** Role-aware actions: POST `/api/ai/consent` is **admin+ only**.
  - Admin/owner: show "Enable Thandi" primary button that calls
    `useUpdateAIConsent()` (`use-settings.ts:2046`).
  - Member (non-admin): show the disclosure plus a non-actionable notice: "Ask a
    household admin to enable Thandi in Settings." Do NOT render a button that will
    403.
- **UI-AI-002d** `needsReconsent === true`: treat as consent-absent (gate shown) with
  copy variant "Our AI disclosure has been updated — please review and re-consent."
- **UI-AI-002e** If a chat request returns `403 FORBIDDEN` mid-session (consent
  revoked concurrently), invalidate the `["aiConsent"]` query and fall back to the
  gate state.

## 3. Conversation Surface (UI-AI-003)

- **UI-AI-003a** Message list: user messages right-aligned, assistant messages
  left-aligned, both in bubbles with role labels for screen readers. Assistant reply
  text renders as plain text with preserved line breaks (`white-space: pre-wrap`).
  No markdown rendering in v1 (server replies are plain text; revisit if prompt
  changes) and NEVER `dangerouslySetInnerHTML`.
- **UI-AI-003b** Composer: single-line textarea that grows to max 4 rows; Enter
  sends, Shift+Enter inserts newline. Client-side mirror of server validation:
  disable Send when empty/whitespace; hard cap 1000 chars with a live counter
  starting at 900 chars.
- **UI-AI-003c** Send flow (non-streaming per shipped server — single JSON response):
  1. Append the user bubble immediately (optimistic).
  2. Show an assistant "typing" placeholder (animated ellipsis) while the request is
     in flight; disable the composer.
  3. On `200`, replace the placeholder with `reply`; store the returned
     `conversationId` in component state and send it with every subsequent message so
     the server threads one conversation.
  4. On error, remove the placeholder and show the mapped error state (§5).
     Reconciliation with §5.6 (as implemented in PR #120): for errors where the
     message was NOT accepted (400 validation, 429 quota, 403 consent, 401),
     the optimistic user bubble is removed and the text is restored to the
     composer for editing; for outages (500/network, state 5.6) the user
     message STAYS in the transcript and a Retry control resubmits it.
  Requests go through the shared `apiCall` helper (`client/src/lib/api.ts:331`) —
  it attaches CSRF and handles `CSRF_INVALID` retry. Response is RAW JSON (no
  envelope unwrap).
- **UI-AI-003d** "New chat" button clears the message list and the stored
  `conversationId` (the next send creates a new server thread). It does not call any
  endpoint.
- **UI-AI-003e** Suggested prompts: when the message list is empty (and consent is
  granted), show 3–4 tappable suggestion chips that submit on click. DECIDED initial
  set: "How is my budget this month?", "What are my top spending categories?",
  "What bills are coming up?", "How are my savings goals doing?" (each maps to a
  shipped tool).
- **UI-AI-003f** Multi-turn context (OPEN-3, shipped): the server DOES feed recent
  messages from the current conversation to the model — up to
  `AI_CONTEXT_MAX_MESSAGES` (default 6 messages / 3 turns), oldest-first, trimmed to
  fit inside the existing 2000-token request budget. Follow-ups such as "what about
  last month?" therefore resolve. The empty-state helper text reads: "Ask a follow-up
  any time — recent messages in this conversation are used for context."
  - Context is only ever loaded for a conversation the caller owns; an unowned or
    unknown `conversationId` yields zero history (the request still succeeds, just
    single-turn).
  - **No new PII surface:** replayed history contains only content that prior replies
    already exposed to this household — the sanitiser ran before persistence on the
    way in. Multi-turn context does not widen what leaves the household boundary
    beyond what the user has already seen.
  - Stored user messages are re-scanned against the prompt-injection blocklist at
    send time; a tripping message is silently dropped from the replay (the request is
    not failed).

## 4. Reply Metadata, Amounts, and Money Formatting (UI-AI-004)

- **UI-AI-004a** Amounts arrive embedded in `reply` text, already expressed in the
  household currency by the server. The client renders them verbatim — there are no
  structured amount fields in the chat payload to re-format.
- **UI-AI-004b** If the UI adds any structured numeric display of its own (e.g. a
  quota meter is fine; a computed amount is not expected in v1), any money value MUST
  go through the client formatter `formatCurrency` (`client/src/lib/format.ts:23`) /
  `useFormat()` — never ad-hoc `toFixed`/`parseFloat` formatting (CLAUDE.md Rule 1).
- **UI-AI-004c** Provenance line: under each assistant reply, render a muted caption
  from the always-present `provenance` block: "Based on: {tools, humanized} ·
  {dataWindow.start} – {dataWindow.end}". Humanized tool names map from the 12 tool
  ids (e.g. `get_spending_by_category` → "spending by category"). Hidden when
  `provenance.tools` is empty. (Subject to OPEN-2 in master requirements; DEFAULT is
  to ship it.)
- **UI-AI-004d** Quota indicator: show "N questions left today" in the page header,
  seeded from GET `/api/ai/status` (`rateLimit.remaining`) on mount and updated from
  each chat response's `remainingQueries`. When 0, pre-emptively disable the composer
  with the quota state (§5.4).

## 5. States (UI-AI-005) — exhaustive, mapped to real contract

| # | State | Trigger (contract) | Required UI |
|---|---|---|---|
| 5.1 | Empty | consent granted, no messages | suggested prompts + expectation-setting helper text (UI-AI-003e/f) |
| 5.2 | Loading | chat request in flight | typing placeholder, composer disabled, Send shows spinner |
| 5.3 | Validation | `400 VALIDATION_ERROR` | inline composer error using `error.fields[0].message`; keep text |
| 5.4 | Quota exhausted | `429 RATE_LIMIT_EXCEEDED` OR `remainingQueries === 0` | banner "Daily limit reached (50/day per household)." Since a 429 carries NO rate-limit headers, fetch GET `/api/ai/status` for `resetTime` and show "Resets {relative time}". Composer disabled until reset |
| 5.5 | Consent absent | `403 FORBIDDEN` on chat, or `consentGiven:false` | consent gate (UI-AI-002) |
| 5.6 | API outage | `500 INTERNAL_ERROR` ("Failed to process AI query") or network failure | assistant-side error bubble "Thandi couldn't answer that right now." + Retry button that resubmits the same message; user message stays in the transcript |
| 5.7 | Unauthenticated | `401 UNAUTHORIZED` | existing app-wide session-expiry handling (redirect to login); no chat-specific UI |
| 5.8 | Guardrail refusal | `200` with fixed refusal/budget reply | render as a normal assistant reply — NOT an error (api-spec §3.2) |

Note: do NOT key an "AI unavailable" state off GET `/api/ai/status` `available` — it
is hardcoded `true` (api-spec §4).

## 6. Conversation History (UI-AI-006) — server-supported, UI deferred

The server fully supports history (list/get/delete, per-user scoped — api-spec §7).
Whether v1 ships a browsing UI is OPEN-1 in the master requirements.

- **UI-AI-006a (v1 default, pending OPEN-1):** no history rail. The active thread
  lives in memory for the page session; "New chat" starts a fresh thread. On revisit,
  the page MAY restore the most recent thread via
  `GET /api/ai/conversations?limit=1` then `GET /api/ai/conversations/:id` —
  DECIDED: yes, restore the latest thread on mount (cheap continuity win, zero new
  server work). Restored messages carry their persisted `timestamp`s in
  client state; v1 bubbles do not DISPLAY timestamps (visual design decision,
  PR #120) — displaying them is a v1.1 polish item.
- **UI-AI-006b** If OPEN-1 lands as "ship history browsing", the rail uses
  `GET /api/ai/conversations` (paged 10/page via `limit`/`offset`, `hasMore`) and
  `DELETE /api/ai/conversations/:id` with a confirm dialog. **Delete returns
  `204 No Content` with an empty body — `apiCall` will throw on `.json()`; use a
  204-aware fetch for this one call** (api-spec §7.3).

## 7. Accessibility (UI-AI-007) — WCAG 2.1 AA

- **UI-AI-007a** The message list is `role="log"` with `aria-live="polite"` so new
  assistant replies (single-shot, non-streaming) are announced once, in full.
  `aria-busy="true"` on the log while a request is in flight.
- **UI-AI-007b** Composer textarea has a visible label or `aria-label="Ask Thandi a
  question"`; Send button is a real `<button type="submit">` inside a `<form>`.
- **UI-AI-007c** Full keyboard operability: suggestion chips, New chat, Retry, and
  consent actions are focusable buttons; focus returns to the composer after a reply
  arrives; no focus traps.
- **UI-AI-007d** Error and quota banners use `role="alert"` (assertive) since they
  block the next action.
- **UI-AI-007e** Bubbles must not rely on color alone: include visually-hidden
  "You:" / "Thandi:" prefixes for screen readers.
- **UI-AI-007f** Typing indicator has `aria-hidden="true"` (the `aria-busy` log state
  conveys it); animations respect `prefers-reduced-motion`.

## 8. Component and Code Constraints (UI-AI-008)

- **UI-AI-008a** New components live under `client/src/features/ai/` (feature-module
  convention), each <300 LOC (CLAUDE.md Rule 2): suggested split —
  `AdviceChat.tsx` (container), `MessageList.tsx`, `MessageBubble.tsx`,
  `ChatComposer.tsx`, `ConsentGate.tsx`, plus a `useThandiChat.ts` hook owning
  send/state/quota logic.
- **UI-AI-008b** Server state via TanStack Query (consent, status, history restore);
  in-flight chat send via a mutation. No `any` types (Rule 16). Types for the chat
  payloads mirror `server/modules/ai/ai.types.ts` (`ChatResponse`,
  `ConversationListResponse`, `ConversationDetails`, `Message`) — declare them in the
  client (or a shared module) field-for-field; do not invent fields.
- **UI-AI-008c** Tests (Rule 17, UI ≥50%): consent-gate branching by role, send
  happy path, each state row in §5 (mock fetch per
  `client-test-rot-patterns` conventions), a11y smoke (labels/roles present).

## 9. Traceability

Requirement IDs UI-AI-001 … UI-AI-008 are mapped to endpoints and test rows in
`docs/ai-integration/specifications/ai-assistant-requirements-traceability.md` and
test groups T-UI-1 … T-UI-8 in
`docs/ai-integration/specifications/ai-assistant-testing-matrix.md` §6.
