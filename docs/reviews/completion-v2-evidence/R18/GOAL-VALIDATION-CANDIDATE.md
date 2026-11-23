# R18 goal wizard required-field feedback

Author: `C:\Users\USER\.codex\worktrees\capital-r18-goal-validation\personal-finance-app`,
branch `codex/r18-goal-validation`, base `957913f2a76d337facd22011af7cdc8f278557cc`.
Parent owns this NEW-37/F-GOAL-UX-01 presentation slice while existing Sol agents
remain terminal on usage limits. No repeated quota retry or model substitution.
Independent code/TypeScript and Astra High final assessment remain required.

174 predecessor source paths were checked against the frozen greeting manifest
before copying and again at destination. Inherited-source manifest SHA256:
`c21c37c1215b13d545eeef1e65c9c74a0b307ecfb866e30be70692a4344676a1`.
Previous candidates are unchanged; no environment, cookies or user data copied.

Source tracing confirms Goals.tsx and InvestmentGoalsList use GoalCreationWizard,
not the unused multi-goal StepTargets flow. Its Continue/Create button was disabled
when required fields were missing, without an explanation. The exact RED interacts
with the actual dialog, tabs, forms and button and fails to find an error alert.
One failed test is retained in component-red.log; the baseline missing-description
warning was explicitly expected in that RED, not silently globally suppressed.

Owned files under client/src/features/goals:
- components/GoalCreationWizard.tsx and GoalCreationWizardData.ts;
- components/SaveUpGoalForm.tsx, PayDownGoalForm.tsx, InvestmentGoalForm.tsx;
- new components/goalRequiredFields.ts and GoalValidationSummary.tsx;
- new __tests__/GoalCreationWizard.validation.test.tsx.

The required-field predicates retain their existing semantics and share one error
map with the existing canSubmit helpers. Numeric/range/date validity is not inferred
or normalized by this repair. Clicking or keyboard-activating Continue/Create on
an incomplete draft leaves mutation uncalled, shows/focuses a role=alert summary,
and associates each missing input/selector via aria-invalid/aria-describedby.
Keyboard-usable summary links focus the corresponding control within that dialog.
Correcting a field removes its error; changing goal type clears feedback in the
same state transition. Close/reopen clears draft/feedback. Pending mutation still
disables submission. DialogDescription now describes the actual workflow.

R10 remains open: server monetary/range validation, creation/assignment atomicity,
partial assignment failure/recovery, forecast/calendar semantics, field-level
server rejection handling and full financial/persistence journeys are not proved
by this presentation candidate. Existing payloads, mutation hooks and assignment
behavior remain unchanged. Do not mistake a mocked successful mutation for a DB
write, or an accessible alert in jsdom for actual screen-reader/device acceptance.

## Verification and next review

Initial expanded component suite passes7/7. Final suite after synchronous tab-error
reset and explicit keyboard activation also passes7/7 (`component-final.log`,3.78s).
Cases cover invalid Save Up keyboard submit and error-link focus; corrected Save Up
progression and expected original payload fields; every missing Pay Down field and selector
association; explicit zero interest/minimum payment with unchanged payload; invalid
and corrected Investment; tab/close/reopen reset; pending submission disable.
Real dialog/tabs/forms run with inert account/funds/format/image and mutation hooks.
No API/database/browser/provider was used. Full repository check is running at this
allocation checkpoint; no review, source integration or closure is claimed.

Reviewers must read master NEW-37/R18 and R10 boundaries, these eight files, preserved
RED and final GREEN, then the final source manifest/check evidence. Challenge the
preserved required-field semantics, all input/error associations, keyboard summary
focus, error removal/tab/reset behavior and absence of mutation on invalid drafts.
General and TypeScript review followed by Astra final remains the next integration
gate. Source is uncommitted in the author; no author self-approval is permitted.

Reproduce with pinned Node24.22.0 from the author:
`node scripts/run-protected-tests.mjs unit vitest run --config client/vitest.config.ts client/src/features/goals/__tests__/GoalCreationWizard.validation.test.tsx`,
then `npm run check`. Parent serializes execution. All101 groups and the campaign
goal remain OPEN; production/shared DB, paid calls, real external messages,
deployment and release remain separately gated.

## Final local checkpoint

Full check initially failed on a test-only unsupported `exact` option passed to
Testing Library getByRole. Removing it retains the exact string-name matcher; no
production change. Failed check-first.log is retained. Type-fixed component suite
passes7/7 (`component-type-fixed.log`,4.04s), and full check-type-fixed.log exits0
through all repository guards. No LOC baseline change, new oversized file or grown
debt. Production wizard is287 lines, under300. The final source parity check passes.

Frozen182 source paths/8 owned; all174 inherited hashes are unchanged.
`.local/r18-goal-validation/source-freeze.json` SHA256:
`41ff4af12fd9c25e8e6ecc05d348a717d72853e7b2d4beafe9ec16475e0720ac`.
Manifest status records the check still running at freeze; later
verification-final.json records component/check exit0 and source parity.
Canonical17-file copy, all hashes verified:
`.local/r18-goal-validation-oct30/receipt.json` SHA256:
`584dec83c970576817308fea701fa0c09898099b6656b979523ebb6734f1fde7`.
Final eight source snapshots are under final-source in both evidence roots.

All command handles completed. No owned Node process remains; no browser/database
started. R09 was polled and remains unchanged failed on revoked network permission.
Designated reviewers remain terminal on usage limits, so code/TypeScript and Astra
review have not been obtained for these bytes. Source stays isolated/uncommitted,
with all101 canonical groups and the active goal OPEN. No broader financial or
release acceptance follows from this bounded required-field feedback repair.

## Independent approval and canonical integration,30 October2026

This section supersedes the earlier pending-review status for these eight paths
only. Sol Extra High `r18_goal_review` independently approved code/TypeScript;
Astra High `r20_graph_final_review` independently approved general/final source.
Both verified the eight current hashes/sizes against freeze41ff4af1... and found
no actionable defects. They inspected the preserved author results without
rerunning them. The check logs in the original canonical evidence directory were
copies of author execution, not canonical executions.

Canonical base d2ccce3690042ec06bed225cafee6bada1f2d454 has the same five existing
owned-file blobs as author base957913f2; the three new paths were absent. Only
these eight files were copied and verified. The174 inherited changes were not
integrated. Direct UI/config/useGoals dependencies match; the author's optional
enabled=true addition to useAccounts does not affect this wizard's one-argument
call. Both reviewers found no hidden dependency requiring that unrelated change.

Fresh canonical protected component verification passes7/7, exit0 (16.91seconds),
then `npm run check` passes with pinned Node24.22.0, including TypeScript and all
repository guards. No LOC baseline change or grown debt. Eight post-run hashes
match. Evidence: `.local/r18-goal-integration-oct30/`, seven-file receipt SHA256
`72d72b1416c55d963ce634fb395a8b7dfcc82ffef217a17a2080012590e8bd0a`.
Owned-source manifest SHA256
`990ca6250ea437147b167c1ddbbc0dd573fa86a4555ddb35b0ed866aa1fa513d`.
Runtime windows were serialized with the separately owned R20 native transport.

Review qualification: payload tests assert expected fields with objectContaining,
not complete payload equality; unchanged builders were separately inspected.
Investment's invalid attempt has no immediate no-mutation assertion, and each
conditional Other/focus-link combination is not individually tested. Source
control-flow review supports the bounded guard conclusion. No screen-reader,
browser, financial server, assignment recovery or persistence acceptance follows.
R18, R10, all101 canonical groups and the campaign goal remain OPEN.
