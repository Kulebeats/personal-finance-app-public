# R05 next consumer: remembered transaction account

Read-only inventory plus bounded implementation plan,30 October2026. Not an
implementation or acceptance claim. Governing master R05.1 and R02/R04 identity/
visibility contracts remain authoritative; R08 financial posting stays separate.

Current derived author `capital-r05-manual-drafts` reads global lastAccountId in
useTransactionDraftInitialization.ts even when remembering is disabled. Ordinary
edit and ordinary/recurring create write it after awaited operations; those storage
continuations have no immediate originating-lifetime check. Transfer create/edit
return before writing, though create defaults already restore the primary source
accountId for transfer mode. The control is not fully implemented by persistence.

## Contract and ownership

Use a transaction-local helper and the existing R02 captured operation expectations.
Require non-null operation with subject and household, and active lifetime before
each storage access. assertOperationLifetime(null) currently succeeds and alone
does not authorize storage. A stable versioned tuple of purpose, subject and
household namespaces the key; store only the account ID, not role or ephemeral
lifetime ID. Do not change shared SessionContext, operation-lifetime or queryClient.

With false/missing/errored/identity-mismatched preferences, make zero localStorage
calls. Never adopt or migrate global lastAccountId. Do not infer a clearing or
retention policy from disabling the control. Storage failure means unavailable
optional memory and cannot turn a committed financial mutation into apparent failure.

Restore only a new draft with no explicit/dirty accountId after a successful
identity-bound useAccounts list. Match the stored ID to that list and the existing
picker eligibility, without inventing an account-type allowlist or fetching that
ID separately. Current SQL excludes deleted/archived/hidden/private-other accounts;
the list is cached30seconds and is not a fresh authorization proof. Server remains
authoritative. Late account loading/refetch cannot reset the draft or override
manual choice. If waiting/error handling joins initialization, update its wording
and retry behavior truthfully; it currently says transaction preferences.

At successful write boundaries, recheck originating lifetime, latest acknowledged
own preference and eligible account. Disabling during an in-flight save suppresses
the eventual memory write. Failed financial mutations never remember.

Transfer remembrance is currently missing. For the local consumer implementation,
use the form's primary accountId (From Account), matching existing restoration;
do not store the destination or alter transfer payload/ledger behavior. Cover this
explicitly alongside ordinary/recurring create and edit. This engineering choice
must be included in the existing Astra final review, not silently counted as prior
behavior. Cross-device/server memory and clearing/retention changes are out of scope.

Likely ownership: new transaction-local account-memory helper,
useTransactionDraftInitialization.ts, useTransactionForm.ts and focused memory/hook
tests. Readiness UI only if needed for account-query readiness. Do not edit server,
schema, global account/query hooks, shared merchant/category behavior or financial
posting services. Use a derived author and preserve the104-file frozen candidate.

## Required evidence

- Two actors in one household and one actor in two households cannot reuse memory;
  null/missing/retired expectations and global legacy value never authorize reads.
- Disabled/unknown preference makes no storage calls; valid current listed ID
  restores; absent/deleted/inaccessible/hidden/archived IDs leave blank.
- InitialValues/edit/dirty values win; delayed account loading/error/retry/refetch
  does not overwrite user input or reset amount/date/type.
- Delayed old-identity save and disable-during-save cannot write memory. Successful
  ordinary/recurring create/edit and transfer-source paths remember only their
  eligible primary account; failed saves do not. Storage exceptions do not report
  a committed transaction as failed.
- Independent source review and meaningful protected tests; bounded real browser
  reload/identity evidence where dependency-ready. Keep financial authorization,
  cached visibility and local preference evidence distinct.

Inventory by personal_preferences_next_inventory, Sol Extra High, read-only.
Final consumer scope above is coordinator-adjudicated; no permission request or
new shared identity contract is implied. All101 groups remain OPEN.
