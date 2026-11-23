# Verified local source recovery archive

31 October 2026, completed13:15:36 UTC (15:15:36 Africa/Lusaka).
This is a local recovery copy of committed campaign history, not off-device
backup, release acceptance or permission to publish.

Source canonical head at capture: `aa8fb6271904059d0393e3d31a6c60759757e36d`.
The manifest pins34 branch refs: all26 preservation branches enumerated in
BACKLOG-PRESERVATION-2026-10-31.md, plus canonical, C2 remediation, R14 foundation,
R20 format proof, R05 notification patches, R05 recap widgets, the bounded R04
Shared-owner port and R09 CSV dates. Every ref was rechecked immediately before
archive creation. Later documentation commits are outside this frozen snapshot.

## Artifact and restore proof

Packet directory:
`C:\Users\USER\.codex\worktrees\capital-completion-v2\personal-finance-app\.local\source-preservation-bundle-oct31a`

- `campaign-source.bundle`: Git bundle v3,53,174,025 bytes.
- `manifest.json`: exact34 ref names and commit IDs.
- `restore.git`: separate bare repository cloned from the bundle; its HEAD is
  codex/capital-completion-v2. It has no object-alternates dependency.
- `bundle-create.log`, `bundle-verify.log`, `restore.log`, `restore-fsck.log`
  and `verification.json`: retained execution evidence.

| Artifact | SHA-256 |
| --- | --- |
| campaign-source.bundle | 6596b2704eb06e7b228a324bbc4cf5b2459088115c71178dfd04ff051f1a5c56 |
| manifest.json | 21d1eaf46fa9a12d04fa63e3fe794c5e0e7c96c8baf8c5d94cbffc04cbcdeded |
| restore-fsck.log (empty) | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |

Creation used `git -c pack.threads=1 bundle create --version=3` with the explicit
manifest refs. `git bundle verify` passed. A fresh `git clone --bare --branch
codex/capital-completion-v2` from the local bundle passed. All34 restored branch
names and commit hashes match the manifest exactly. `git fsck --full --strict
--no-reflogs` on the restored repository exited0 with no diagnostics. The restore
did not check out files, run application code, or contact a remote service.

## Limits and recovery use

Both archive and restored repository remain on this laptop. Device loss still
requires an authorized off-device copy. No push, PR, remote CI, upload, main merge
or deployment occurred. No encryption or history-wide secret scan is claimed;
the existing publication gates remain in force.

The bundle includes committed source/history only. It does not preserve ignored
raw evidence, local databases, uncommitted primary-checkout work, the six excluded
R15 receipt images, runtime dependencies or environment files outside Git. No
untracked/private files were swept into the archive. Their preservation status
must be handled separately rather than inferred from this successful restore.

For recovery, first verify the bundle hash and manifest, then clone into a fresh
empty destination and compare all manifest refs. Existing source/author worktrees
must not be reset or overwritten. Retain the frozen archive even after new work
is committed; create a new versioned archive for a later checkpoint.

## Corrective-source refresh, 31 October 2026, 14:05 UTC

A second frozen archive in `.local/source-preservation-bundle-oct31b/` captures
the same 34 named branch refs at their then-current commits, including corrected
C2 `d6ee653a`, R20 `31220acd` and canonical `bd8257e6`. The original archive was
not changed. The new bundle is 53,206,379 bytes, SHA256
`3644606b63eaff1fecbffd8d7193e831507ad21b4c20db2009a1d4d84c0228d7`.
Its manifest SHA256 is
`9bd9d49e51dca1193b6aab059a04973e4ba4b96663c15577dba6616b83e46a84`.

Bundle verification and a fresh bare clone succeeded. All 34 restored branch
refs exactly match the manifest, no object-alternates dependency exists, and
`git fsck --full --strict --no-reflogs` exited zero. Receipts and logs are retained
in the new packet. No checkout, application execution or remote contact occurred.
The same-laptop, committed-source-only limits above still apply. This refresh
preserves the new corrective commits; it is neither acceptance nor off-device
backup. Documentation committed after capture is outside this frozen snapshot.

## Final source and policy refresh, 31 October 2026, 15:19 UTC

The third frozen archive, `.local/source-preservation-bundle-oct31c/`, captures
the same 34 named refs, including canonical `2db89e7a`, final R20 author
`181a84f8`, preserved R09 test `fa07e847` and unchanged C2 `d6ee653a`.
This adds the final R20 control changes, R09 preservation and owner-approved
neutral-import lifecycle records missing from the preceding archive.

- Bundle: 53,239,272 bytes; SHA256
  `8473e2eb6116783df61c21ba980014281b595362a4c38cdb596ad520129fc4c2`.
- Manifest SHA256:
  `1742dfc0aa5d136457b062eeaf20948f3bfc2c4715d6d563419f1b7ff15f174d`.
- Bundle verification passed; a fresh bare clone restored all 34 exact refs.
- No object-alternates dependency; full strict fsck exited zero.

The manifest, execution logs and verification receipt are retained in that
packet. Older archives remain untouched. This is same-laptop committed-history
recovery only, with all exclusions and publication gates above unchanged.
The documentation recording this result is necessarily later than capture;
do not create another archive merely to include this receipt documentation.
