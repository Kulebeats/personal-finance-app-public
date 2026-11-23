# R05 personal preferences and account filter continuation

Status: read-only source trace and bounded next implementation scope; no new
code, migration, test or acceptance evidence in this document. The governing
master R05.1, NEW-11 and NEW-26 contracts remain unchanged.

## Confirmed current paths

At canonical61addbf0, all nine controls in
`client/src/pages/settings/sections/PreferencesSection/index.tsx` call the
personal-preference hooks in `client/src/hooks/use-settings.ts:1883-1952`.
Those hooks incorrectly use `/api/settings/preferences`, which is household
policy under owner/admin household.policy.write. Preserve that route's strict
contract and the existing `completion-r04.policy.realdb.integration.test.ts`
negative tests; do not repurpose it for personal settings.

The existing `user_preferences` schema at `shared/schema.ts:456-484` already
contains the nine offered fields. Defaults in current source are:

| Field | Existing default |
|---|---|
| rememberLastAccount | true |
| rememberLastCategoryPerMerchant | true |
| defaultTransactionType | expense |
| autoFillTodayDate | true |
| skipDuplicateImports | true |
| autoAssignCategoriesFromRules | true |
| autoCreateFromReceipt | false |
| requireOcrReview | true |
| ocrConfidenceThreshold |70 |

`UserRepository.ts` exposes read/create/update methods, but no personal API
writer is wired; update alone returns undefined before the first row exists.
The household controller reads these preferences. Atomic first-row creation
must preserve concurrent disjoint personal edits, using existing settings
serialization patterns and authenticated session identity.

Accounts starts ownerUserId=null in
`client/src/features/accounts/hooks/useAccountsData.ts:16-26`. OwnerFilter maps
null to Shared Only, and accountsApi sends ownerUserId=shared. The repository
then excludes personal accounts. New accounts default to their creator, so
the first successful personal creation can disappear from the current list.
The existing owner filter supports all/mine/shared, and the SQL visibility
predicate must remain authoritative. AccountList also labels a filtered empty
list as no accounts, conflating two different states.

## Dependency-ready implementation plan

1. Add a distinct authenticated personal GET/PUT endpoint such as
   `/api/settings/user-preferences`, a strict typed nonempty patch and a full
   own-preference response. Accept no supplied user/household/owner identity.
   Preserve the separate household policy endpoint and member restrictions.
2. Point the personal hooks at it; retain operation lifetime and CSRF guards,
   changed-only updates, acknowledged cache writes, failed drafts and retry.
   Check all nine offered fields through UI/API/DB/readback, including false,
   boundary values and concurrent first writes. No unknown-field success.
3. Add a versioned additive defaultAccountFilter enum preference with
   all/mine/shared and default all. Resolve mine to the current session user
   when querying; never persist arbitrary owner UUIDs. Restore saved choice
   before presenting the account list, persist changes and reset, preserve SQL
   privacy, and distinguish filtered-empty from no accessible accounts.
4. Prove two-user isolation, member personal write versus household403,
   invalid/foreign payload rejection, first-account visibility under All,
   saved filter restoration, reset and failure handling. Run migrations only
   against a freshly verified disposable target; preserve upgrade evidence.

The source trace is by Sol Extra High settings_next_inventory, read-only.
It did not run tests. Current source targets overlap the frozen settings-writers
candidate; use a derived isolated author, explicit ownership and fresh review.
Canonical integration retains Astra final assessment. Preparation under the
settled master contract can continue independently of that availability gate.

## Limits that must remain visible

Persistence alone is not full behavioral acceptance: autoFillTodayDate has an
identical-branch ternary in transactionFormUtils, import behavior flags have no
non-test consumer, and requireOcrReview lacks a consumer in the traced source.
Track these downstream behaviors with the related import/receipt packets;
do not claim a control works merely because its row saves. The already frozen
profile candidate owns separate profile work; do not overwrite it. Named shared
views, shared authorization changes and real-user retention policy remain
separate requirements/gates. All101 canonical groups remain OPEN.
