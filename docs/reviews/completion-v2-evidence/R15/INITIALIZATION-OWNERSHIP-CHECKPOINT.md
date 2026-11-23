# R15 initialization ownership checkpoint for Astra

Decision required; not implemented or approved. Read this brief, then
LOCAL-OCR-ASSETS-CANDIDATE.md and its exact source/evidence receipts. The bounded
same-origin positive proposal path passes, but real missing-language initialization
acceptance fails. Production CSP and automatic-conversion policy are separate gates.

## Verified defect and current authority

Author: `C:\Users\USER\.codex\worktrees\capital-r15-local-ocr\personal-finance-app`,
basecd0b38d4, source freeze138 files / SHA256
`dc84bc782a38933149400530191a562c5f070c3afeb64d6f7e7f3e7d787dbebf`.
Canonical evidence: `.local/r15-local-ocr-oct30/receipt.json`,90 files / SHA256
`76c5ae80bd1d0fc153ea447039610907b12e6e39719bd781890729c3b01e4f9d`.
Six additional untracked upload fixtures are evidence, not source. Resume source
from that isolated author or a hash-verified derivation; do not substitute canonical
source, which has not integrated this candidate.

Installed tesseract.js7 createWorker spawns a native Worker before exposing its
public handle. Native worker.onerror rejects the public promise but does not
terminate the worker. Action=load rejection rejects that promise; loadLanguage or
initialize job rejection can be swallowed by the initialization chain catch while
the public promise remains pending. The existing hook only receives a handle after
that await. Core WASM initialization also has a missing rejection continuation;
that separate failure needs real browser evidence.

Actual missing-language acceptance injected exactly one404 at the known owned
origin. The UI stayed at loading-language after5s; no OCR-store or conversion was
sent, SQL remained pending/null, and account balance/transaction count stayed zero.
Context shutdown bounded the test, not application cleanup. Source diagnostics and
the failed browser packet are retained; do not repeatedly rerun unchanged code.

## Required decision and implementation properties

Choose a supported dependency repair/version or an explicitly owned initialization
factory that makes the native termination handle available before readiness. Verify
the candidate mechanism against actual package source and supported APIs; no newer
version or public API is assumed to fix it. Preserve package licenses and pin the
chosen bytes. Do not silently patch shared node_modules, monkey-patch global Worker,
or adopt private dependency protocol without the architecture review.

The owner must retain a live handle throughout startup, cancel and unmount, settle
the caller on every failure, terminate its own native worker exactly once, suppress
stale progress/errors/results and prevent unlimited failed-start retries. Any timeout
must be coupled to real termination; Promise.race/errorHandler alone cannot clean
up a permanently hidden worker. Eventually resolved late-handle tests remain useful
but do not substitute for the never-ready case.

Keep CSP changes separately adjudicated. Direct same-origin worker URLs and pinned
assets do not alone prove production document/worker policy allows WASM. Keep real
provider/delivery, production/shared DB and release gates intact. Retain the master
proposal-review requirement and resolve the existing false-review automatic branch
before integration; the confidence-scale repair makes real scan acknowledgements
possible and is not authorization of automatic posting.

## Required independent acceptance

Use the parent-owned protected loopback runtime and fresh synthetic fixtures. Exercise
actual missing worker, core script/WASM failure and missing/corrupt English data;
then cancellation/unmount/identity and receipt replacement during never-ready startup.
Observe native worker creation/termination without replacing the library execution,
and prove bounded idle/error, no leaked app-owned worker, no stale store/toast or
financial mutation. Include a fresh explicit retry after cleanup and the successful
real scan/proposal/reload/SQL control. Preserve every failure; do not mark the negative
test skipped or alter its target state to manufacture an all-green suite.

After the architecture decision, write the concrete ownership contract/tests before
implementation, run meaningful RED/GREEN, independent general and language review,
then the required Astra final assessment. Current passing component/Node/static
asset checks cannot close this gate or full R15. Continue other authorized independent
requirements while the checkpoint is unavailable.
