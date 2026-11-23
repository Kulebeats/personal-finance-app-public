# R12 next frozen caller composition — PREPARATION ONLY

Prepared 3 November 2026 under the Sol implementation/tests/preservation
allocation. Independent review, canonical integration and acceptance belong to
the other account. No runtime window was assigned to this preparation.

Worktree:
`C:/Users/USER/.codex/worktrees/capital-r12-currency-caller-protected-nov03/personal-finance-app`

Branch: `codex/r12-currency-caller-protected-nov03`.

Read the master completion specification, current canonical `CAMPAIGN.md`,
the Sol resumption at `a271f025a7b9fcee679a2ace64efd3eaa96ce7a2`, and
`R12/SESSION-FIXTURE-CANDIDATE.md` before granting a later window.

## Immutable composition and preservation

- Base `ce179bb6f084b3b1b45cc3af69652881c56d5f5a` already contains the
  accepted canonical DELETE/session-read implementation and R12 source at
  frozen stage `62186d4a335fa6dd091788ee280d3560287f3731`.
- Only browser followup `87d552bce62b0baa9c544759ab94ff6ffffa28aa` was
  cherry-picked, without conflict, as
  `43f7467d2a09eef9f999eb32a9f4c082dc35070b`. This preservation note is
  the sole later change. The final clean HEAD is supplied with the handoff.
- That cherry-pick changes only
  `e2e/completion-r12-holdings-currency.spec.ts` and one
  `playwright.completion.config.ts` testMatch entry. The 157-line test's Git
  blob is `fa5416616948e0544ddf13f2eceb77d4765dfcbb`, identical to its author.
  Config contains 21 entries, all unique; none of the base's 20 entries was
  removed. Existing R13 opening and DELETE browser files are unchanged.
- All nine R12 product paths below have identical Git blobs in `62186d4a`,
  `ce179bb6` and this composition. No product, schema, dependency or migration
  repair was made here. `git diff ce179bb6 HEAD -- client server shared
  migrations package.json package-lock.json` was empty before this note.
- The final two-line R12 source correction has stable patch ID
  `73f4dfc1b798de35a99ec0c142cc930658fd9eec` in both author `1aa4d301`
  and stage `62186d4a`; it was already present and was not reapplied.
- All fourteen complete R13 server files listed in the followup command below
  exist and are blob-identical to `ce179bb6`. Compared with canonical
  `0a9ca999c56b025622ed722e1cdc57fc11d2cce9`, the only changed file among
  them is the authorized DELETE fixture repair. Its stable patch ID remains
  `505f234944f324633757b94e3d48dc5793051f28` before and after composition.

| R12 product path | Preserved Git blob |
| --- | --- |
| `client/src/features/investments/components/HoldingsList.tsx` | `cc49eac5948b54751448dd5b5fbe9ccdce152d80` |
| `client/src/features/investments/components/PortfolioSummary.tsx` | `f797d2d4f7ef18e51a127e1dcdc083b11048adf8` |
| `client/src/features/investments/hooks/useInvestmentsData.ts` | `3ca9c51c1d0221a21704322cf65d15e666e888ba` |
| `client/src/hooks/investments/useHoldings.ts` | `a246280d813e30d7915337f0d081f52d51a7e52c` |
| `client/src/hooks/investments/usePortfolio.ts` | `d25a47806d419185054bd14f4999f5c5aea90030` |
| `client/src/pages/Investments.tsx` | `5aa5d30e2839fff8c87a924e6ecf41e50ff1b54f` |
| `server/modules/investments/investmentCurrencySelector.ts` | `0c6e1a2e0c5c32a2fe36585380bb9d0bf9424dc9` |
| `server/modules/investments/investments.holdings.controller.ts` | `e33ce351236721d810ef5c09bfad13524a796a09` |
| `server/modules/investments/investments.portfolio.controller.ts` | `ca2f0fe68818888b32eb1c497e78cf275bbaa81e` |

The canonical, original R12 author, original frozen stage, and fixture author
were refreshed read-only and remained clean at `0a9ca999`, `87d552bc`,
`62186d4a` and `ce179bb6` respectively. They were not edited. No dependency
installation or junction was needed for this static preparation.

## Bounded browser execution inspection

No clear execution-blocking defect was found by tracing the proposed browser
case against current controls, opening request fields, snapshot keys, audit
writer and value/price columns. No test repair was made. This is implementation
preparation, not independent review or evidence that the case executes.

The case uses actual UI login, account creation and both opening submissions;
owned synthetic current USD/ZMW rates 20 and 0.05; native current positions
ZMW100 and USD10; displayed total ZMW300 then USD15; USD holdings and summary
GET response units and converted values; and native row prices. It compares
complete account, holding, purchase, lot, disposal, cash, opening receipt and
financial audit rows against the post-write baseline after both display
switches. Audit selection retains the synthetic actor/household and original
account, holding and purchase IDs. It does not attest dated FX, private basis,
portfolio performance or completeness policy.

Use a fresh migrated marked target for later browser execution. The existing
latest-rate query orders by date without a same-day tie breaker: do not reuse
a target carrying unrelated same-day/future USD/ZMW quotes or delete those
quotes to make this case pass. This is a target prerequisite, not a lookup
policy repair.

Old interrupted evidence remains in the original frozen stage at
`.local/r13-resume-r12servercomposed37x/`. The unchanged 41,400-byte
`server.log` SHA-256 is
`76cd27d4d88c60925a57f4808a7d24a654c4bd91e846cd952d0121324c7b8ad6`.
`server.json` and `postflight.txt` remain absent. Do not reuse this packet,
overwrite it or fill its missing receipts from a new run.

## Copy-ready serial queue — commands NOT RUN

The current ORG-005 operator exclusively owns DB/native/browser/broad testing.
These instructions grant no concurrent window. Wait for the coordinator to
confirm that operator has released it, then independently inspect this exact
candidate and bind the coordinator's approved Node/dependency identities and
fresh migrated disposable target on `127.0.0.1:55432`. Preserve every command's
raw output, exact clean SHA, arguments, start/end/exit result and matching
postflight. Use a new run ID and directory for each protected run.

First reproduce the four complete affected files, without filters or timeout
increases. Server paths are relative to `server/` through the guarded runner:

```powershell
Set-Location -LiteralPath 'C:/Users/USER/.codex/worktrees/capital-r12-currency-caller-protected-nov03/personal-finance-app'
node scripts/run-protected-tests.mjs database vitest --server run routes/__tests__/completion-r12.holdings-currency.realdb.integration.test.ts routes/__tests__/completion-r13.holding-delete.realdb.integration.test.ts routes/__tests__/completion-r13.holding-remaining-basis.realdb.integration.test.ts routes/__tests__/completion-r13.opening-holding.realdb.integration.test.ts --maxWorkers=1
```

Require completed reports rather than setup-skipped callers. Preserve the
selected-SID initial 204 and delegated-gate witnesses, real credential/session
withdrawals and all financial assertions. A failure needs its actual completed
failure report and postflight before deciding the next run.

Then run the R12 selector file alongside the exact fourteen-file accepted
DELETE/session-touch caller set retained from `37p` (fifteen complete files):

```powershell
$r12CallerFiles = @(
  'routes/__tests__/completion-r12.holdings-currency.realdb.integration.test.ts'
  'routes/__tests__/completion-r13.opening-holding.realdb.integration.test.ts'
  'routes/__tests__/completion-r13.holding-remaining-basis.realdb.integration.test.ts'
  'modules/investments/__tests__/investmentHoldingBasis.test.ts'
  'routes/__tests__/completion-r13.holding-edit-admission.realdb.integration.test.ts'
  'modules/investments/__tests__/investments.db.integration.test.ts'
  'modules/investments/__tests__/investments.integration.test.ts'
  'routes/__tests__/completion-r13.trade-fifo-money.realdb.integration.test.ts'
  'routes/__tests__/completion-r13.fifo-source-access.realdb.integration.test.ts'
  'routes/__tests__/completion-r13.opening-retry.realdb.integration.test.ts'
  'routes/__tests__/completion-r13.holdings-read-privacy.realdb.integration.test.ts'
  'routes/__tests__/completion-r13.opening-erasure.realdb.integration.test.ts'
  'routes/__tests__/completion-r13.holding-delete.realdb.integration.test.ts'
  'routes/__tests__/completion-r13.holding-delete-retry.realdb.integration.test.ts'
  'routes/__tests__/completion-r13.holdings-session-touch.realdb.integration.test.ts'
)
node scripts/run-protected-tests.mjs database vitest --server run @r12CallerFiles --maxWorkers=1
```

Later gates remain: the exact-candidate client regressions, full project check,
build, and actual built Chromium/persistence journey, scheduled serially by the
coordinator. Preserve existing opening and DELETE browser callers with the new
R12 case. After a candidate-matching build and fresh marked browser manifest
have been recorded, the browser command is:

```powershell
$env:TEST_BROWSER_CLIENT = 'built'
node scripts/run-protected-tests.mjs database playwright test --config playwright.completion.config.ts e2e/completion-r12-holdings-currency.spec.ts e2e/completion-r13-opening-retry.spec.ts e2e/completion-r13-holding-delete.spec.ts --project=chromium --workers=1 --retries=0
```

No tests, typecheck, build, Node/native checks, application, browser, PostgreSQL
commands or provider calls ran during this preparation. Only Git/static source
comparisons, filesystem reads and bounded local preservation were performed.
There are no new runtime receipts or pass counts. Independent review and
acceptance are pending; no canonical requirement closes here.
