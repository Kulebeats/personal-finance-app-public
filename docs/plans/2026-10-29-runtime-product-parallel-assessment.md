# Runtime and independent product work: allocation assessment

Assessment requested through the user's side conversation on 29 October 2026.
Recommendation: adopt the proposed four-slot allocation after a bounded Redis
handoff. This document recommends the transition; it does not record a completed
reassignment or change any master requirement or external gate.

## Why a separate product lane is ready

R18 lists R02, R03 and R05 as completion dependencies. They do not prevent
implementing and testing an isolated presentation/interaction repair now.
Full route, persistence, security-profile, real-phone and screen-reader acceptance
must still be recorded before closing the applicable R18 requirements.

The first independent slice should be the settings mobile navigation drawer,
covering the navigation/focus parts of R18.1 and R18.3. Current source has an
uncontrolled Sheet, no selection-close handler, and no SheetTitle/description in
its content. Section selection updates parent state and the URL. The trigger is
absolutely positioned at top-4/left-4, and the content is nested inside the outer
Layout's main landmark. These are concrete targets for failing interaction and
layout tests, not a claim that a real-browser audit has already been performed.

Proposed ownership is limited to:

- `client/src/pages/settings/SettingsLayout.tsx`.
- A focused real-component test beside the existing settings tests, using the
  real Sheet primitive and inert outer-layout/data dependencies.
- A narrowly scoped component-browser fixture/test if required to verify width,
  zoom, focus and keyboard behavior without a database or ambient app server.

Preserve every offered settings section, route and logout behavior. Implement
accessible dialog naming, selection-close behavior, appropriate focus restoration,
keyboard/Escape behavior and unclipped navigation at the specified widths. Test
320, 360, 375, 390 and 768 px and 200% zoom. Verify the actual component rather than
replacing it with MockSettingsPage or asserting strings in source. Do not modify
shared auth/query contracts, financial behavior, the global Sheet primitive or
the outer application navigation in this first slice.

No existing R18 author worktree was present in the current Git worktree inventory.
The active implementation lanes own only Redis/runtime paths; the older R02
client checkout remains separate and must be preserved.

## Preserve and hand off the current runtime work

Canonical source already contains reviewed startup extraction `29cf24b0`, Redis
operation/lifetime `5d214e88`, core-cache `72833e53`, and rate facade `2744c2da`.
The first three have fresh canonical focused/static verification. Rate facade
canonical verification is the immediate integration check. All are source or
synthetic component evidence, not live Redis/application acceptance.

The producer's real service A2 is frozen in its existing R19 author tree with
general and Python review complete; final review and the assembled controller
are in progress. Its prior failed-review A1 bytes are archived. The R04 consumer
has begun the genuine factory/slot source and is being asked for its nearest safe
handoff checkpoint. Preserve that work and its exact pins/tests/known gaps before
transferring ownership; do not restart it in another checkout or invent an issuer.

One Sol implementer can then own the remaining producer/factory/consumer join;
the other can own the independent settings slice in an isolated checkout. The
coordinator owns shared decisions, serialized runtime/broad checks, integration
and final Astra review; the independent reviewer checks both lanes. At most four
agents remain active. A waiting author should release its slot during reviews.

## Concrete exit criteria and time boxes

Use 30-minute implementation/review checkpoints with a frozen candidate, passing
targeted test, or one diagnosed blocker as the output. This is an operating time
box, not an estimate of total completion. After service/controller clearance,
make one bounded real Redis issuance/cleanup attempt. A failure produces one
diagnosed repair or an explicit handoff; do not repeat an unchanged attempt or
expand infrastructure work without tying it to a failed requirement.

The product lane reports reviewed application behavior and component-browser
results independently of runtime progress. Full user workflows remain pending
until the protected application/profile supports them. Keep all 101 master groups
open unless their full evidence satisfies the governing closure criteria.

## Transition adopted at the frozen handoff

The coordinator subsequently adopted this allocation as a routine scheduling
decision within the existing full-campaign implementation authorization. The
consumer reached a ten-file factory/slot checkpoint before reassignment:
R04 `.local/r20-installed-loading-oct28/redis-factory-slot-frozen-source-receipt.json`,
SHA-256 `7225dde35c9ce8766245929a6cf6e91e8b739dbca0f0fa356a5e05af537c500c`.
Eight negative/cold-import tests pass; static review, positive admission, actual
socket cleanup and successful slot lifecycle remain pending. The original
uncommitted files are preserved in R04. The runtime producer now owns the
remaining genuine factory/consumer join after verified handoff/materialization.

The second Sol Extra High implementer now owns the bounded settings slice in
`C:\Users\USER\.codex\worktrees\capital-r18-settings\personal-finance-app`,
branch `codex/capital-r18-settings`, based on canonical `851c1c14`. It has no
ownership of the frozen R04 runtime work. A separate read-only accessibility
reviewer supplies concrete constraints and releases its slot after review;
independent code review and Astra final review remain required. No more than
four agents are active. The coordinator remains in the canonical worktree.

The first real Redis attempt failed before issuance, with a source-consistent
subordinate cleanup receipt. It is preserved, with no unchanged retry. Runtime
work is limited next to secret-safe phase/cleanup diagnostics and one reviewed
attempt under a fresh component credential generation. This failure does not
block the settings component implementation or its focused tests.
