# R05 next slice: manual draft defaults and preference hydration

Read-only source inventory,30 October2026. This plan does not claim implementation
or close any canonical group. Governing master R05.1/NEW-26 and companion R05
remain authoritative; R08 financial-posting acceptance stays separate.

## Current candidate and next bounded behavior

The personal-preferences author now provides the distinct authenticated endpoint
and acknowledged save/readback. The earlier PERSONAL-PREFERENCES-NEXT endpoint
inventory is historical; its consumer warnings remain applicable.

`client/src/lib/transactionFormUtils.ts` initializes default transaction type
from preferences but returns baseDate in both autoFillTodayDate branches.
`client/src/components/transactions/hooks/useTransactionForm.ts` initially uses
new Date and resets when preferences hydrate. Preference persistence alone does
not establish that a new draft honors those settings or preserves manual input.

Next implementation should be client-only:

1. A new unprefilled draft with autoFillTodayDate=false has no selected date;
   required-date validation prevents submission until a date is selected.
2. All three accepted default types initialize correctly. This proves selection,
   not transfer or other financial posting correctness.
3. Explicit initialValues and edit values win over personal defaults. A delayed
   preference response/refetch cannot reset dirty amount/date/type input.
4. New-draft preference loading/error/retry is truthful. Close/reopen reapplies
   fresh defaults. Existing valid edit data must not be replaced by defaults.
5. Preserve submission payload, money, ownership, transfer, recurrence and goal
   semantics. No import, receipt or ledger writer change is part of this slice.

Suggested ownership: transactionFormUtils.ts, useTransactionForm.ts, transaction
form/schema.ts, AddTransactionModal.tsx for readiness/retry presentation, focused
helper/hook tests and a small extracted initialization helper if needed to avoid
growing existing oversized files. TransactionFormFields.tsx only if required by
blank-date typing; its date picker already supports Pick a date.

Required evidence: false date blank and blocked submit; selecting date permits
normal valid submit; expense/income/transfer defaults; prefill/edit precedence;
late hydration/refetch does not erase input; failure/retry; close/reopen. Scope
the test double to the mutation boundary when proving draft behavior; no claim
of database/financial acceptance from those tests. Existing browser and HTTP
evidence belongs to its recorded source candidate, not a future derived author.

## Unresolved timezone acceptance

Current manual entry uses browser-local new Date. SettingsContext exposes the
saved display timezone (default Africa/Lusaka), while profile has another timezone
field. No established household-timezone resolver was found on this path. Master
line200 requires configured user/household local days; its explicit household-local
today wording for goal forecasts does not settle manual precedence.

Do not invent profile/display/household precedence. This bounded slice may repair
the off-state/type/hydration behavior while preserving existing true-date behavior
and keeping cross-timezone true-date acceptance OPEN. Broader acceptance needs
the established effective-timezone contract and midnight-boundary evidence.

## Other consumers remain distinct work

- rememberLastAccount uses one global lastAccountId localStorage key, without
  identity namespace or current-account visibility validation. Transfer paths
  return before remembering. A later client memory/lifetime slice is possible.
- rememberLastCategoryPerMerchant conditionally writes shared merchant
  defaultCategoryId after ordinary create without awaiting acknowledgement;
  selection applies that category regardless of the preference. Adjudicate
  personal memory versus shared configuration before changing R11 behavior.
- skipDuplicateImports has no production consumer. R09 dedupe/idempotency must
  preserve legitimate repeated purchases; the separate R09 date chat retains
  its ownership and must not be duplicated.
- autoAssignCategoriesFromRules has no production consumer; import/transaction
  creation apply rules unconditionally. The categorization flag does not imply
  permission to disable every rule action. R09/R11 depend on R08.
- Receipt auto-create ignores requireOcrReview, uses threshold||80 (zero becomes80)
  and announces creation before acknowledged conversion. R15 review/idempotent
  conversion depends on R08/R14/R19; these are not solved by preference persistence.
- These nine fields do not directly require R10. Separate budget rollover NEW-16
  remains R10/R14 work, with R10 depending on R08/R12.

Inventory agent personal_preferences_next_inventory, Sol Extra High, read-only.
No files, tests, DB or runtime state were changed by that investigation.
