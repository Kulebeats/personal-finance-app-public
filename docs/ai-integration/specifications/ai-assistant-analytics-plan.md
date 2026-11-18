# Thandiso AI Analytics Plan

Version: 2.0  
Date: 2026-02-07  
Status: Canonical Analytics Plan

---

## 1. Query Lifecycle Events

- `ai_query_sent`: household_id, user_id_hash, conversation_id, message_length.
- `ai_query_success`: household_id, tools_used, token_count, latency_ms, cache_hit.
- `ai_query_failed`: household_id, error_code, latency_ms.
- `ai_provider_timeout`: household_id, latency_ms.
- `ai_tool_failure`: household_id, tool_name, error_code.

## 2. Safety and Privacy Events

- `ai_prompt_injection_blocked`: household_id, reason_code.
- `ai_pii_redaction_failure`: household_id, stage, reason_code (critical alert).
- `ai_token_cap_enforced`: household_id, capped_tokens.

## 3. Consent Events

- `ai_consent_granted`: household_id, user_id, consent_version.
- `ai_consent_revoked`: household_id, user_id.
- `ai_reconsent_required`: household_id, current_version, granted_version.

## 4. Rate Limit and Cache Events

- `ai_rate_limit_hit`: household_id, remaining_queries.
- `ai_cache_hit`: household_id, query_hash.
- `ai_cache_miss`: household_id, query_hash.

## 5. Provenance and Quality Events

- `ai_provenance_emitted`: household_id, tool_count, freshness_age_sec.
- `ai_feedback_submitted`: household_id, rating, category.
- `ai_eval_gate_result`: prompt_version, model_version, pass_fail, score.

## 6. Dashboards

- Adoption: consent rate, weekly active AI households.
- Quality: tool success, AI error rate, feedback score.
- Performance: P50/P95/P99 latency and timeout rates.
- Cost: cost/query, daily/monthly spend, cache efficiency.
- Safety: prompt-injection blocks, redaction failures.

## 7. Retention

- Audit records: 24 months.
- Analytics events: 12 months.
- Aggregates: retained for trend analysis.
