# agents.md - Thandiso AI Integration Guidance

Purpose:
- Defines working rules for Thandiso implementation work.
- Aligned to canonical AI docs under `docs/ai-integration`.

## Canonical Documentation Rule

Primary source:
- `docs/ai-integration/specifications/ai-assistant-master-requirements.md`

Mirror files under `docs/specifications` and `docs/architecture` are pointers only.

## Product and UX

- Assistant name: Thandiso
- UI title: Thandi (AI Assistant)
- Entry route: `/advice`
- MVP layout: single-panel Advice page (no floating bubble, no left history rail)

## MVP Decisions

- Model: Gemini 2.0 Flash
- Response mode: non-streaming
- Rate limit: 50/day per household
- Conversations persist server-side per (household, user) — SCP-338; the history-browsing
  UI shipped in PR #126 (OPEN-1). Model context is multi-turn as of PR #136 (OPEN-3):
  prior turns of the thread are replayed to the provider, injection-rescanned and
  token-trimmed newest-first.
- Requester-only visibility
- Timeout: 10 seconds (provider call)

## Required Engineering Rules

- Use Money class for monetary values.
- No `any` types in AI module.
- Enforce consent + rate limits on AI endpoints.
- Sanitize PII before external provider calls.
- Log sanitized audit records only.
- Enforce max 2 tools/query.
- Enforce request token cap.
- Use prompt-injection allowlist controls.

## Feature Flags (planned — not implemented in code as of 2026-07-12)

- `ai_assistant_enabled`
- `ai_assistant_beta`
- `ai_assistant_cache_only`
- `ai_assistant_tools_enabled`

## Required Docs to Keep Aligned

- `docs/ai-integration/prd/ai-assistant-prd.md`
- `docs/ai-integration/specifications/ai-assistant-srs.md`
- `docs/ai-integration/specifications/ai-assistant-api-spec.md`
- `docs/ai-integration/specifications/ai-assistant-client-ui-spec.md`
- `docs/ai-integration/specifications/ai-assistant-tool-specs.md`
- `docs/ai-integration/specifications/ai-assistant-testing-matrix.md`
- `docs/ai-integration/specifications/ai-assistant-rollout-plan.md`
- `docs/ai-integration/operations/ai-assistant-ops-runbook.md`
