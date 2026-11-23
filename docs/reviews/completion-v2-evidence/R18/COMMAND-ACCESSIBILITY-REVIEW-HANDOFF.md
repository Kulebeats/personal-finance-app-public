# R18 palette accessibility: independent review required

Resume the existing author, not canonical application source:
`C:\Users\USER\.codex\worktrees\capital-r18-command-accessibility\personal-finance-app`.
Base19013fba1924f26aa77f60fb1ce5ee6711f2032d. Read this brief, then
COMMAND-ACCESSIBILITY-CANDIDATE.md and the master R18 requirements.

## Exact candidate and verified scope

Author `.local/r18-command-accessibility/source-freeze.json` hashes166 source
files,13 owned. It modifies two inherited paths (palette and its shortcut tests),
adds11 paths, and preserves153 inherited hashes. Manifest SHA256:
`54ea8f84a027609b2553874698750c9bf7c9030b01f483e5d8a0025b52976409`.
Its status records full check running at freeze creation; later
`verification-final.json` records exit0 and matching source parity.

Owned production: CommandPalette.tsx, ui/command.tsx, hooks/useCommandPaletteFocus.ts.
Owned tests: components/__tests__/CommandPalette.shortcuts.test.tsx and the nine
files in components/__tests__/browser-command-palette/. Final source snapshots are
under `.local/r18-command-accessibility/final-source/`.

The palette has real DialogTitle/Description and explicit aria-modal. Optional
typed autofocus/aria-modal props forward only to existing DialogContent; omitted
caller behavior stays unchanged. The local hook captures the external invoker,
content identity and route, suppresses Radix's null-trigger default on close, and
restores only current, visible, enabled, non-inert focus ownership. It respects
route changes, later dialogs and destination focus. Presence reopening of retained
content refreshes invoker and input focus. Command execution synchronously closes
the modal before the existing command to release its trap before destination
autofocus. Shared Dialog/provider/Layout and financial contracts are unchanged.

Final parent execution:34/34 actual-component tests (component-final.log,14.30s),
full npm run check exit0 (check-final.log), and complete20-scenario browser pass.
Browser packet `.local/r18-command-palette/browser-f3c0daee-fe01-4d96-85aa-91568594f2a0/result.json`
SHA256 `235e57c99920cf628da032a927db330bef9d74adcbe89a3b07965da97a2cabd3`.
No page errors, console warnings/errors or forbidden requests; owned browser/Vite
closed. No database started; final process/listener checks are empty. LOC baseline
unchanged; palette336 versus baseline339. Parent viewed the opening screenshot,
which captures an animation frame; it is not a settled visual-design acceptance.

## Review focus and preserved failures

General reviewer inspected earlier callback guards but hit a usage limit before
final approval. Implementer/browser agents also terminated with explicit quota
errors. No final general, TypeScript or Astra approval exists for this candidate.
Do not inherit the earlier shortcut or navigation approvals. Root completed the
last runtime-driven repairs while review was unavailable; those need fresh scrutiny.

Review especially: retained-content false-to-true lifecycle; stale close callbacks;
route leave/return invalidation; destination/other-dialog ownership; visibility and
disabled ancestry; synchronous close before commands; unchanged caller defaults;
and whether the actual-browser fixtures establish the claims. Programmatic opening
from an already focused input and rapid retained-content transitions merit explicit
review if current coverage is insufficient. Do not infer screen-reader conformance.

Retain name RED2/17, Escape RED1/19, first expanded test fixture failures2/32,
animated-reopen browser RED3488628d, missing aria-modal REDae890210, fresh-invoker
readiness RED8b000f8e and destination-autofocus REDa45f8000. Corresponding filtered
passes are diagnostic only; full browser f3c0daee covers20 scenarios after repairs.
The fixture's protected runner argv offset and source-hash inclusion were corrected.
Its opening helpers yield two rendered frames for effects; this does not prove
Escape handling before those effects install. Review this limit candidly.

## Next action and authority

When designated reviewer capacity is available, assign independent general and
TypeScript reviewers against these exact bytes and raw evidence, then Astra High
final assessment before canonical integration. Do not repeatedly retry unchanged
quota errors or silently change approved models. Fix review findings in this author
and rerun only checks justified by those changes, preserving all previous evidence.

Local source/tests/evidence are authorized. Production/shared databases, real
external messages, paid providers, deployment and release remain separately gated.
All101 canonical groups, full authenticated application, real phone/screen-reader,
persistence and release acceptance remain OPEN. The goal remains active; this
bounded passing candidate is not the campaign's completion.
