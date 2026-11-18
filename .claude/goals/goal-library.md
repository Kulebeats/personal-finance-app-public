# /goal condition library

`/goal` separates the agent that works from a small evaluator model that decides, after
every turn, whether the condition is met. That separation is the antidote to self-reported
completion, but the evaluator reads the transcript, so every condition below is tied to an
artifact it cannot fake: a passing real-DB test, a grep result, an audit_logs row, green CI.
Every condition includes a turn cap. There is no hard spend cap; watch the status panel.

Set one with `/goal <condition>`. Check progress with `/goal show`. Clear with `/goal clear`.
Pin down the requirement first (plan mode) so the condition is precise.

## Phase 0 - Deploy (do first)
This is engineering judgment, not an autonomous goal. Use the infra-deploy agent and decide
the target with the maintainer. Do not hand deploy reconciliation to an unattended /goal.

## Phase 0 - CI gate
> /goal `.github/workflows/ci.yml` runs `npm run check`, `npm run test:server:run` and
> `npm run test:run` against an ephemeral Postgres on pull_request, the workflow is valid
> (actionlint passes), and a trivial PR shows the job executing. Stop after 20 turns.

## Phase 1 - P0 DPA: AI PII
> /goal All 12 AI tools route data through the sanitiser before reaching Gemini (grep shows
> no JSON.stringify of raw DB rows in ai.gemini.ts), `data_sanitized` is set only from the
> sanitiser result with no hardcoded true, Gemini tool args are validated by the Zod schemas
> in ai.validation.ts before any query filter, and a test proves an unsanitised field is
> rejected. `npm run check` clean. Stop after 30 turns.

## Phase 1 - P0 financial: GRZ Money + audit
> /goal GRZ coupon, withholding-tax, discount and yield math in grz-service.ts all go through
> the Money class (grep finds no parseFloat / Number(amount / .toFixed / amount*rate in that
> file or grz-securities.ts), every GRZ ledger write calls BusinessAuditService inside the
> transaction, and a new real-DB test asserts a bond purchase writes both the ledger rows and
> the audit_logs row and is exact to the minor unit. `npm run check` clean. Stop after 30 turns.

## Phase 1 - P0 react crash
> /goal Dashboard.tsx has no conditional return before any hook call (useDashboardWidgets,
> useState, useSensors all run unconditionally), and a test mounts the dashboard and changes
> household state without a Rules-of-Hooks error. `npm run check` clean. Stop after 12 turns.

## Phase 1 - P0 household split-brain
> /goal transferOwnership and acceptInvite run inside withTransaction with FOR UPDATE on the
> member rows, and a real-DB test issuing two concurrent transfers ends with exactly one
> owner. `npm run check` clean. Stop after 20 turns.

## Phase 2 - Transactions concurrency
> /goal The transfer/expense path takes FOR UPDATE locks, guards overdraft, and runs the
> idempotency check inside the transaction with a persisted key; a real-DB test fires two
> concurrent identical transfers and asserts exactly one is applied and no balance goes
> negative; the old mock-theater concurrency tests are deleted. CI green. Stop after 40 turns.

## Phase 2 - Goals calc bug
> /goal The goal status logic classifies a no-progress goal as on_track not at_risk, all
> goals calc unit tests pass, and a real-DB test covers the boundary cases. `npm run check`
> clean. Stop after 20 turns.

## Phase 2 - Settings right-to-erasure
> /goal deleteAccount irreversibly anonymises or deletes the household financial data (a test
> proves no readable financial rows remain), reads the user id before session.destroy, and
> writes an audit row; the email is not merely prefixed with deleted_. CI green. Stop after 25 turns.

## How to use this file
Copy a condition, refine the file paths to match the repo, paste after `/goal`. Run the
matching subagent in the same session so the worker has the right domain instructions.
