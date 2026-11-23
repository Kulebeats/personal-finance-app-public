# R09 / FIN-15 bounded CSV date implementation

Base: `de61805c72d440f093eb6523f04eab9f328bf009`.
Checkout: `C:\Users\USER\.codex\worktrees\760c\personal-finance-app`.
Branch: `codex/r09-csv-date-format`.

1. Reproduce impossible-date rollover, implicit slash ordering, timezone drift,
   and account-detail raw-date submission with protected UNIT tests against the
   actual parser, services, and client components. Preserve RED output locally.
2. Own `shared/import-date.ts`, `server/services/import/parse.ts`,
   `server/services/import/types.ts`, `server/services/ImportService.ts`,
   `server/services/account/AccountImportService.ts`, and `server/routes/import.ts`.
   Use one pure calendar-date contract and canonical ISO day strings. Require
   explicit DD/MM/YYYY or MM/DD/YYYY when both interpretations are possible.
   Validate full calendar components before constructing any writer input.
3. Own `client/src/components/import/{ImportWizardContext.tsx,importApi.ts}`,
   `steps/{ColumnAssignmentStep.tsx,ReviewStep.tsx,ProgressModal.tsx}`, new
   `DateFormatSelect.tsx`, `ImportDatePreview.tsx`, `datePreview.ts`, and
   `client/src/components/accounts/ImportTransactionsModal.tsx` plus new
   `parseTransactionCsv.ts`. Show normalized dates/errors and format selection;
   preserve the previewed date interpretation when submitting. Keep account DTO signatures unchanged
   unless the coordinator explicitly assigns their date metadata extension.
4. Own focused tests in `server/services/__tests__/import.parse.characterization.test.ts`,
   new `completion-r09.import-dates.test.ts`, new account-service date tests,
   `server/routes/__tests__/import.test.ts`, and client import/account test files.
   Tests may replace persistence/external dependencies, but must run the actual
   date parser and actual caller code. Label those results as UNIT evidence.
5. Run focused protected UNIT tests, typecheck and static guards; retain commands,
   exits, RED/GREEN results and source trace in this directory and
   `.local/r09-csv-date/`. Request independent review and Astra High assessment
   from the coordinator before a scoped commit. Do not update canonical status.

No ledger sign/balance, dedupe, transfer, auth, settings, database schema,
migrations, production/shared DB, providers, broad suite or browser/native work.
R09 depends on R08; this slice cannot close R09 or financial readiness.

## Settled date and caller contract

The coordinator accepted canonical account rows without adding format metadata
to shared account hooks, DTOs or controller signatures. Format/source changes
recompute preview; a new file read clears the prior preview immediately. Global
submission sends an immutable snapshot of raw rows, mapping and selected
`dateFormat`; the shared server parser resolves exactly the previewed day while
preserving other fields mapped to the same raw CSV column. Account submission
sends normalized rows through the existing typed API. The server independently
parses/validates before writing. Independent review found that overwriting raw
date cells corrupted alias mappings; the failed regression and previous source
are preserved locally, and raw-row submission repairs that defect without a new
API contract.

Supported unambiguous inputs are four-digit-year year-first hyphen or slash
dates (`2026-03-14`, `2026/03/14`, also unpadded month/day), year-last numeric
slash dates where only one calendar interpretation exists (`25/12/2026`,
`12/25/2026`), and English full/three-letter month names (`March 14, 2026`,
`14 Mar 2026`, `14-Mar-2026`). ISO timestamp inputs retain their written calendar
date after strict calendar/time/offset validation; no timezone conversion occurs.
The selected slash order applies to year-last numeric slash dates. Auto rejects
two different valid interpretations; equal interpretations such as `01/01/2026`
are safe. Invalid dates are never rolled over. No arbitrary year/product bounds
are added. Native-parser accidents such as a bare number or a two-digit year
are not a supported import contract.

Tests compare independent literal expected calendar days and UTC midnights;
they do not derive expected dates using the implementation under test. Service
and route tests mock persistence/auth-related collaborators and are UNIT
evidence, not HTTP/DB or financial-correctness evidence.
