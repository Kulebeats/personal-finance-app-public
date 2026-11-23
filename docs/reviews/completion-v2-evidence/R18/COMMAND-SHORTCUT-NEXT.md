# R18 next bounded command shortcut repair

Read-only inventory on30 October2026 identified the offered `Go to Goals / G then G`
shortcut as unreachable. CommandPalette.tsx handles every `g` as a new prefix and
returns before dispatching its existing `g: /goals` entry. Clicking the command
works through a separate handler. Master R18.2/keyboard behavior and observable
control-result acceptance govern this repair. No new navigation destination,
financial/security policy or keyboard convention is required.

CommandPalette.tsx is identical in canonical and the R18 navigation author:
SHA256 `4788ec24655e9a6dfbc2ed1d988b9e346b781a4f67229b3316f385c5a8b3e181`.
Ctrl/Cmd+K already works through CommandPaletteProvider. Layout's unattached search
ref does not prevent that provider action. Do not wire a global slash action:
Transactions owns slash-to-search, and no offered global slash convention was found.

Next allocation: derive a fresh isolated author from the completed R18 navigation
source freeze, preserving every inherited hash and its still-pending Astra gates.
One Sol Extra High worker owns only CommandPalette.tsx and focused actual-component
tests; a second worker is unnecessary for this small dependency-bound edit. Parent
runs meaningful RED/GREEN, full check and independent general/TypeScript review.
No shared Layout/provider, package, server, database or test-harness changes.

Mount the actual palette/provider with real Wouter navigation and inert data hooks.
Two keyboard events from a noneditable element must reach /goals. Cover G then A,
the existing one-second expiry, editable exclusions and Ctrl/Cmd+K opening one
actual dialog. Resolve an active sequence before starting another prefix; preserve
existing timing, destinations, input exclusions and click behavior. Do not expand
the scope into shortcut-policy changes. Keep LOC debt unchanged or reduced.

This is a prepared next task, not an implemented or tested repair. All101 canonical
groups, full R18/application/device acceptance and release gates remain OPEN.
