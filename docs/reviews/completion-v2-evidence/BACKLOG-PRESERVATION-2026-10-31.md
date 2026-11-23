# Local backlog preservation, 31 October 2026

These are source-preservation commits, not acceptance, integration, new runtime
evidence or off-device backup. No source edits were made during preservation.
Ignored evidence and unrelated primary-checkout work were left untouched. No push,
PR, main merge, database or release action occurred.

For each branch below, the coordinator recorded original HEAD and exact dirty
paths, verified no existing staged work, pinned file bytes, checked whitespace
and a bounded set of sensitive filenames/private-key/token patterns, staged only
enumerated paths and verified a clean checkout after commit. This limited scan is
not a history-wide secret scan or permission to publish. Some versions may already
exist elsewhere in history; counts are preserved file versions, not unique work.

Local receipt: canonical `.local/backlog-preservation-oct31b/pre.json` and
`results.jsonl`. Six existing branches,14 file versions:

| Branch | Files | Preservation commit |
|---|---:|---|
| codex/capital-r02-client-session | 1 | 6e8e972d371fefa5a07d32241f35caffd3598eea |
| codex/r18-greeting-port | 3 | ba06425355a3f5850a8b5c4774f501015642fe67 |
| codex/r20-application-inventory | 3 | ac9320da1023beebb2dcb768d1a1253a295b437c |
| codex/r20-file-observation | 2 | 2a1654055d62112bc72b74aa3fbdf1ff7c5709c6 |
| codex/r20-inventory-envelope | 2 | 36f44a5de6861f01a0d0f338c7d696df96ef53bb |
| codex/r20-native-probe | 3 | fe869b005f9399630d0aecdeb8b7c94844d3b5a8 |

The R20 format-proof author branch is separate: b846ea83 preserved its seven-file
implementation WIP;65851509 and b2ec05f8 preserve later regression controls.
Canonical source integration remains pending independent review. R14 d938529c,
R05 notifications fe7b7353 and recap widgets53fcdf14 were preserved earlier; see
CAMPAIGN.md for their original receipts and limits.

The subsequent sections record the larger inherited snapshots. Preserving a branch does not authorize
cherry-picking its inherited changes into the canonical campaign or merging main.

## Three larger inherited snapshots

Canonical `.local/backlog-preservation-oct31c/{pre.json,results.jsonl}` records an
additional327 file versions across three existing branches. These snapshots
include inherited edits from earlier worktree copying; no attempt was made to
claim those edits as three independent features. Source bytes were SHA256-pinned
before staging and unchanged after commit, and all three worktrees were clean.
Only enumerated code/schema/document paths were staged after the bounded checks
above; no credential files, ignored artifacts or unrelated checkout paths were
included. Original versions were not reset, replaced or merged.

| Branch | Files | Preservation commit |
|---|---:|---|
| codex/r04-shared-owner | 114 | bb1312476fed70092a8a04fb6b4d3c325a8c38d3 |
| codex/r05-account-memory | 109 | ca37359f1a6207ff1b4173edacd9c1ec220c56d8 |
| codex/r05-manual-drafts | 104 | 681f84e78a171990034ff4750c2b62115ea8a538 |

That checkpoint recorded341 preserved file versions on nine local branches,
separate from the earlier preservation commits in CAMPAIGN.md. This is still not
an off-device backup or functional acceptance. No new tests were run merely to
preserve unchanged source bytes.

## Remaining campaign source snapshots

The next bounded sweep recorded17 more existing branches and1579 file versions in
canonical `.local/backlog-preservation-oct31d/{pre.json,results.jsonl}`. Its per-branch
diff-check, add and commit logs are retained beside those receipts. All whitespace
checks passed, all source pins remained unchanged after committing, and all
postflight residual paths matched the explicit exclusions. No worker was active
in these lanes; current chat inventory showed only this campaign active and C2
idle, with the R09 checkout excluded from this sweep.

Six untracked receipt images in the R15 checkout were explicitly excluded from
Git because their provenance/content had not been assessed. They remain at their
original paths, untouched. They are not automatically classified as synthetic
test artifacts or safe to publish. No ignored directories or unrelated primary/
detached review checkout were staged.

| Branch | Files | Preservation commit |
|---|---:|---|
| codex/capital-r20-installed-loading | 10 | 0e7d5b790c51e506182967604dcd80bd78c7e8ff |
| codex/r05-personal-port | 39 | f4d672ab2073d7b2667ab27a15938773eb7a13e6 |
| codex/r05-personal-preferences | 95 | e8837dc5ad8f71b40947215bf7a82dce06139058 |
| codex/r05-receipt-review | 124 | a7619f32d7217b28c3cc4b647f85525ca00e2117 |
| codex/r05-report-settings | 46 | d715fcc012259539a9bab642b256e84645ce6513 |
| codex/r05-setting-writers | 58 | 4bc66688820c301596e247330e07c9b9e8032e4a |
| codex/r05-widget-persistence | 30 | 68976cf48fbc9eea5d9f90268203ffef7930f7f5 |
| codex/r15-local-ocr | 138 | 7fd83b40833cab13a9e1485db666887b0b24403e |
| codex/r18-app-navigation | 153 | 884ced3677319e1521a79e1fd7520444ec9ac3c3 |
| codex/r18-balance-copy | 173 | b2e4e5ec608534a5fc37c9f48057c1ac8a6f2e3a |
| codex/r18-command-accessibility | 166 | ee92f431c91a0ce036529dd2ef00dcdfb429844e |
| codex/r18-command-shortcuts | 155 | 76a32e30b914bac5dabfc2309dadb62e52d0dec5 |
| codex/r18-dashboard-greeting | 174 | 6fd3ff3b1890d5b0838d2271486e05e4bbff3506 |
| codex/r18-goal-validation | 182 | b4b5c6540e89b9b51bce9f4b3ed2fb7777f3f1be |
| codex/capital-r18-settings | 20 | 439b0d471277b1f3857e6240571879d6afa5f65c |
| codex/r20-lookup-footprint | 7 | a483d1d9fcd0f05b43687cabeccdb83cd7fac7bf |
| codex/r20-observer-v2 | 9 | a1fef4831b952a7ea43a2e25bc16d89e66a5f73f |

Combined receipt totals in this document:1920 preserved file versions across26
existing local branches. This includes duplicates and inherited changes, and
must not be described as1920 unique implementations or newly accepted changes.
These preservation branches are not26 newly authorized implementation lanes.
Canonical integration must compare current source and avoid restoring superseded
versions. Review, source equivalence, raw-evidence preservation and remote backup
remain distinct tasks; no remote backup or history-wide secret scan is claimed.

## Current-canonical comparison for integration preparation

A read-only comparison pins canonical9dd73df2d3c4548341f92724ab198ceffa4cbe9b and
each preservation commit. Canonical application source was unchanged by the
documentation updates pending alongside this comparison. Receipt:
`.local/backlog-canonical-comparison-oct31a/` contains comparison.json,
summary.json, ancestry.json and ancestry-summary.json.

- The1920 occurrences contain270 unique path/blob versions; repeated copied
  versions are not separate implementation candidates.
- 626 occurrences match current canonical Git content. They represent102 unique
  path/blob versions.
- 1294 occurrences differ, representing168 unique path/blob versions. Of these,
  seven blobs are reachable in canonical ancestry;161 are not. Blob reachability
  alone is not path-specific lineage or semantic acceptance.
- Six preservation snapshots match canonical on every preserved path: the R02
  session contract, R18 greeting port, R20 application inventory, R20 native
  probe, R05 personal port and R20 observer-v2 snapshots. This compares the
  enumerated preserved paths, not their entire historical branches.

Do not blindly merge the remaining snapshots oldest-first: their differences
require source/requirement adjudication and may include intermediate or superseded
versions. The comparison is preparation for that review, not a claim that161
changes are required or270 changes have been accepted. No source was cherry-picked.

Fresh worktree status after the sweep found no remaining tracked/untracked source
changes in the capital-r* checkouts; only the six deliberately excluded R15
receipt images remain untracked. This does not cover ignored evidence or unrelated
primary/detached checkouts.

## Six oldest small snapshots after R20 integration

Independent read-only path-lineage review at canonical `72e5b6ce` revisited the
14 exact paths in the first six preservation rows. Seven are byte-identical to
canonical: R02 session (1), R18 greeting (3) and R20 graph/JSON (3). Seven are
superseded: file window (2), inventory envelope (2), native resolution (3).
Each superseded version exists at that exact path in canonical ancestry:
file window at `8d92ac97`, inventory at `ef99071b`, native resolution at `8467ec4a`.
Later scoped-directory/window changes and the new positive-only format proof
explain the differences. Restoring those old bytes would remove newer behavior.

None of these 14 preserved versions needs source integration. The six preservation
commits themselves are not canonical ancestors; merging their historical branches
would add unnecessary inherited scope. The earlier `9dd73df2` comparison remains
historical, especially its then-true native-probe equality. This is source lineage
triage, not functional acceptance, branch deletion or requirement closure.

## R09 residual test preservation

After live confirmation that the separately owned R09 chat was terminal/idle,
parent preserved its sole remaining untracked source, the 206-line
`server/routes/__tests__/completion-r09.csv-dates.realdb.integration.test.ts`,
without edits at `fa07e8477773d991372679641c5d4a88b448cfdc` in the existing
`codex/r09-csv-date-format` checkout. No other path was staged; it is now clean.
Receipts are `.local/backlog-preservation-oct31d/r09-test-oct31a/`.

This is one additional preserved version outside the historical 26-branch/1920
totals above. The final typed bytes have historical static-check evidence; prior
versions have mixed database results, including eleven still-open account-import
failures. R09/CSV-DATE-HANDOFF.md retains exact attribution. No runtime rerun,
source acceptance, canonical integration, branch deletion or remote copy follows.
