# R05 receipt review consumer candidate

Allocated30 October2026 from canonical27d1f9394c4b3c2d40b60d4dce73784e296612cb.
Governing contract: RECEIPT-REVIEW-NEXT.md, master R05/R15 and R02 lifetime rules.
Author `C:\Users\USER\.codex\worktrees\capital-r05-receipt-review\personal-finance-app`,
branch `codex/r05-receipt-review`, received114 hash-verified frozen Shared-owner
candidate files. Inherited manifest SHA256
`2ccc0f804a2b30970b85e05e89d4a4e49494ce140b7a1929cc9cc8f0d69ce411`.
Prior authors remain frozen. These are local candidate dependencies, not full
packet closure or canonical source integration.

## Ownership and settled boundary

account_memory_core (Sol Extra High) owns new receiptOcrAction.ts and its pure
tests under client/src/components/receipts. account_memory_integration (Sol Extra
High) owns ReceiptDetailModal.tsx, a receipt-local hooks/useReceiptOcrReview.ts
extraction if needed, and its component regressions. The extraction preserves
the300-line component guard; the existing modal is298lines. Shared OCR/receipt
hooks, global identity/query APIs, server/schema and financial payloads are out
of scope. account_memory_review independently reviews; parent owns test windows,
canonical records and subsequent language review scheduling.

Use the existing useOcrProcessor invocation overload to capture a distinct action
before Blob prefetch. Require live non-null operation expectations and current
receipt purpose before storing OCR and in delayed continuations. Receipt changes,
close (even before parent props update), unmount, repeat scans and A-to-B-to-A must
retire the prior action. Old prefetch errors must not notify the new receipt.
Read current acknowledged preferences from the original identity-bound QueryClient
at the store-success boundary; rendered snapshots can lag acknowledgements.

Manual review true, unknown/error or mismatched own preferences must keep OCR as a
proposal with zero automatic conversion. Preserve explicit reviewed submission.
Remove the eager automatic-creation announcement; the existing create hook already
reports actual acknowledgement. This does not claim all global receipt mutation
hooks' lifetime behavior is repaired.

The existing false-review opt-out branch is compatibility behavior pending Astra
policy adjudication against the master's mandatory-review language. Requiring an
explicit acknowledged false/auto-create true narrows its guard; it is not approval
of automatic conversion. Do not expand that branch or change `threshold || 80`
zero handling in this slice. Full R15 conversion/idempotency, OCR assets/providers,
runtime/persistence evidence and all101 groups remain OPEN.

At allocation canonical Git was clean, prior workers were terminal and no owned
PostgreSQL/browser process was active. Separate R09 remains terminal with the same
network-permission failure; no duplicate work is assigned. Tests are written first
and parent captures RED before production edits. No execution result is claimed
at allocation. Production/shared-DB/external-message/provider/release gates remain.

## Initial evidence and coherent review-form repair

Protected helper-red failed collection because the new helper was not implemented;
it is not behavioral proof. The modal baseline test faithfully dispatches either
the existing hook-options success callback or the new per-invocation callback,
so manual-review cases reach actual old store/conversion behavior. receipt-red
recorded26 failures and38 passes across64 tests (29 modal,35 helper). The first
controller implementation passed70/70 across those files and the existing OCR
lifetime/transaction-receipt ownership suites. General source review cleared that
bounded safeguard, explicitly not claiming live OCR or server persistence ordering.

Real-form investigation then found gaps hidden by callback-button mocks: the footer
submitted original receipt.ocrData instead of corrected form values, and optional
tax initialized to an empty string rejected by its optional schema. These must be
repaired within the manual-review workflow; a valid-tax-only fixture would not
prove the intended behavior. New actual ReceiptDetailsTab/ReceiptReviewForm/Footer
tests retain real fields and QueryClient/mutation pending state, while OCR/network
boundaries remain controlled. They do not constitute real Tesseract or SQL proof.

Ownership is expanded coherently: core worker owns these three review UI files and
the new real-form test; integration worker owns the modal's shared useId/form
association and readiness guard, plus local OCR-store error feedback. Both submit
buttons must use the same validated current form data. Blank optional tax is
normalized locally to undefined, without changing the shared schema or financial
payload. Pending/no-account/no-data readiness applies to the handler as well as
buttons. Same-receipt refetch should preserve dirty corrections; a new receipt
identity remounts the form so corrections cannot carry to another receipt.
Missing OCR-store error feedback is addressed locally with a fixed current-action
message; obsolete errors stay quiet. These additions require separate failing
regressions before their production edits.

The actual browser OCR path is not yet same-origin: default Tesseract worker/core/
language requests use CDNs rejected by the protected browser. Lockfile-pinned local
worker/core/English assets are installed, but browser asset wiring is absent. This
is a concrete R15 prerequisite, not justification to mock CDN requests and label a
journey real OCR. Current test-mode browser CSP is disabled and cannot establish
production CSP compatibility. Prepare a bounded local-assets follow-up after this
consumer candidate; do not claim persisted OCR review from the component suites.

Other limits stay explicit: a client fence cannot undo an already-dispatched OCR
store or solve overlapping server write order; shared receipt mutation hook toasts
are outside this local controller. The merchant picker cannot yet enter an unlisted
corrected name; that remains R15 work rather than a claim of complete review UX.

## Validation-await boundary and test-fixture correction

Independent source review traced the installed React Hook Form resolver await.
The originating LifetimeQueryClient already rejects mutations after identity
retirement, but closing or replacing a receipt within one identity does not retire
that client. The reviewed-submit callback therefore needs a receipt-generation
guard captured before validation and checked immediately before mutation. Close,
unmount and A-to-B-to-A retire the old purpose. Current receipt/account readiness
and a synchronous in-flight guard also apply; this does not provide server
idempotency. Integration owns a receipt-local submission hook if needed; shared
QueryClient and useReceipts remain outside this change.

The first expanded review-form-red run recorded13 failures/31 passes. Most real
form cases stopped at a fixture assertion: the installed mutation function also
receives a context argument. Those failures are retained but are not evidence of
the downstream UI defects. Corrected review-form-purpose-red asserts the exact
first payload and call count, preserves real mutation scheduling, and records22
failures/32 passes. It reaches wrong/absent submitted values, erased corrections,
late receipt-purpose callbacks and duplicate submissions. The mock-only raw-error
toast absent from the real OCR-store hook was removed. Deferred validation tests
delay the real schema parser without replacing its result. Their plain test
QueryClient does not represent the App's independent identity-bound client fence.

Two invalid-tax cases initially stopped at an incorrect native-step assumption:
the controlled numeric input's value attribute changes the step base. Corrected
invalid-tax-red exercises actual controls and schema errors: Confirm & Save
passes and the raw-data footer fails (1 failure/1 pass/16 skipped). No native
constraint or shared schema was changed to satisfy that fixture.

The first expanded implementation run, review-green, passed93/95 and exposed a
real clearing defect: passing undefined through RHF Controller restores the
initial tax instead of retaining a blank correction. Both clear-tax cases fail.
Independent review confirmed it. Integration now owns the minimal form correction:
retain an empty controlled value and normalize blank tax at the local resolver
boundary. The failed run remains evidence; it is not labelled a full GREEN.

Review also exposed two gaps subsequently reproduced independently of those tax
cases. confirm-readiness-red fails because Confirm & Save remains enabled without
accounts (footer already disables). account-purpose-red uses the actual account
select while the real schema parser is delayed: submission begun for account A
incorrectly posts to B after selection changes. The fix retains the originating
account through validation, rejects a changed/missing current selection and permits
a fresh explicit B submission. Both controls now reflect account availability;
the handler still enforces readiness beyond disabled controls.

After these source repairs review-final-green passes96/96 in five files. The
subsequent full check fails30 test-only TypeScript errors: unsupported exact in
ByRoleOptions and two mock parameter type mismatches. Those diagnostics are retained
in check.log; repository-wide check acceptance is still pending its mechanical
test-type correction. No source/runtime/persistence claim follows from96 component
and unit passes alone.

## Final bounded local checkpoint

The mechanical test correction removes unsupported role-query exact options
(literal role names already match exactly) and types OCR fixture data with its
actual shared type. No assertion was weakened. check-final.log exits0 through the
full repository TypeScript, runtime declaration, LOC, Node-tool syntax and metadata
checks. review-final-typed-green.log passes96/96 in five files in9.92seconds:
35 action-helper cases,36 controlled modal cases,19 actual review-form cases and
6 existing OCR lifetime/transaction-receipt ownership cases. The final real-form
cases use actual RHF/schema/native form association with controlled OCR/transport,
not a live Tesseract browser or SQL server.

Independent general and TypeScript reviews clear the bounded final source/test
delta; their raw reports retain the resolved tax and account-target findings.
The general review records exact hashes of all seven production files. The
TypeScript reviewer also inspected the final test-only type correction and fresh
full-check/96-test results. Reviewers did not claim their own runtime execution.

Final124-file source freeze in the author:
`.local/r05-receipt-review/source-freeze-final.json`, SHA256
`158d6b1dc7ddc4e52bb97df6fc0432b9a32d9124a084d921111cc611eb4437ad`.
All114 inherited source hashes are unchanged; the10-file receipt delta is captured
separately under final-source in the evidence folder. The manifest was created
before the final TypeScript report, so its timestamped pending-review metadata is
superseded by that report without changing source hashes. Git changed/untracked
inventory was compared with the manifest, not inferred from the inherited list.

Canonical41-file evidence copy:
`.local/r05-receipt-review-oct30/receipt.json`, SHA256
`f23a36fcf8ad02efac2e73b81cfe26d9d4d1f118de9afcbebba59326460a8ae3`.
Every copied source snapshot, failed/passed log and review report matches its
author hash. This is canonical evidence packaging, not canonical source integration.

No database, browser, provider or production process was launched for this slice;
no owned receipt-review Node process remained after validation. Source remains
isolated/uncommitted pending Astra final review and canonical source integration.
All101 groups and release gates remain OPEN. The prepared next bounded prerequisite
is `../R15/LOCAL-OCR-ASSETS-NEXT.md`; it does not approve a CSP relaxation or claim
production OCR acceptance.
