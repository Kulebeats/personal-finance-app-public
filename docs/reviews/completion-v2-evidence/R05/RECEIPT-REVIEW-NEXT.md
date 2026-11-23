# Next bounded R05 consumer: receipt review preference

Read-only inventory,30 October2026. Not implemented or accepted. The full R15
receipt workflow, R08 financial executor and all101 completion groups remain OPEN.

Current candidate ReceiptDetailModal.tsx handleOcrSuccess stores OCR results,
then may call handleCreateTransaction when autoCreateFromReceipt is enabled and
confidence exceeds `ocrConfidenceThreshold || 80`. It ignores requireOcrReview
and announces transaction creation before conversion acknowledges success.
ReceiptScanningCard exposes the manual-review preference; ReceiptDetailsTab already
provides ReceiptReviewForm with an explicit submit callback. Master section2 says
scans remain proposals until reviewed. Saving the preference alone did not wire
this consumer.

## Dependency-ready repair

Use a derived author, preserving the remembered-account candidate. Own only the
receipt modal, a receipt-local helper if justified, and focused modal regressions.
Keep OCR proposals in the existing review form when manual review is enabled or
own preferences are missing, errored or identity-mismatched. No automatic
conversion call may occur in those states. Preserve explicit reviewed submission
and financial payloads; do not modify server conversion or ledger contracts.

Delayed OCR/store completion must recheck its originating operation and receipt
purpose, plus latest acknowledged own preferences from the original QueryClient,
including cache changes before React rerenders. Replaced receipt or retired
identity must not authorize an old continuation. Do not announce a financial
save before its actual acknowledgement. These are client consumer safeguards,
not full OCR, provider, persistence or financial correctness evidence.

Write failing regressions before production: high-confidence OCR with review
enabled; unavailable/error/mismatched preferences; enabling review/disabling
auto-create during awaited storage; layout-effect/cache-before-render changes;
retired identity/replaced receipt; preserved explicit review submission; and no
premature success. Review independently, run protected focused tests and check,
then identify a real local receipt journey only if its dependencies permit it.

## Unresolved scope remains explicit

Automatic conversion when manual review is disabled conflicts with the master's
mandatory-review wording and requires the existing Astra architecture/policy
checkpoint. This bounded repair does not resolve that conflict or close R05/R15.
Zero confidence-threshold handling belongs with the automatic-conversion decision;
do not silently broaden automatic behavior during this repair.

Merchant-category memory has a separate personal/shared precedence question:
TransactionFormFields applies a household merchant default regardless of the
personal switch, and useTransactionForm writes that shared default. Existing
MerchantService household validation is not evidence of a cross-household bug.
Timezone precedence remains unresolved in MANUAL-DRAFT-DEFAULTS-NEXT.md. Import
switches remain with R09/R11 and the R08 prerequisite; do not duplicate R09 work.

Inventory by account_memory_integration, Sol Extra High, read-only. Coordinator
records this bounded next task under existing local implementation authority.
