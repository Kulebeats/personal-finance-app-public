# Dynamic Workflows for the cross-cutting sweeps

Dynamic Workflows let Claude Code plan a fan-out, run tens to hundreds of parallel
subagents, have other subagents try to refute their findings, and iterate until the
answers converge. It is built for exactly this kind of work: widespread defects, large
migrations, and security audits across many files. On the Max plan it is on by default.

Use a workflow when a single defect class spans many of the 22 modules. Use `/goal`
(see ../goals/goal-library.md) when you are drilling into one fix.

## How to run one
- Either include the word "workflow" in your prompt, or enable the `ultracode` setting.
- The first time a workflow triggers, Claude Code shows the plan and asks you to confirm.
  Read it. Confirm only if the scope and the per-stage exit criteria are right.
- Set a turn/budget cap in the prompt. There is no hard per-run spend cap, so cap it
  yourself and watch the status panel. Do not start an open-ended sweep before stepping away.

## Precondition (do not skip)
A workflow verifies against your tests and CI. The audit found those are currently
unreliable. Run the security and deploy sweeps any time, but DO NOT run the correctness
sweeps below until CI is green and the mock-theater tests are replaced (Phase 2), or the
workflow will manufacture false green faster.

## The sweep prompts

### S1 - Security sweep (safe to run early)
> Create a workflow that audits the codebase for the security findings in the audit:
> `trust proxy` not set in production code, unauthenticated `express.static("/uploads")`
> serving PII, and DB pool with no SSL. For each, apply the fix and add a test that proves
> it. Fan out per finding, refute each fix against its test, iterate until convergence.
> Cap at 60 turns total.

### S2 - Atomicity sweep (Phase 2+ only, after CI is real)
> Create a workflow that finds every non-atomic multi-table or multi-row write across the
> 22 modules (delete-then-insert, sequential writes with no withTransaction, default-toggles,
> ownership/role changes, recurring batch). Wrap each in a transaction with the right
> FOR UPDATE locks, and add a real-DB test proving exactly-once outcome under concurrency.
> Fan out per module, refute each fix, iterate until the full server suite is green.

### S3 - Audit-logging sweep (Phase 2+ only)
> Create a workflow that finds every financial create/update/delete and data-export path
> (including GRZ, reports CSV, weekly-recap email) that writes no audit_logs row. Add
> service-layer BusinessAuditService logging and, for email, a consent gate. Add a test per
> path asserting the audit row. Refute each, iterate until green.

### S4 - Money sweep (Phase 2+ only)
> Create a workflow that finds raw float money math (parseFloat, Number(amount), .toFixed,
> amount*rate) and silent FX rate=1 fallbacks across server and client. Convert each to the
> Money class / sumMoneyDto and make missing FX an explicit logged error. Add a to-the-cent
> test per path. Refute each, iterate until green.

### S5 - Module deep-audit sweep
> Create a workflow that deep-audits the remaining modules against CLAUDE.md invariants
> (atomicity, audit logging, money, authorization, visibility, Rules-of-Hooks) and produces a
> per-module findings list with an effort estimate, without editing code. Use this to refresh
> the Linear backlog, then fix via /goal per finding.
