# Coverage Ratchet Plan

**Date:** 2026-07-04
**Scope:** `client/vitest.config.ts`, `server/vitest.config.ts`, and CI coverage gates.

The current coverage thresholds are intentional regression floors. They prove coverage cannot silently drop, but they are not quality targets. This plan defines how to raise them without blocking unrelated work or encouraging low-value tests.

## Current Gates

- CI runs `npm run test:coverage:server` and `npm run test:coverage` on every PR and push to `main`.
- Server coverage is written to `.local/coverage/server`.
- Client coverage is written to `.local/coverage/client`.
- Thresholds are configured globally and for financial feature folders.

## Ratchet Rule

On every hardening/test PR, and at least once per release candidate:

1. Run coverage from clean `main`.
2. Compare the measured `statements`, `branches`, `functions`, and `lines` against the configured thresholds.
3. Raise a threshold only when the measured value is at least 2 percentage points above the current floor.
4. Leave 1 percentage point of headroom below the measured value to avoid flaky rounding failures.
5. Do not lower thresholds unless a file or feature was intentionally removed; document the reason in the PR.

Example: if `src/features/cashflow` branches are configured at 43 and measure 49.2, raise to 48, not 49.

## Priority Order

1. Financial mutation paths: transactions, transfers, budgets, goals, investments, recurring.
2. Privacy/security paths: rules, filter presets, settings/security, receipts/attachments.
3. Shared money and validation utilities.
4. UI-only chart/report display components.

## Definition Of Done For A Ratchet PR

- Includes the coverage command output summary in the PR body.
- Changes thresholds only in `client/vitest.config.ts` and/or `server/vitest.config.ts`.
- Does not add placeholder tests that assert rendering only; new tests must pin behavior, validation, permissions, race handling, or money correctness.
- CI coverage jobs pass on the branch.

## Next Ratchet Candidates

- Raise client `src/hooks/**/*.ts` branches after the CSRF/mutation-hook coverage wave.
- Raise server `services/{account,budget,goal,recurring,transaction}/**/*.ts` after the remaining money-service tests are broadened.
- Add a focused threshold for `server/modules/filter-presets/**/*.ts` once delete/update race tests are added.
