# Expanded SIP API baseline 39v

Independent Astra accepted bounded RED at exact clean `497c587aabaef5caed7609d4f55a104d6f6068e6`: **14 cases, 4 passed, 10 failed**, no pending/todo, exit 1. Thirty assertion messages do not mean thirty failing cases. All 19 evidence hashes match; no fixture/runtime/cleanup fault was found.

Raw evidence: `C:/Users/USER/.codex/worktrees/capital-sip-api-baseline39v/personal-finance-app/.local/astra-sip-api-red39v`. Fresh marked database `pfa_completion_scope_sipapi39v_test`, OID **1849372**, owned PostgreSQL18.6 at loopback55432, **29 migrations**, all six primary and nine scope counters zero PRE/POST. Pinned Node24.22.0; source clean PRE/POST. Reviewed wrapper SHA `808fee1f2d6ae459e6fc5b4a710373ced748b1ec80c522182b4d71382f13931d`; external boundary SHA `936255eed5022e82bf14d06adf6cf987603ca74e1f539ad12b94d3985f537102` unchanged.

The original eight cases preserve the bounded observations in the39u note. Added cases establish:

- **Concurrency failure:** two actual concurrent signed POSTs return200 with different plan IDs. The test stops there; persisted plan/grant/receipt/audit cardinality assertions were not reached.
- **Required audit failure:** synthetic audit-fault trigger is installed successfully, but POST returns200 instead of500. This establishes missing required audit/failure enforcement, not that an audit INSERT ran or was swallowed. Rollback snapshot and retry assertions were not reached; trigger cleanup completed.
- **Read/write role controls pass:** view_only and professional can GET the shared plan; POST/DELETE return403 without financial changes.
- **Original-custody precedence remains unexercised:** initial creation fails the missing-grant prerequisite before custody change or replay request.
- **Keyless pending rollover control passes:** create/list/deactivate, NULL authorization pointer, no grant/receipt/booked effects. This does not establish pending CREATE/deactivate audits, repeat no-op audit cardinality or keyed rollover replay. Those repair assertions are explicitly assigned.

Sol continues the API candidate; the second Sol lane owns direct SQL guard regressions. Root retains serialized protected execution and Astra independent review. Full SIP runtime, executor/proof, erasure, reconfirmation, UI and campaign acceptance remain open. No application source was integrated into canonical and no external gate changed.
