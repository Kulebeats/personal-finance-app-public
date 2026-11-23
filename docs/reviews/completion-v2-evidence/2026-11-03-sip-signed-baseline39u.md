# SIP signed caller baseline after migration 0028

Independent Astra accepted **valid bounded RED** at exact clean `0c8893547095d10c487de04268cc84df6a27fb3d`: eight cases, one pass, seven failures, command exit 1. The 27 assertion messages are not 27 test cases. No fixture, setup or cleanup failure was found.

Raw evidence: `C:/Users/USER/.codex/worktrees/capital-sip-populated-rehearsal-nov03/personal-finance-app/.local/astra-sip-signed-red39u`. All 19 manifest hashes were independently verified. Runtime was pinned Node 24.22.0. Fresh marked target `pfa_completion_scope_sipsigned39u_test`, OID **1846279**, loopback port **55432**, contained **29 migrations**. All six primary and nine scope counters were zero before and after. Source remained clean. The reviewed external boundary SQL hash remained `936255eed5022e82bf14d06adf6cf987603ca74e1f539ad12b94d3985f537102`.

| Case | Actual evidence and limits |
| --- | --- |
| Shared owner control | Existing signed purchase executes successfully; this does not prove a durable grant or completed proof. |
| Private owner | POST succeeds; executor refuses twice, no holding/BUY/lot and schedule unchanged. |
| Peer create | Returns 200 and persists private plan; absent-account control returns 500. |
| Peer list | Exposes owner-private plan/account identifiers. |
| Peer deactivate | Returns 200 and changes active flag; absent-plan control returns 500. |
| Required operation key | Missing/undefined key returns 200. Hard assertion stops before null/empty/malformed/numeric variants and no-effects checks. Those remain unexecuted. |
| Equivalent replay | Initial signed POST creates a plan, then fails because authorization rows are empty. The second request, pointer/receipt/audit assertions remain unexecuted. |
| Changed-intent conflict | Same missing-grant prerequisite failure before the changed-intent request. Actual 409 behavior remains untested. |

The last two failures demonstrate missing-grant prerequisites, not observed replay/conflict behavior. All remaining oracles are preserved for implementation verification; no unchanged rerun is planned.

Sol now owns a bounded API slice in the existing authorization candidate: real signed source privacy/capability, original identity capture, atomic plan/grant/pointer/operation/audit and key/replay behavior. Executor, erasure, reconfirmation, UI and adversarial/race coverage remain open. Root retains protected runtime windows and Astra independent acceptance. No canonical application integration, production/shared database, external delivery or release action occurred.

## Next API slice contract and ownership

Independent review approved test-only `497c587aabaef5caed7609d4f55a104d6f6068e6`: six additional cases, fourteen total. They cover concurrent same-key creation, actual audit-insert failure rollback and retry, read-versus-write roles, original-source privacy before conflict disclosure, and pending rollover compatibility. These additions remain unexecuted at this checkpoint. Root preserved a detached baseline at `C:/Users/USER/.codex/worktrees/capital-sip-api-baseline39v/personal-finance-app` before product edits.

The request-intent digest is distinct from the seven-field retained-proof digest. Create binds version/action/type/account/instrument/exact amount/currency/frequency/requested date; reconfirm also binds target plan and expected revision. Replay must recheck the original actor/session and original source before reporting conflict, and must not restore an old authorization pointer or reset an advanced schedule.

A pointer alone supports only `authorization_recorded`, not an executable readiness claim. Complete current identity/generation/membership/source/type/terms readiness remains required before final UI and product acceptance. GET preserves financial-read roles; writes require financial-write capability.

The governing contract adds a mandatory operation key specifically to SIP creation. Existing keyless pending-rollover creation remains compatible under signed source access and one atomic creation audit, without a SIP grant or executable claim; a supplied key uses the bound nullable-grant receipt. Pending-plan audit uses actor-only `recurring_investment` plus plan ID and `authorizationEvent: pending_plan_v1`; grant events use actor-only `investment_plan_authorization` plus grant ID and a version tag. Neither copies economic terms or retry keys. Erasure must explicitly purge both operational event families while retaining completed financial history. Independent Astra found these choices consistent with the approved contract.

Sol API ownership remains the authorization checkout. A second explicitly selected Sol lane owns only direct-SQL guard tests in `capital-sip-adverse-sql-nov03/personal-finance-app` from schema502493f8. Direct-SQL fixtures establish constraint mechanics, not real signed authorization. Root alone schedules protected execution; no new packet or release acceptance is implied.
