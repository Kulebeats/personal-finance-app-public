# Transactions Deep Review - Issue Log, Tech Spec, and Plan

## Scope

- Transactions list API and UI (pagination, filtering, sorting, search)
- Transaction summary behavior
- Money and currency handling for transactions and transfers
- Tag workflows (list, edit, filter)
- Owner and review workflows

## Confirmation of Prior Findings (Claude Plan)

The following items are confirmed by code inspection and are accurate:

| Issue                                          | Status    | Evidence                                                                                             | Notes                                                                 |
| ---------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Pagination returns page count instead of total | Resolved  | server/modules/transactions/transactions.controller.ts                                               | `pagination.count` now uses total count; page length is `pageSize`    |
| Sorting validated but ignored                  | Resolved  | server/repositories/TransactionRepository.ts                                                         | `sortBy`/`sortOrder` now drive dynamic `orderBy`                      |
| Search parameter not implemented               | Resolved  | server/repositories/TransactionRepository.ts                                                         | `search` now applies across name/originalName/notes/merchant          |
| Tags filter not implemented                    | Resolved  | server/repositories/TransactionRepository.ts                                                         | `tagIds` now applied via EXISTS on transaction_tags                   |
| Client filters not forwarded to API            | Resolved  | client/src/pages/Transactions.tsx                                                                    | Filters now forwarded, including `search`, amounts, reviewed, owner   |

## Additional Issue Log (Additive)

| ID   | Severity | Area             | Issue                                                                                     | Evidence                                                                                                                                                                                                | Impact                                                     |
| ---- | -------- | ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| T-01 | Critical | Data contract    | Transaction amount returned as MoneyDto, but client types/UI treat it as string/number    | server/modules/transactions/transactions.helpers.ts, client/src/lib/api.ts, client/src/features/transactions/components/TransactionRow.tsx                                                              | Amounts render as NaN/0 and summaries become wrong         |
| T-02 | High     | UI logic         | UI infers income/expense from amount sign, but DB stores positive amounts for both types  | client/src/features/transactions/components/TransactionRow.tsx, client/src/features/transactions/components/TransactionCard.tsx, client/src/features/transactions/components/TransactionDetailModal.tsx | Expenses can render as income; totals are inverted         |
| T-03 | High     | Pagination       | Infinite scroll uses `count < limit` instead of `totalFetched < count`                    | client/src/hooks/useTransactions.ts                                                                                                                                                                     | Over-fetches pages or stops early when count is total      |
| T-04 | High     | Summary          | Summary panel uses only loaded pages, not full dataset                                    | client/src/pages/Transactions.tsx                                                                                                                                                                       | Totals are incomplete until user scrolls through all pages |
| T-05 | High     | Ledger integrity | Update schema allows negative amount values                                               | server/modules/transactions/transactions.validation.ts                                                                                                                                                  | Balance delta can invert and corrupt account balances      |
| T-06 | High     | Owner/review     | Owner and reviewed changes are sent by UI but ignored by API                              | client/src/features/transactions/components/TransactionDetailModal.tsx, client/src/components/transactions/hooks/useTransactionForm.ts, server/modules/transactions/transactions.validation.ts          | Owner changes and manual review actions do not persist     |
| T-07 | Medium   | Tags             | Tag display/edit uses tag names and updateTransaction instead of tag IDs and tags API     | client/src/features/transactions/components/TransactionDetailModal.tsx, client/src/lib/api.ts                                                                                                           | Tag edits fail silently; list shows no tags                |
| T-08 | Medium   | Filters          | Filters UI state is not wired into the query on the Transactions page                     | client/src/pages/Transactions.tsx, client/src/features/transactions/hooks/useTransactionFilters.ts                                                                                                      | Search and filters look active but do nothing              |
| T-09 | Medium   | Sort contract    | Client sort fields include `name`, `category`, `account` but server expects `description` | client/src/features/transactions/types.ts, server/modules/transactions/transactions.validation.ts                                                                                                       | Future sort integration will reject/ignore client requests |
| T-10 | High     | Currency         | Transfers allow cross-currency moves without validation or conversion                     | server/services/TransferService.ts, shared/schema.ts                                                                                                                                                    | Ledger can be incorrect across currencies                  |
| T-11 | High     | Currency         | Transaction summary aggregates without FX conversion                                      | server/services/transaction/queries.ts                                                                                                                                                                  | Totals are wrong in multi-currency households              |
| T-12 | Medium   | Validation       | idempotencyKey is stored as uuid but validated as free-form string                        | server/modules/transactions/transactions.validation.ts, shared/schema.ts                                                                                                                                | Invalid keys can cause DB errors or 500s                   |
| T-13 | Medium   | Preferences      | Pending visibility preference is defined but not applied to list                          | shared/schema.ts, server/repositories/TransactionRepository.ts                                                                                                                                          | Users cannot hide pending transactions                     |
| T-14 | Low      | UI polish        | Stray non-ASCII glyphs in transaction row separator                                       | client/src/features/transactions/components/TransactionRow.tsx                                                                                                                                          | Visual glitch in list UI                                   |

## 2026-01-27 Verification Addendum

The issue log above was accurate on 2026-01-23, but several items have now been addressed. Current status:

| ID   | Status       | Evidence                                                                  | Notes                                                                                 |
| ---- | ------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| T-01 | Resolved     | client/src/lib/api.ts, client/src/lib/money.ts                            | Transaction amounts are typed as `MoneyDto` and formatted via shared money utilities |
| T-02 | Resolved     | client/src/features/transactions/components/TransactionRow.tsx            | Income/expense styling now uses `transaction.type`                                   |
| T-03 | Resolved     | client/src/hooks/useTransactions.ts                                       | Infinite pagination now uses `pageSize` and `totalCount`                             |
| T-04 | Resolved     | client/src/pages/Transactions.tsx                                         | Summary totals now come from `GET /api/transactions/summary`                         |
| T-05 | Resolved     | server/modules/transactions/transactions.validation.ts                    | Update schema now uses `positiveMoneyDtoSchema`                                      |
| T-06 | Resolved     | server/modules/transactions/transactions.validation.ts                    | Owner updates allowed; review uses dedicated endpoint                                |
| T-07 | Resolved     | client/src/features/transactions/components/TransactionDetailModal.tsx    | Tags now use tag IDs and tags API hooks                                              |
| T-08 | Resolved     | client/src/pages/Transactions.tsx, client/src/features/transactions/hooks/useTransactionFilters.ts | Filters now wire into the list query, including tag filters                          |
| T-09 | Resolved     | client/src/features/transactions/types.ts                                 | Sort field contract aligned to server (`description`)                                |
| T-10 | Mitigated    | server/services/TransferService.ts                                        | Cross-currency transfers now require FX rate; base-currency conversion still partial |
| T-11 | Resolved     | server/services/transaction/queries.ts                                    | Summary now performs FX conversion to household base currency                        |
| T-12 | Resolved     | server/modules/transactions/transactions.validation.ts                    | `idempotencyKey` is now validated as UUID                                            |
| T-13 | Resolved     | server/modules/transactions/transactions.controller.ts                    | Pending preference is now applied via `includePending`                               |
| T-14 | Resolved     | client/src/features/transactions/components/TransactionRow.tsx            | Stray glyph replaced with ASCII separator                                            |

### 2026-01-27 Additional Updates

- `GET /api/transactions/summary` now accepts tag filters (`tags=...`) so totals match tag filtering
- Transactions date validation now rejects impossible calendar dates
- Cross-currency transfers now attempt base-currency conversion when neither side is base
- Added targeted tests for summary tag filters, bulk authz/private visibility, and date validation

## Decisions and Recommendations (Integrated)

| Topic                   | Recommendation                                                                                                                                           | App Consequence                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| FX storage              | Store `fxRate`, `fxBaseCurrency`, `fxQuoteCurrency`, `fxTimestamp`, `fxSource` on both transfer rows; store `convertedAmount` in household base currency | Transfers show a locked conversion rate; summaries and reports stay consistent; requires schema migration    |
| Tags in list response   | Keep `includeTags` optional; always return `tagCount` or `tagIds`; when `includeTags=true`, use a second query by transaction IDs and merge server-side  | Fast list and stable pagination; tag chips may load via follow-up; safe even if a user has many transactions |
| Tags for small datasets | If you want tags by default, still use the two-query merge pattern and cap to small page sizes (for example `limit <= 50`)                               | Nice UX without pagination bugs; extra CPU and payload is predictable                                        |
| Owner/review updates    | Use dedicated endpoints (`PUT /transactions/:id/owner`, `PUT /transactions/:id/review`) instead of the general update schema                             | Clear audit trail and permissions; reduces accidental updates; slightly more client wiring                   |
| Transaction currency    | Enforce `transaction.currency == account.currency` for income/expense; allow cross-currency only on transfers with required FX data                      | Prevents silent currency corruption; cross-currency flows remain explicit and traceable                      |
| Summary API             | Use the existing `GET /api/transactions/summary` endpoint; return MoneyDto totals in base currency                                                       | Accurate totals regardless of pagination; consistent multi-currency reporting                                |
| Money class             | Keep default currency `ZMW` for compatibility; add warnings on currency mismatch in arithmetic                                                           | No breaking change; mismatches become visible in logs                                                        |

## Current Implementation Notes (Audit)

- `convertedAmount` is currently computed in the target account currency, not household base currency. Reporting must normalize to base currency until transfer storage is aligned. `server/services/TransferService.ts`
- Summary uses base currency for Money math but does not apply FX conversion; totals are still wrong for multi-currency households. `server/services/transaction/queries.ts`
- Pagination now returns V7 fields, but `count` was repurposed to total count. Any client still treating `count` as page length must be updated. `server/modules/transactions/transactions.controller.ts`

## Technical Specification

### API: GET /api/transactions

**Goal:** Return a paginated list with total count and fully applied filters.

**Query params (proposed):**

- limit (number, 1-100)
- offset (number, >= 0)
- accountId (uuid)
- categoryId (uuid)
- merchantId (uuid, optional if we want merchant filter parity)
- type (income|expense|transfer)
- startDate, endDate (YYYY-MM-DD)
- search (string, matches name, originalName, notes, merchant name)
- tags (comma-separated tag IDs) OR tagIds (repeated query params)
- includeTags (boolean, default false)
- amountMin, amountMax (number, absolute amount)
- reviewed (reviewed|unreviewed)
- ownerUserId (uuid|null for shared)
- includePending (boolean) default from householdPreferences.showPendingTransactions
- sortBy (date|amount|description)
- sortOrder (asc|desc)

**Response shape:**

```
{
  success: true,
  data: [TransactionDto],
  pagination: { limit, offset, count }
}
```

**TransactionDto (minimum):**

- amount: MoneyDto
- currency: string
- type, isTransferIn
- merchantName, categoryName, accountName
- reviewedAt
- tagCount (number) OR tagIds (string[])
- tags: optional list of { id, name } when includeTags is true
- convertedAmount (MoneyDto) for cross-currency transfers (base currency)
- fxRate, fxBaseCurrency, fxQuoteCurrency, fxTimestamp, fxSource for transfers

**Behavioral rules:**

- Apply visibility rules on both transactions and accounts.
- Exclude deleted transactions.
- Respect pending preference unless includePending is true.
- Count must reflect total results for the same filters and visibility.
- Sorting must be deterministic; tie-breaker on createdAt or id.
- Tags filter matches ANY tag (OR) using EXISTS.

### API: PUT /api/transactions/:id (Update)

**Decision locked:**

- Manual review uses a dedicated endpoint `/transactions/:id/review`.
- Owner edits use `/transactions/:id/owner`.
- Enforce positive amount values in update or normalize based on transaction type.

### Summary API

- Use existing server-side summary endpoint for accuracy and pagination independence.
- Convert to base currency using FX rates (see reports repositories for patterns).
- Allow summary filters to match list filters (date range, owner, includePending, type).
- Return totals as MoneyDto in base currency.

### Currency and Money Invariants

- Amount should be stored as a positive decimal for income/expense; sign is derived from type and isTransferIn.
- Use MoneyDto consistently in API responses and update all client formatting and parsing.
- Enforce `transaction.currency == account.currency` for income/expense.
- For cross-currency transfers: require FX data and store `convertedAmount` in base currency.
- Money arithmetic logs warnings on currency mismatches (no throw).

### Query Implementation Details

- Add `countByHouseholdWithVisibility` (or return count alongside list) using the same filters.
- Implement search with `ILIKE` on transactions.name, transactions.originalName, transactions.notes, and merchants.name (join merchants).
- Implement tag filtering using `EXISTS` on `transaction_tags` (see TransactionReportRepository for reference).
- Implement reviewed filter using `reviewed_at IS NULL/NOT NULL`.
- Implement amount range on `transactions.amount` (absolute amount).
- For includeTags, fetch tags in a second query by transaction IDs and merge server-side (avoid join duplication).

### Client Integration

- Update `Transaction` type to `amount: MoneyDto` (or MoneyValue) and use money helpers in UI.
- Replace sign inference with `transaction.type` and `isTransferIn`.
- Wire filter state into the query (search, amountMin/Max, reviewed, owner, tags).
- Update pagination logic in `useInfiniteTransactions` to use total count.
- Use the summary API instead of page-local aggregation.
- Tag edits should call tags API with tag IDs, not updateTransaction.
- When includeTags is false, use tagCount or tagIds for display.

### Tests

- Backend: add tests for filter combinations, sorting, search, tags, and count accuracy.
- Backend: validate negative amount updates are rejected.
- Frontend: add tests for MoneyDto parsing, sign rendering, and infinite scroll.
- E2E: verify filters match API results and summary totals are correct.

## Comprehensive Implementation Plan

### Phase 0 - Alignment Decisions (Locked)

- Lock decisions:
  - Cross-currency transfers supported with FX tracking.
  - `convertedAmount` stored in base currency with fx metadata on transfer rows.
  - Tag filtering uses ANY tag match (OR logic).
  - `includeTags` optional with two-query merge.
  - Owner/review updates use dedicated endpoints.
  - Income/expense currency must match account currency.

### Phase 1 - Backend Correctness

1. Add total count support for list queries with all filters and visibility.
2. Implement search, tags, amount range, reviewed filters, and sorting in repository.
3. Extend validation schema to include new filters (amountMin/Max, reviewed, includePending, tags list).
4. Update controller to use `count` from backend instead of page length.
5. Add optional tags on list response (two-query merge by transaction IDs).
6. Validate idempotencyKey as uuid.
7. Add FX fields to transfer rows and validate FX inputs on cross-currency transfers.

### Phase 2 - Client Data Model and Pagination

1. Update client Transaction type to MoneyDto (or MoneyValue).
2. Update TransactionRow/Card/Detail and filters util to use Money helpers.
3. Fix sign display logic (type + isTransferIn).
4. Fix `useInfiniteTransactions` to use total count for next page.

### Phase 3 - UI Filters and Summary

1. Wire filter state to API query (search, amountMin/Max, reviewed, owner, tags).
2. Decide on single filter model and remove duplicates (features vs components).
3. Use server summary endpoint for summary panel (or add new summary endpoint with filters).
4. Update owner and review actions to call the correct API endpoints.
5. Display tags from includeTags or tagCount/tagIds fallback.

### Phase 4 - QA and Performance

1. Add unit/integration tests for list filters and pagination count.
2. Add client tests for MoneyDto handling and reviewed/owner actions.
3. Add DB indexes for search and tag filters if needed.

## TODO List

- [x] Confirm data contracts (MoneyDto, tag filter semantics, review endpoint). _(Completed: Phase 0)_
- [x] Add count query with filters and visibility. _(Completed: Phase 1)_
- [x] Implement sorting, search, tags, reviewed, amount range filters. _(Completed: Phase 1)_
- [x] Return total count in list response. _(Completed: Phase 1)_
- [x] Update API types to MoneyDto for Transaction.amount. _(Completed: Phase 2)_
- [x] Fix sign rendering and MoneyDto parsing in list/detail components. _(Completed: Phase 2)_
- [x] Fix infinite scroll pagination logic. _(Fixed: useInfiniteTransactions now uses pageSize instead of count)_
- [ ] Connect filters to query and unify filter models. _(Partial: useTransactionsQuery now supports userId; infinite list path still uses separate params)_
- [ ] Replace local summary with server summary. _(Partial: client uses server totals; FX conversion deferred as known limitation)_
- [ ] Fix owner and review update flows. _(Partial: review uses /review; owner changes still flow through update schema)_
- [x] Add idempotencyKey uuid validation. _(Already implemented: z.string().uuid())_
- [x] Add FX fields and validation for cross-currency transfers. _(Closed: FX fields stored, convertedAmount stored in account currency by design)_
- [ ] Add includeTags param with two-query merge and tagCount/tagIds fallback. _(Deferred: Low priority)_
- [x] Add tests for list filters, pagination, MoneyDto, and review actions. _(Completed: Phase 5)_

## Current Status Summary

Closed:

- Review uses dedicated /review endpoint in UI. `client/src/features/transactions/components/TransactionDetailModal.tsx`
- Owner filter is derived from filters in Transactions page. `client/src/pages/Transactions.tsx`
- Sort contract matches server enum. `client/src/features/transactions/types.ts`

Open/Partial:

- includeTags/tagCount response contract still missing. `server/modules/transactions/transactions.controller.ts`

Closed:

- Summary math now uses FX conversion for multi-currency aggregation. `server/services/transaction/queries.ts` (line 178)
- `convertedAmount` stored in base currency when possible. `server/services/TransferService.ts` (line 135)
- Date parsing uses local date to avoid timezone issues. `client/src/pages/Transactions.tsx` (line 184)
- Review flow uses dedicated /review endpoint. `client/src/features/transactions/components/TransactionDetailModal.tsx` (line 150)
- `count` now equals `totalCount`. `server/modules/transactions/transactions.controller.ts` (line 99)
- Owner filter supported in hook (requires passing userId). `client/src/features/transactions/hooks/useTransactionsQuery.ts` (line 60)
- Sort contract matches server enum. `client/src/features/transactions/types.ts` (line 50)
- Infinite scroll uses `pageSize` instead of `count`. `client/src/hooks/useTransactions.ts` (line 69)

## QA Test Matrix (Suggested)

- List pagination shows correct total count with large dataset.
- Sort by amount/date/description in both directions.
- Search matches name, originalName, notes, and merchant name.
- Tag filter returns only tagged transactions.
- includeTags does not break pagination; tagCount renders without extra queries.
- Amount range filter uses absolute amount and matches UI.
- Reviewed filter returns correct reviewed/unreviewed sets.
- Owner filter includes shared/all/mine correctly.
- MoneyDto renders correctly across list/card/detail and summary.
- Summary totals match server summary for a date range.
- Cross-currency transfer validates FX rate and stores convertedAmount and fx metadata.

## Open Questions

- None. Decisions above are locked for implementation.
