# R18 command palette accessibility candidate

Allocated30 October2026. Author
`C:\Users\USER\.codex\worktrees\capital-r18-command-accessibility\personal-finance-app`,
branch `codex/r18-command-accessibility`, base
`19013fba1924f26aa77f60fb1ce5ee6711f2032d`. It inherits155 verified source files from
shortcut freeze `a0c0fe01b3fc2bbf166bd4c4eaf5e751c2d2f65846deee3b5cf2a484cac798d7`.
See `COMMAND-ACCESSIBILITY-NEXT.md` and local allocation receipt.

One Sol Extra High implementer owns CommandPalette.tsx and its focused actual
component tests. Parent serializes execution; independent general/TypeScript
review and Astra final review remain separate. Initial actual19-case suite has
meaningful RED2 failures/17 passes: Ctrl/Cmd+K opens an unnamed dialog. Local title
and description repair is authorized; prior missing-semantics warnings must be
removed from test expectations after repair, without suppressing other warnings.

Installed Radix inspection also suggests keyboard invocation lacks a trigger ref
for normal focus return. A separate accessibility specialist is checking callback
ordering and a bounded solution while the implementer adds a meaningful Escape
regression. Focus/shared-command-wrapper changes are not yet part of the allocated
source delta; record the settled local contract before implementing them. Provider,
Layout, shared Dialog primitive, routing, financial and security behavior stay
outside scope. No production/shared DB, provider, release or other external gate
is changed; all101 groups and the goal remain OPEN.

## Settled local focus contract

The title/description repair passes all19 prior cases without console waivers.
A twentieth actual-component test fails only after Escape: dismissal and initial
combobox focus work, but invoker focus is lost (`focus-red.log`,1 failed/19 passed).
The resumed read-only specialist verified installed Radix Dialog1.1.15/FocusScope:
open autofocus runs before default initial focus; consumer close autofocus runs
before the null-trigger restoration, asynchronously through the latest callback.

Extend this slice to typed optional onOpenAutoFocus/onCloseAutoFocus forwarding in
ui/command.tsx, passed only to DialogContent. Omitted callbacks preserve existing
callers. Palette-local focus ownership may live in a small dedicated hook to avoid
LOC debt. Shared Dialog, provider, Layout, route/search behavior remain unchanged.
Capture invoker/content identity/current route at open without cancelling initial
focus. Restore only matching closed-session focus on unchanged route to a connected,
enabled, visible invoker outside hidden/inert content. Prevent default null-trigger
restoration; never override a reopened palette, destination focus or another dialog.
Missing/removed invoker has no invented fallback. Ordinary Escape and Close share
this path; preserve editable shortcut exclusions.

Ownership is now CommandPalette.tsx, ui/command.tsx, optional focused local hook,
focused component tests and an isolated component-browser fixture. Parent runs all
tests/browser windows, with inert effectful data and no database/app server. Actual
browser verification must cover keyboard and header-like button invocation, focus
containment/return, hidden/disabled invokers, route transitions and rapid reopen.
These extend the previously documented two-file plan to repair the reproduced
focus defect; routine local UI authority covers the change. Independent reviews
and Astra final remain required. Previous quota failures are retained; resumed
specialist/implementer availability was verified before continuing.

## Interrupted review and actual-browser counter-evidence

The expanded component candidate initially passed32/34. The removed-invoker case
directly removed a React-owned node, causing cleanup failure; the aria-hidden case
modified Radix's own hidden root, whose attribute it legitimately removed at close.
React state and a separately owned wrapper repaired those fixtures. The unchanged
production candidate then passed34/34 (`component-fixture-fixed.log`,2.88s).

Both implementers and the general reviewer subsequently stopped with explicit
usage-limit errors. Parent verified terminal agent status and continued local
execution; no independent final approval is claimed. No unchanged quota retry or
model substitution was used. The completed browser fixture was inspected before
execution. Parent corrected its protected-importer argv offset and added the focus
hook to recorded source hashes; these changes await independent review.

Actual filtered browser packet3488628d failed the predicted animated reopen:
Presence reused the same content node but mount autofocus did not run again, leaving
focus on the header-like invoker outside the reopened modal. The local hook now
handles false-to-true reopening of retained connected content, refreshes the invoker
and focuses the actual command input. Packet e17346c3 passes that unchanged scenario.
This is filtered evidence only. The next complete run exposed missing aria-modal;
the palette now explicitly forwards that optional attribute through CommandDialog
to Content, leaving omitted caller defaults unchanged. Packet ae890210 is retained.

Packet8b000f8e passed three opening scenarios then failed the fresh-invoker case:
Escape was sent immediately after initial focus while dialog effects were still
settling. The fixture now yields two rendered frames after successful opening,
using its existing real queued-effect helper rather than increasing assertion
timeouts. The focused fresh-invoker scenario passes in e19ccaaa. This is fixture
readiness evidence, not proof of behavior before effect installation. Final complete
browser, repository check and independent review remain pending at this checkpoint.

The third complete browser attempt (a45f8000) passed13 scenarios, then showed
destination autofocus lost during command navigation: the new destination tried
to autofocus while the closing modal trap still owned focus. The palette now
synchronously commits close before invoking its existing command, releasing the
trap without changing destinations or actions. The same filtered destination
scenario passes in d69fc33c. This behavioral repair also awaits independent review;
no prior static approval or34-case pass is represented as covering these new bytes.

## Verified local checkpoint; final review pending

Final component suite passes34/34 on current source (`component-final.log`,14.30s).
Full repository check passes (`check-final.log`,exit0), with no new/grown LOC debt.
Complete browser packet f3c0daee-fe01-4d96-85aa-91568594f2a0 passes20/20 scenarios,
including native keyboard/header-like invocation, semantics, containment/return,
invalid invokers, destination/lazy-route focus, actual retained-node animated
reopening and newer-dialog/session ownership. No console/page errors or forbidden
requests. Its result SHA256 is
`235e57c99920cf628da032a927db330bef9d74adcbe89a3b07965da97a2cabd3`.

Source freeze166 paths/13 owned (153 inherited unchanged, two inherited modified):
`.local/r18-command-accessibility/source-freeze.json`, SHA256
`54ea8f84a027609b2553874698750c9bf7c9030b01f483e5d8a0025b52976409`.
The manifest records the full check still running at creation; subsequent
verification-final.json proves check/component/browser exit0 and matching source.
No owned Node/browser process or relevant listener remains; no DB was started.

Canonical113-file copy retains both evidence directories, including every failed
packet, with all copied hashes verified:
`.local/r18-command-accessibility-oct30/receipt.json`, SHA256
`7f89a602c5911fdbd1818db117b921242a944f7b24e311c6ecf44c1e9e8c7a6c`.
Read `COMMAND-ACCESSIBILITY-REVIEW-HANDOFF.md` for the exact next review action and
remaining evidence limits. Final general/TypeScript review is unavailable due to
terminal usage-limit errors; no approval or canonical source integration is claimed.
Astra final, full-app/device/persistence and release gates remain pending. All101
groups and the active goal stay OPEN; local passing tests do not close the campaign.
