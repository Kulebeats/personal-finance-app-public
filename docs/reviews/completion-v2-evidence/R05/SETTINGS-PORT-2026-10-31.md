# R05 current-base recap and notification port

31 October 2026. Existing reviewed work consolidated in
`C:\Users\USER\.codex\worktrees\capital-r05-settings-port\personal-finance-app`,
branch `codex/r05-settings-port`, based on canonical
`f96905c95faa671cef6ceb86a395dc96e62a5306`. Preserved WIP commit:
`0b9912b721728142e3b7c45ea4fda065dfe49024`; clean after commit. This is not canonical
source integration, fresh database/browser acceptance or R05 closure.

## Source and ownership

Exactly 22 paths implement the first batch in SETTINGS-INTEGRATION-MAP-2026-10-31.md.
Two Sol Extra High workers owned eight client and fourteen server/shared paths.
Twenty final paths match their selected reviewed author versions. The settings
hook and its CSRF test were merged with current canonical personal-preference
contracts, endpoints, acknowledgement, scope and lifetime guards retained.

Sources: corrected notification `13efc5ad`, corrected recap `86e8ba38`, and the
shared writer slice of `4bc66688`. The display repository comes from recap without
the later report helper/PATCH/reset extension. The controller was reconciled from
canonical and matches the reviewed writer controller. General, investment and
recap notification writers use the common existing-user lock; route defaults,
partial fields and after-commit audit policy remain. No schema, migration,
dependency installation, report scope or C2-owned behavior was changed.

The new external worktree reuses an ignored junction to existing canonical
dependencies. Original authors and their failed evidence remain intact. This
consolidates the existing R05 queue item; do not run separate acceptance windows
against its superseded individual candidates as though they were new features.

## Fresh checks and independent review

Pinned Node 24.22.0 Windows ARM64 ran the existing protected unit wrapper:

- Before port: 53 existing hook/section CSRF and operation-lifetime tests passed.
- Combined port: 143 tests across eight client files passed, including both
  notification suites, recap, personal-preference hook/form and old callers.
- Personal-preference DTO contract: 13 unit tests passed.
- Full repository check passed, including TypeScript and all repository guards.

These are controlled-HTTP client/unit and static results. No PostgreSQL startup,
database suite or browser process ran. Historical server results certify only
their old candidates; they are not fresh port persistence evidence.

The first TypeScript review attempt terminated after application network permission
was revoked. A subsequent local read-only review succeeded, with no network or
permission workaround, and cleared all eight client paths. Astra's independent
current-base review checked all 22 source pins, 14 evidence artifacts, selected
author equivalence and preservation of canonical behavior. It cleared this exact
candidate for WIP preservation with runtime/integration gates retained.

## Retained evidence

Packet in the port: `.local/r05-settings-port-oct31a/`. Exact commands, timestamps,
raw logs, source freeze, verification and clean post-commit readback are retained.

| Artifact | SHA256 |
| --- | --- |
| `source-freeze.json` | `1f7ee732776544f7ea71a32d063fc53452d20a6729901e12b79396c6945aef11` |
| `client.log` | `c3ae4a1c8326bf00bb3a9f4462f73ee085d8943198d09241787ac55ae44dc2ae` |
| `dto.log` | `2e73ab02ff9e9127d9235e4e602d5f900eb90bf864f98c86e1dda13afdb52abd` |
| `check.log` | `dac2a7a5455673e7d20d73462b4a5df279831c3c3243cd28c0b329110d68f0c8` |
| `verification.json` | `14e5beba828d225dbbad9e6e7db614cf9c87971a645fc9f34c1ac648c08d30e7` |
| Canonical SETTINGS-PORT-REVIEW-2026-10-31.md | `353e394263a9cbdfdc4447d56375390d5036cee62d6c730d3caadfdfd5a9d208` |

All 22 source pins matched before and after the explicit-path commit. The preceding
writer-slice review is NOTIFICATION-WRITERS-FINAL-REVIEW-2026-10-31.md, SHA256
`65ff723387b593f9332d4cf861007ce7ce8d3c29b7122d2bbd6f16ba3c295da5`.
Its seven writer-specific cases must not be confused with the historical 103-pass
aggregate spanning eight server files.

## Remaining acceptance

After the outstanding owned runtime retry is resolved, serialize a fresh marked
disposable target window for this exact candidate. Exercise existing notification,
investment, recap/display and shared-writer HTTP/SQL cases plus personal-preference
and permission compatibility; retain independent readback, contention and rollback
assertions. Add/run the applicable protected save/reload browser journey before
claiming that evidence. Do not use ambient/shared databases or rerun failed cases
without diagnosis. Canonical source integration remains coordinator-owned after
required acceptance and review, preserving C2/R04/R14 ordering and conflicts.

Report settings, manual-draft/account-memory consumers, historical duplicates,
scheduled delivery and broader R05 requirements remain open. No push, PR, main
merge, real external delivery, production/shared database or release is authorized
by this checkpoint.
