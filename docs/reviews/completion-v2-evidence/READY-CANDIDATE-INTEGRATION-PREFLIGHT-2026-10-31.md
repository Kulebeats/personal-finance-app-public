# Ready candidate integration preflight, 31 October 2026

Coordinator preparation against canonical
`28055576f66078045850c7b128c0a5dc00af4d80`. This is a Git/text and migration-metadata
comparison, not independent approval, runtime verification or integration.
No index, working-tree source, branch reference or database was changed by the
preflight. `git merge-tree --write-tree --name-only` wrote preview Git objects
only; conflict-containing preview trees must never be treated as accepted source.

| Candidate | Pinned head | Preview against canonical | Remaining acceptance |
| --- | --- | --- | --- |
| C2 remediation | 454699120a0daf6b31cd49de39ae7980d7e4e440 | Clean textual merge | Independent review; new credential/browser journeys unrun; unresolved C2 findings remain separately open |
| R04 Shared owner | 777cf5b7392f7609623e050a25ae52eac52c4569 | Clean textual merge | Independent review; fresh protected HTTP/SQL and browser proof on the port |
| R14 durable foundation | d938529c79d8fa2a46c72d25acb0debd9571ee91 | Journal conflict | Generated-DDL review; protected migration, constraint, corruption, race and plan controls |
| R20 format proof | b2ec05f8c20b87a6b2deb6982df969abcc520b3d | Clean textual merge | Independent review; unresolved coverage/reliability limits and fresh installed-profile evidence |

The historical merge-base delta for R14 has 16 paths, including the two inherited
0014 files that are already identical on canonical. Do not count those files as
new migrations or reapply 0014. The canonical-to-candidate shared/schema.ts delta
is only the export of durableJobItems and durableJobAttempts.

## R14 journal resolution for review

The conflict is concurrent insertion after 0013 in Git history, not a conflicting
0014 identity. The current candidate journal is the canonical journal's exact
15-entry JSON prefix plus exactly this entry:

```json
{
  "idx": 15,
  "version": "7",
  "when": 1793434886584,
  "tag": "0015_r14_durable_jobs",
  "breakpoints": true
}
```

All 28 canonical migration files other than the journal have identical Git blobs
on the candidate, including 0014 SQL and snapshot. The 0015 snapshot's prevId
matches canonical 0014's id. Its table comparison adds only
public.durable_job_attempts and public.durable_job_items, with zero changed
existing table definitions. This is snapshot metadata evidence; it does not
prove that the SQL runs, implements the snapshot, or preserves real data.

After independent DDL clearance, the proposed resolution is to retain the
canonical journal entries verbatim and append the already generated 0015 entry.
The existing candidate journal supplies that exact JSON content (its only other
textual difference from canonical is the missing final newline). Do not renumber,
regenerate older migrations, change their timestamps or resolve by dropping 0014.
Recheck these assertions against the then-current canonical head before applying.

## C2 / R04 browser-registration resolution for review

The candidate path intersection contains only playwright.completion.config.ts.
A pairwise merge-tree preview confirms a conflict on its one-line testMatch list.
Preserve all current registrations and retain both new entries exactly once:

- completion-c2-credentials.spec.ts
- completion-r04-shared-owner.spec.ts

Preserve workers=1, retries=0, the disposable-target validation, owned browser
server, timeouts and existing browser project. A resolution must not add the
older R05 tests inherited by the original Shared-owner author. The bounded R04
port deliberately avoids those source and registration changes.

## Integration sequence and verification boundaries

Review the C2 repair candidate first because it addresses confirmed regressions;
then the bounded R04 port. Keep R14 migration admission and R20 format-proof
acceptance separate from those application fixes. Integration remains local and
review-gated. Do not open a fifth source lane to work around the review queue.

After any accepted integration, verify the actual resolved source and affected
old/new callers. A clean merge-tree result cannot supply that evidence. Fresh
database/browser work requires the serialized, explicitly marked disposable
window and resolution of the previously recorded automatic-approval startup
rejection. No alternate startup was attempted during this preflight.

The reviewer remains quota-held at this checkpoint; the reported retry time is
15:37 Africa/Lusaka. A terminal quota error is not a live review or a verified wait.
The previous goal turn made progress by preserving the R04 port and completing
its unit/static evidence. This turn identified concrete conflicts and verified
their bounded resolution inputs; neither turn qualifies as an impasse.

Raw receipts are canonical `.local/candidate-integration-preflight-oct31a/`:

| Receipt | SHA-256 |
| --- | --- |
| preflight.json | 118a1f28de64c31099492d4c6c3694e1d4b4b3d0c93e1fd3cf963dd075fb650b |
| r14-journal-admission.json | 54f59013908142f49c362976dd4f2135e3e9687763fe2930e7b99ce96cfe308f |
| overlaps.json | ff4b5e9abb987c5c4f79d4e8996f2746cdfc5b35438a60663e65adb3f54af7f0 |

The five merge-tree outputs are retained beside the JSON receipts. Source pins,
historical failures, unresolved requirements and all remote/production gates
remain intact. The campaign goal is active and not complete.

## Refresh after corrective source review, 31 October 2026, 14:10 UTC

Fresh `merge-tree --write-tree` previews against canonical `9d52f90e` preserve the
following actual results in `.local/candidate-integration-preflight-oct31b/`:

- Corrected C2 `d6ee653a`: clean textual merge, exit zero.
- R04 `777cf5b7`: exit one solely for an add/add conflict in
  R04/SHARED-OWNER-PORT-2026-10-31.md. Canonical contains the complete author
  document plus the subsequent Sol/Astra review appendices. Preserve this
  canonical superset when integration is admitted; no application path conflicts.
- Corrected C2 / R04 pair: exit one solely in playwright.completion.config.ts;
  the existing requirement to retain both test registrations exactly once holds.

These are Git object previews, not branch/worktree merges. No application source
was integrated. Independent source reviews are now complete for C2/R04, while
fresh database/browser acceptance remains pending. Raw logs and preflight.json
pin exact operands and outcomes; prior previews remain preserved.
