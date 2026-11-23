# R05 manual drafts and account memory: bounded port map

Read-only disposition at canonical `d77c0413bccedf04627e6337223cd8159f489b72`,
31 October 2026. This is preparation for an existing candidate, not a new lane,
source acceptance, integration or runtime result.

The preservation receipt and commit `ca37359f1a6207ff1b4173edacd9c1ec220c56d8`
contain 109 paths. Of these, 100 are unchanged inherited versions from the manual
draft predecessor `681f84e78a171990034ff4750c2b62115ea8a538`; nine contain the
account-memory delta. Do not merge this whole snapshot or count copied paths as
separate features. Both branches remain preserved and outside canonical ancestry.

## Actual remaining behavior

Canonical preference persistence is already integrated, but its transaction
consumers are not: `transactionFormUtils.ts` still returns today's date for both
values of `autoFillTodayDate`; the form hook still reads/writes global
`lastAccountId`, resets on preference/tag changes and returns from transfer
creation before remembering its primary account. The scoped memory helper,
per-open initializer, readiness UI and related tests are absent.

The later account-memory snapshot contains the manual-draft behavior. Six of the
manual predecessor's ten owned paths are unchanged; its initializer, form hook,
manual-hook test fixture and Playwright registration are superseded there.
Do not separately review the obsolete 104-file predecessor as another candidate.

## Eventual current-base port: 14 paths

Use the versions at `ca37359f` as inputs for a current-base port, not as authority
to overwrite newer shared behavior. The six production files are:

- `client/src/components/transactions/AddTransactionModal.tsx`
- `client/src/components/transactions/form/TransactionDraftReadiness.tsx`
- `client/src/lib/transactionFormUtils.ts`
- `client/src/components/transactions/hooks/useTransactionDraftInitialization.ts`
- `client/src/components/transactions/hooks/useTransactionForm.ts`
- `client/src/components/transactions/hooks/transactionAccountMemory.ts`

Seven associated test files are:

- `client/src/components/transactions/__tests__/AddTransactionModal.readiness.test.tsx`
- `client/src/lib/__tests__/transactionFormUtils.manual-drafts.test.ts`
- `client/src/components/transactions/hooks/__tests__/useTransactionForm.manual-drafts.test.tsx`
- `client/src/components/transactions/hooks/__tests__/transactionAccountMemory.test.ts`
- `client/src/components/transactions/hooks/__tests__/useTransactionForm.account-memory.test.tsx`
- `e2e/completion-r05-manual-drafts.spec.ts`
- `e2e/completion-r05-account-memory.spec.ts`

The fourteenth path is `playwright.completion.config.ts`: preserve current
registrations and add both journeys exactly once. Keep canonical
`e2e/protected-test.ts`; its different closed diagnostic categories and timing
were separately reviewed/integrated in `bb2f4957`, documented in
`PERSONAL-PORT-INTEGRATION.md`. Do not restore the older diagnostic or copy
unrelated server/settings/migration paths from the inherited snapshot.

## Acceptance and sequencing

Historical manual-draft evidence is 26 focused tests and one development-mode
income journey. The later account-memory packet records 112 focused tests and
one development-mode journey, with independent Sol general/TypeScript reviews.
Their failed attempts and unresolved cold-start behavior remain part of the
record. These are historical author results, not final Astra clearance or proof
of a current-base port. The old documents' uncommitted labels are superseded only
by the preservation commits, not by acceptance.

An eventual port needs fresh independent review, old-and-new-caller tests and its
applicable protected browser/persistence checks. Preserve identity lifetime,
late-tag handling, dirty drafts, explicit prefill/edit precedence, transfer source
selection, disabled/invisible-account refusal and failure/retry behavior. Do not
infer a new timezone precedence or financial posting rule from this client work.

The coordinator has not allocated implementation of this port. Repair/review of
existing candidates takes priority; C2/R04/R14 protected acceptance remains
pending the existing local runtime retry response. This map makes the real
consumer gap and minimal coherent scope explicit without growing the queue or
claiming any R05 group closed.
