# Coordinator C2 browser preparation

31 October2026. Parent coordinator owns only the new browser regression,
completion-config testMatch addition and this record. Application source remains
the author's exact7bf99d17a7ed5cffcd29a79d10b53b904e8d3f9b candidate. The author
chat is idle; these additions are verification preparation, not competing fixes.

## Prepared coverage, not browser evidence

`e2e/completion-c2-credentials.spec.ts` contains two real-UI journeys:

1. Wrong step-up password must leave the dialog/error, unfinished password form
   and verified session intact. Correct step-up then retries the existing
   password-change caller with its wrong current password; that rejection must
   preserve the form/session too. Independent SQL readback checks password hash
   and security generation unchanged.
2. A failed login in a second tab sharing cookies must preserve the first tab's
   unsaved account draft. A subsequent browser storage-event barrier drains the
   receiving queue. A successful login as a different synthetic actor is the
   positive control: the existing cross-tab listener must retire the old draft
   and refresh identity. SQL checks the draft was not saved for either household.

No mocked auth response, manufactured session signal, real email/provider or
arbitrary wait is used. Existing protected-test/browser-server/fixture guards and
one-worker zero-retry completion configuration are retained.

## Static result

The ordinary tsconfig excludes e2e, so a focused temporary config extends it and
explicitly includes the new browser test, completion config and server type
declarations. Pinned Node24.22.0 ran:

`node node_modules/typescript/bin/tsc --project .local/c2/coordinator-browser-preparation-oct31a/tsconfig.json --noEmit`

Exit0, no diagnostics, source pins unchanged. Session20011 reached terminal.
Packet includes pre.json, tsconfig.json, typecheck.log and typecheck-result.json.
Hashes:

- Browser spec:908f62daf97e9462b15f36d9ddddf9c64e11e61404163a4ad44e9432b4e0cf3e
- Completion config:31f45e6fcfb24b04373b5fb06622762b1a54ab3c630aa4e4d01362d7c51fa3ee
- Focused tsconfig:610d923370cc988beeb1922e5a38e32c55369534a9f09b4b948790c27d39eb36
- Empty successful log:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

## Execution blocked before launch

Automatic approval review rejected the proposed owned PostgreSQL startup and
fresh disposable-target bootstrap command as **blocked by policy**, with no
further reason. CreateProcess was rejected, so the command did not execute.
Read-only follow-up confirmed the proposed packet directory and postmaster.pid
were absent and no listener was present on55432 or5159. No target manifest,
database, browser or server was created by that command. No alternative tool or
launcher was used to bypass the rejection.

Proposed, still-uncreated target: run c2browseroct31a1,
database pfa_completion_review_c2browseroct31a1_test on owned127.0.0.1:55432,
browser origin http://127.0.0.1:5159. Resolve the tooling gate before attempting
that startup/bootstrap again; do not treat this document as a successful setup.

After independent test review and an authorized functioning target window, run
the protected command with an explicit matching manifest and run identity:

`node scripts/run-protected-tests.mjs database playwright test e2e/completion-c2-credentials.spec.ts --config playwright.completion.config.ts --project chromium`

These tests are **UNRUN**. Static success does not reproduce C2-03/C2-11 or prove
the fixes in a browser. Independent review remains quota-held. No source
integration, release or broader C2 closure is claimed.
