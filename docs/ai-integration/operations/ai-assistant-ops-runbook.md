# Thandiso AI Ops Runbook (MVP)

Version: 2.1
Date: 2026-07-12
Status: Canonical Ops Runbook

> **Status note (2026-07-12):** the `ai_assistant_*` feature flags referenced in the
> playbooks below are NOT implemented in code yet (see rollout plan §2). Until they
> land, the equivalent actions are: provider outage / PII risk → remove
> `GEMINI_API_KEY` (chat degrades to keyword fallback) or revoke consent per
> household; cost spike → lower `AI_REQUEST_TOKEN_BUDGET`.

---

## 1. Dashboards

- API errors and latency (P50/P95/P99).
- Tool success/failure by tool name.
- Cache hit/miss rates.
- Token and cost usage by environment and household.
- Consent changes and revocation spikes.
- Security controls (blocked prompt-injection attempts).

## 2. Alerts

- Error rate > 2% (5-minute window).
- P95 latency > 5s (10-minute window).
- Provider timeout ratio > 1% (10-minute window).
- Cost guardrail breaches by environment.
- Prompt-injection block spike anomaly.
- PII redaction validation failures (critical).

## 3. Triage Checklist

1. Confirm provider status.
2. Check recent deploy/config/prompt/model changes.
3. Inspect AI logs, audit events, and request IDs.
4. Validate cache and rate-limiter health.
5. Validate prompt-injection and sanitizer guard status.
6. Decide flag actions.

## 4. Incident Playbooks

### 4.1 Provider Outage

- Enable `ai_assistant_cache_only`.
- Keep `ai_assistant_enabled` on only if cached answers remain safe.
- Disable `ai_assistant_tools_enabled` if tool errors cascade.
- Return friendly fallback message.

### 4.2 PII Exposure Risk

- Disable `ai_assistant_enabled` immediately.
- Preserve evidence (audit logs, request IDs, model/prompt versions).
- Notify compliance and security owners.
- Trigger incident review and remediation workflow.

### 4.3 Cost Spike

- Reduce quota or tighten cohort gate (`ai_assistant_beta`).
- Enable `ai_assistant_cache_only`.
- Enforce stricter per-request token cap if needed.
- Disable expensive tool paths until stabilized.

### 4.4 Prompt Injection Campaign

- Keep allowlist mode enabled.
- Increase logging verbosity for blocked attempts.
- Temporarily reduce tool surface area via feature flag.

## 5. Post-Incident Review

- Timeline and root cause.
- Detection and response quality.
- Required code/test/docs updates.
- Regression tests added to prevent recurrence.
