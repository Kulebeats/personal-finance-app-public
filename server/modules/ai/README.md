# AI Module (`server/modules/ai`)

Server module for the Thandi AI assistant.

## Current API Surface

- `POST /api/ai/chat`
- `GET /api/ai/consent`
- `POST /api/ai/consent`
- `GET /api/ai/status`

Conversation endpoints exist as placeholders but are not part of MVP UX.

## Guardrails

- Auth + household scoping required.
- Consent required for chat.
- Household quota: 50/day.
- Input max length: 1000 chars.
- Token budget cap per request (default: 8000 via `AI_REQUEST_TOKEN_BUDGET`).
- Max 2 tool calls per query.
- Prompt-injection guardrails (input hardening + blocked intent handling).
- Tool allowlist enforcement before execution.
- Response provenance block (`dataWindow`, `freshnessTs`, `tools`).

## Eval Gate

- CI workflow: `.github/workflows/ai-eval-gate.yml`
- Local run: `npm run test:ai:eval`

## Privacy

- Outbound provider payloads must be sanitized.
- Audit logs store sanitized summaries only.
- Internal IDs and PII must not be sent externally.

## Key Files

- `ai.routes.ts`
- `ai.controller.ts`
- `ai.service.ts`
- `ai.analytics.service.ts`
- `ai.sanitizer.ts`
- `ai.cache.ts`
- `ai.middleware.ts`
- `ai.validation.ts`
- `ai.types.ts`
- `ai.tracking.ts`

## Documentation

- `docs/ai-integration/specifications/ai-assistant-master-requirements.md`
- `docs/ai-integration/specifications/ai-assistant-api-spec.md`
- `docs/ai-integration/specifications/ai-assistant-tool-specs.md`
- `docs/ai-integration/specifications/ai-assistant-testing-matrix.md`
