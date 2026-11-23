# Corrected C2 candidate: fresh local runtime evidence

1 November 2026. Exact candidate `d6ee653a7bfea077c9dd66f7aaf0205a84d1da1d`
in `C:\Users\USER\.codex\worktrees\c2-review-remediation`, clean before and after.
The owner explicitly authorized retrying the owned PostgreSQL cluster and the
prepared protected local database/browser checks. No production/shared database,
external email, push, PR, deployment or release action was performed.

## Current results

- Six protected HTTP/PostgreSQL files passed **92/92** tests. This includes import
  role/visibility controls, cross-writer tag counts, duplicate bulk audit contents,
  audit-failure rollback, old tag writers/races, and email lifecycle/token controls.
- Two protected Chromium journeys passed **2/2**. Wrong step-up and current-password
  rejection preserve the security form and ready session. Wrong login in another
  tab preserves the open account draft; successful replacement login retires it.
  Both journeys use actual UI/API behavior and independent SQL assertions.
- All 44 source pins from the corrected candidate's prior static/build receipt
  match after execution. Browser and database commands exited zero.

This is test/development-mode local runtime and persistence evidence. It is not
production-mode proof, Firefox/WebKit acceptance, complete C2 resolution or
canonical integration. No claim is made that the remaining C2 findings are fixed.

## Target and evidence

Marked target: `pfa_completion_review_c2nov01a1_test`, run `c2nov01a1`,
127.0.0.1:55432, pfa_campaign. Existing guarded bootstrap created the absent
database, set its marker, and applied 15 journaled migrations. The browser manifest
adds owned origin `http://127.0.0.1:5071`; it references the same marked database.
Playwright owns and tears down its server. Shared5432 was excluded.

C2 author packet: `.local/c2/coordinator-db-nov01a/`. It contains manifests,
commands/results, raw logs, readback and the verification receipt.

| Artifact | SHA256 |
| --- | --- |
| `target.json` | `3246d55261579c89b4294feb39d0c953d1fb43a61bb5f6bb48007a972c375f2b` |
| `suite.log` | `6f91991f77a94933b5624577e4c0d2eae6af1d2185aeb27c05b364ba01b666ab` |
| `browser.log` | `2a488c611ceb165e8ec9a95a91d0769d521fc1861debfd25ed2351322f29fae5` |
| `verification.json` | `0bb61d6250d0df3ed80cbb961e2860964cba97f207e2ba19d3f11f851a8784b1` |

Final SQL readback confirms the target marker and 15 migrations, three retained
synthetic browser users/households, zero accounts/transactions/tags/tag links and
zero other target connections. Every retained user matches the run-specific
example.invalid fixture pattern. The intermediate `after-suite-readback.log`
was captured after browser fixture creation began, so its one-user count is not
an assertion that the database was empty between suites. No cleanup deletion was
performed; fixtures remain available for adjudication in this disposable target.

The coordinator retains final evidence review and canonical integration. The
owned cluster remains allocated to the serialized local acceptance window;
shutdown/observation reconciliation must be recorded before releasing it.
