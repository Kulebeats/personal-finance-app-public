# Production-Readiness Remediation Playbook

**Repository:** Personal Finance App (DPA-regulated, GRZ securities)
**Owner:** Kuwani Banda (solo maintainer)
**Basis:** Independent multi-agent audit, 2026-06-04
**Toolchain:** Claude Code on Max, Opus 4.8, Dynamic Workflows, `/goal`, Linear

---

## 1. What this package is

This is the one-stop remediation system for the audit findings. It turns Claude Code from a
code generator into a verification-first remediation team. The pieces:

| Path | Role |
|---|---|
| `.claude/CLAUDE.md` | The constitution. Rules, invariants, Definition of Done. Read by every session, subagent, and workflow. |
| `.claude/settings.json` + `.claude/hooks/` | Deterministic gates. A fix cannot be declared done while the repo is red; float-money and `as any` are blocked at write time; secrets are blocked at commit. |
| `.claude/agents/` | The working team: fintech-money, concurrency, dpa-compliance, infra-deploy, test-builder, and an adversarial verifier. |
| `.claude/skills/` | Repeatable fix patterns for the recurring defect classes (atomicity, audit logging, money, real-DB tests). |
| `.claude/workflows/README.md` | Dynamic-workflow sweep prompts for defect classes that span many modules. |
| `.claude/goals/goal-library.md` | Ready `/goal` conditions per P0/P1, each tied to a verifiable artifact, each capped. |
| `.github/workflows/ci.yml` | The keystone CI gate against ephemeral Postgres. |
| `LINEAR-IMPORT.md` | The backlog structure that replaces the lying status docs. |

We are presenting this as a working draft. The foundational files (CLAUDE.md, hooks, CI)
are drop-in ready. The agent, skill, goal, and workflow files are tuned to the audit's
specifics and should be refined against the actual code on first use, since this package was
built from the audit, not from the repository.

## 2. The operating principle

The audit's headline is not the 238 failing tests. It is that the previous pass claimed
"213/213 fixed, 100% production-ready" and the claim was false. The enemy is completion
theater, and AI coding agents are structurally prone to it.

So this system is built verification-first. The rule, encoded in CLAUDE.md as the Prime
Directive: a completion claim is an unverified hypothesis until proven against code and a
passing test in CI. Three features now do most of the enforcing that a person used to do
by hand:

- Hooks make "done while red" mechanically impossible.
- `/goal` separates the agent that works from the evaluator that decides it is done.
- Dynamic Workflows fan out across many files and have other subagents refute each finding
  until they converge.

## 3. The architecture

```
        CI (GitHub Actions + ephemeral Postgres)   <- external ground truth
                         ^
                         | every fix is gated here
                         |
   Stop hook  ----------- forbids ending a turn while check/core tests are red
        ^
        |
   /goal  --------------- drives one fix until its artifact-tied condition is green
        ^
        |
   Dynamic Workflow ----- fans out one defect class across the 22 modules,
                          refutes each fix, iterates until convergence
        ^
        |
   Subagent team -------- fintech-money, concurrency, dpa-compliance, infra-deploy,
                          test-builder, and the verifier
        ^
        |
   CLAUDE.md + hooks ---- the invariants and the write-time / commit-time guards

   Linear --------------- the single source of truth for status (not docs/)
```

The critical dependency: workflows and `/goal` verify against your tests and CI. The audit
says those are currently fiction. Until CI is real and the mock-theater tests are replaced,
autonomous loops manufacture false green faster. That is why the sequence below is fixed.

## 4. The sequence

Mirrors the audit's recommended order. Each phase names the agent, the workflow or goals to
use, and the exit criterion.

### Phase 0 - Make the work verifiable (do first)
1. **Reconcile the deploy target.** The backend is not deployed today. Use the infra-deploy
   agent to surface options (a host that runs the Express server, DB, sessions, cron) and
   decide with eyes open; this is judgment, not an autonomous goal. Produce the runbook.
2. **Stand up CI.** Drop in `ci.yml`, adjust the script and env names to the repo, and prove
   it runs on a trivial PR. Use the Phase 0 CI goal.
   - Exit: a PR shows check + both suites running against Postgres.

### Phase 1 - DPA-critical and crash-level P0s
Run the dpa-compliance and fintech-money agents under `/goal`, one condition at a time:
AI PII sanitisation, GRZ Money + audit logging, the Dashboard Rules-of-Hooks crash, the
household ownership split-brain. Safe to also run the **S1 security sweep** workflow here.
- Exit: each P0 goal green in CI; verifier returns PASS on each.

### Phase 2 - Concurrency, correctness, and test reality
With CI real, the correctness sweeps become trustworthy. Run the test-builder agent to build
real-DB suites for Goals, Transactions, Investments and to fix the client runner, then run the
**S2 atomicity**, **S3 audit-logging**, and **S4 money** workflows. Delete the mock-theater
concurrency tests. Work the Phase 2 goals (transactions concurrency, goals calc, settings
erasure).
- Exit: server and client suites green in CI; coverage thresholds include financial folders.

### Phase 3 - Remaining modules and polish
Run the **S5 module deep-audit sweep** to refresh the Linear backlog for the long tail, fix
each via `/goal`. Then dark-mode CSS variables, aria-labels, LOC splits, bundle code-splitting,
and retire the dual calculation engine.
- Exit: all 22 modules pass their own bar; Linear backlog clear.

## 5. The daily operating loop (solo)

1. Open the top Linear issue for the current phase. Read its exit criterion.
2. Plan mode: pin the requirement and the definition of done.
3. Delegate to the matching subagent; set the `/goal` (or trigger the workflow) with a turn
   cap. Step away if you like; glance at the status panel for token spend.
4. When it reports done, run the verifier agent on the diff. Do not trust the worker's word.
5. Only after CI is green on the branch, move the Linear issue to Done.
6. `/clear` before the next issue so context does not pollute.

## 6. Cost and safety guardrails

- There is no hard per-run spend cap on `/goal` or workflows. Every condition in the library
  carries a turn cap; keep it. Do not start an open-ended sweep and walk away overnight.
- As a solo operator funding this yourself, treat the turn cap and the status-panel check as
  mandatory, not optional. Long unattended Opus runs are where the cost surprises come from.
- Hooks require a trusted workspace. The hooks are Node scripts invoked as
  `node .claude/hooks/x.mjs`, so no `chmod` is needed; just confirm the trust dialog. They
  fire identically in the Claude desktop app on Windows, in WSL, and in CI.
- Workflows ask you to confirm the plan on first trigger. Read the plan; confirm only if the
  scope and the per-stage exit criteria are right.

## 7. Source of truth

The audit found `docs/issues/known-issues.md`, `docs/reviews/open-issues-summary.md`, and
`docs/risk-register.md` asserting resolved items that were not. Do not maintain status in
those files. Linear is the single source of truth; see `LINEAR-IMPORT.md`. CLAUDE.md forbids
editing the status docs to claim a fix, and forbids counting `parseFloat -> Number()` as a
remediation.

## 8. Honest scope

The audit puts this at roughly 110 to 150 engineer-days, with the P0 gating subset around 35
to 45 days. This toolchain accelerates that; it does not shrink it. The real-DB integration
suites and the deploy reconciliation are genuine engineering you execute, not config this
package generates. The orchestration above is what makes a multi-month remediation feasible
for one person: the subagents are the team you do not have.

## 9. Next steps

1. Drop `.claude/` and `.github/workflows/ci.yml` into the repo root. The Node hooks need no `chmod`.
2. Adjust the env variable names in `ci.yml` to match the repo (the script names already match;
   the CI schema step uses `npm run db:push` as the interim, since there are no versioned migrations).
3. Decide the deploy target (infra-deploy agent) and write the runbook.
4. Create the Linear backlog from `LINEAR-IMPORT.md`.
5. Stand up CI, prove it on a trivial PR, then begin Phase 1.

## References
- Dynamic Workflows in Claude Code (research preview), Anthropic, May 2026.
- `/goal` command, Claude Code v2.1.139, May 2026.
- Claude Code hooks, subagents, and skills documentation.
- Anthropic Data Protection and DPA-aligned audit-trail practice for regulated financial data.
