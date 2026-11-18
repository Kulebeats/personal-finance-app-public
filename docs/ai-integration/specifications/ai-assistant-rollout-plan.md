# Thandiso AI Rollout Plan

Version: 2.0  
Date: 2026-02-07  
Status: Canonical Rollout Plan

---

## 1. Goals

- Deliver user value safely.
- Keep latency and quality within launch gates.
- Prevent cost and privacy regressions during rollout.

## 2. Feature Flags

> **Status (2026-07-12, code-verified):** none of these flags exist in code yet.
> Until they land, the only operational levers are removing `GEMINI_API_KEY`
> (chat degrades to the keyword fallback) and revoking household consent.
> Implementing them is a prerequisite for the beta phase (§4).

- `ai_assistant_enabled`: global kill switch.
- `ai_assistant_beta`: cohort gate.
- `ai_assistant_cache_only`: serve cache paths only, no provider call.
- `ai_assistant_tools_enabled`: enable/disable tool execution route.

## 3. Prerequisites

- Consent flow live and audited.
- Rate limiting and token cap enforcement.
- Sanitized audit logging verified.
- Dashboards and alerts configured.
- Eval pack baseline created and passing.

## 4. Phases

1. Internal QA:
   - Staff-only access.
   - Validate correctness, guardrails, and incidents playbooks.
2. Beta:
   - Limited cohort + tighter quota.
   - Watch quality, latency, and safety metrics daily.
3. Public MVP:
   - Standard quota (50/day household).
   - Keep feature flags available for rapid rollback.
4. Primary enhancement stage:
   - Enable provenance in response contract (v1.1).
   - Enforce eval-gated prompt/model changes.

## 5. Success Criteria

Launch gate criteria:
- Error rate < 2%.
- P95 latency < 5s.
- Tool success rate >= 95%.
- No confirmed PII incidents.

90-day targets:
- Tool success >= 98%.
- Cost/query <= $0.01.

## 6. Cost Guardrails by Environment

| Environment | Soft Alert | Hard Action |
|---|---:|---:|
| dev | $5/day | $10/day |
| beta | $15/day | $25/day |
| prod (<500 households) | $20/day | $30/day |

Monthly early-production target: <= $500.

## 7. Rollback Procedure

1. Disable `ai_assistant_enabled`.
2. Preserve audit logs and request correlation IDs.
3. Notify support and stakeholders.
4. Publish incident summary and remediation plan.

## 8. Communication

- Announce each phase transition.
- Announce quota or behavior changes.
- Share safety and performance status to support team.
