# R15 local OCR asset prerequisite

Read-only preparation,30 October2026. Master R15.1 and OPS-004 require pinned,
self-hosted OCR under production CSP. This is a next-slice plan, not runtime
acceptance or permission to change shared security policy. R08 financial conversion,
R15 storage/conversion and all101 groups remain OPEN.

## Verified starting point

The current receipt-review candidate calls createWorker("eng",1,{logger}) in
client/src/hooks/useOcrProcessor.ts. Installed Tesseract7.0.0 defaults to a CDN
worker, CDN core and remote English language data. Its default workerBlobURL is
true. The protected browser rejects external origins. A mocked CDN response would
not demonstrate a self-hosted production path.

The existing lockfile install includes tesseract.js7.0.0,
tesseract.js-core7.0.0 and @tesseract.js-data/eng1.0.0. Worker, core JS/WASM variants
and English data are locally available. scripts/__tests__/ocr-runtime.test.mjs
contains a local Node OCR test; this inventory did not execute it and it is not
browser/CSP evidence.

server/app.ts disables CSP outside production. Production scriptSrc currently
allows self only; no explicit workerSrc exists. Browser worker construction can
use a direct same-origin URL when workerBlobURL is false. WASM execution and
worker response CSP still require exact browser evidence and policy review. A
test-mode browser pass cannot clear OPS-004.

## Bounded implementation and acceptance sequence

1. Derive an isolated author from the reviewed receipt consumer freeze. Record
   inherited hashes before edits. Package only explicit lockfile-pinned worker,
   matching supported core JS/WASM variants and English data from the installed
   dependencies. Record versions, file hashes and package licenses. Use versioned
   same-origin URLs and deterministic build/staging checks; no external download
   or silent CDN fallback. Check both development and built static asset delivery.
2. Supply explicit workerPath/corePath/langPath, direct same-origin worker creation
   and the selected language compression settings. Retain current cancellation,
   identity and receipt-purpose guards. Test missing/corrupt asset failure and
   cancellation while worker initialization is pending; do not convert after error.
3. Inventory the effective document and worker response headers in a local built
   runtime. Propose the narrow required policy change, if any, for the existing
   Astra security checkpoint. Keep actual production-CSP acceptance pending until
   that adjudication; do not weaken policy or run NODE_ENV=test and claim it passed.
4. In the parent's serialized protected browser/DB window, create fresh synthetic
   identities and a fresh disposable target. Through UI create a cash account and
   save review=true, auto-create=true and threshold70. Generate a synthetic receipt
   PNG, upload it, invoke actual local OCR, and verify parsed confidence reaches
   the threshold. Capture same-origin asset requests, OCR-store response and
   independent SQL proposal read-back. Verify the real review fields appear and
   no conversion request or financial row exists before explicit review.
5. Stop the acceptance journey before conversion while R08/R15 conversion policy
   remains unsettled. Preserve failures, screenshots and SQL counts; retain exact
   source and asset hashes. This proves only the bounded proposal path. Corrected
   conversion, replay409/idempotency, durable storage/restart/restore and deletion
   require their own settled implementation and evidence.

The upload path is cwd-relative uploads/receipts/<household>; there is no tested
per-run upload-root override. Verify the derived author's root is an ordinary
directory and each synthetic household target is new before any upload. Never
reuse ambient real receipt directories or claim durable storage from a test file.

No assets were copied, dependencies installed, providers contacted, CSP changed,
database started or browser launched by this preparation. Parent retains test
serialization; separate R09 ownership is unchanged.
