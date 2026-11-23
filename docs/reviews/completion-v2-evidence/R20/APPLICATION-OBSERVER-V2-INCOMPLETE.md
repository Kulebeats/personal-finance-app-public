# Incomplete v2 candidates: schema clarification

30 October 2026. Read-only architecture adjudication for the accepted observer
proposal `e1675068d85d63dfeb00f1665110657cb77b1e035fc61c79709f5adc319ffa02`.
This clarifies its collection return surface; it adds no execution authority.

**Decision: permit a serialized incomplete candidate inside the blocked collection
report.** It is useful independently pinned evidence of the entire declared census,
not a route around complete preflight. Do not create a second partial-candidate
format or discard graph rows.

## One collection return surface

Use one closed unbranded collection report envelope for both outcomes:

```text
{
  kind: 'pfa-application-root-collection-report',
  version: 1,
  status: 'collected' | 'blocked',
  candidateText: string | null,
  census: <the existing closed whole-graph census/count summary>,
  blockers: <bounded closed diagnostic rows>
}
```

`candidateText` is the sole serialized inventory, never accompanied by a competing
mutable candidate object. Its inner v2 size bound still applies. Any hash displayed
by the command is informational and must not become an input approval pin.

- `collected`: a valid candidate is present and every eligible package footprint
  is complete. This describes collection completeness only. Known typeless,
  unsupported-format, require or other graph blockers can still be present; this
  status does not mean the application is usable or observed.
- `blocked` with candidateText: valid bounded measurement of the collected evidence
  succeeded, but at least one eligible package footprint is explicitly incomplete.
  A closed diagnostic identifies each incomplete tuple and why enumeration stopped.
- `blocked` with null candidateText: no valid candidate can be serialized, such as
  aggregate-limit exhaustion. Preserve the whole census when the graph itself was
  successfully validated. Never truncate a candidate to force it under a bound.

Malformed graph/input, inconsistent positive/absent evidence, identity/byte drift,
invalid physical path or failed required measurement remain refusals under the
existing error contract. They must not become ordinary incomplete-topology rows.
A well-formed path whose search reaches a declared policy boundary can instead be
an explicit incomplete-topology outcome; do not confuse that with a malformed or
aliased path. All statuses retain false authority/certification flags wherever
those flags are represented by the existing payload contracts.

## Inventory and reader invariants

Each footprint is a closed discriminated row with status `complete` or `incomplete`.
Complete rows satisfy every accepted trace/leaf/reference rule. Incomplete rows
carry their exact graph tuple/count, bounded known trace/pin references, explicit
stopping point and closed reason. Unvisited or unknown values are explicit through
the incomplete variant, never invented as successful null scopes or absences.
The reader cannot establish that a stopping point is physically truthful; the
observer's independent reconstruction must establish agreement before admission.

Keep the entire graph/member/import census and exactly one footprint per eligible
package tuple in both variants. Incomplete rows do not excuse missing occurrences,
unused files, conflicting references, invalid identities, unjustified manifests,
unknown diagnostic fields or exceeded bounds. Known evidence must pass the same
structural checks as in a complete row. No claimed complete trace may be shortened
because some other part of the footprint is incomplete.

Independent pins bind the exact candidate text and all previously agreed identity,
runtime, graph, policy, root and metadata-tool groups. The v2 reader may return its
private **structural declaration** record for a valid incomplete candidate. Derive
its aggregate footprint status and incomplete tuple list from the rows; never trust
a caller-supplied aggregate completeness flag. Existing declaration lineage is not
native-admission or observation lineage.

## Observer invariants

For a genuine independently pinned declaration, reconstruct the whole eligible
package census under the single aggregate budget and compare it with the candidate.
If reconstruction differs, refuse that candidate: an old incomplete declaration
does not silently become a complete one when files or supported topology change.
Collect and independently pin a new candidate for that change.

After matching reconstruction, any incomplete eligible footprint returns an
unbranded whole-census blocked report with **zero native calls and no private
observation record**. Do not execute native probes for the complete subset. No
outer native observation window or two-child run is needed on this blocked branch;
collection/reconstruction measurement handles must still be fully cleaned up.

Only an entirely complete eligible footprint set enters the accepted retained
window -> native -> intermediate check -> fresh native -> final check sequence.
Known stable negative outcomes may then become observed-with-blockers under the
accepted rules. Zero eligible package tuples follow the already specified zero-
native special case and must not be confused with omitted or incomplete tuples.

## Required focused controls

1. Incomplete collection preserves the full census, serializes one candidate and
   remains unbranded. External matching pins let the reader create only declaration
   lineage; cloned records and stale pins still refuse.
2. A mixed complete/incomplete census reconstructs and blocks with zero native
   launches and no observation brand. No package row or occurrence disappears.
3. Alter the incomplete reason/stopping point, omit a known nearer probe, forge a
   complete status or change measured bytes/identity: structural refusal or exact
   reconstruction mismatch, never native admission.
4. Make a formerly incomplete fixture complete: the old frozen candidate refuses;
   a newly collected and independently pinned candidate can enter the real joined
   observer journey. Limits and measurement failures cannot manufacture a candidate.

No tests, native processes, application, database or provider work was performed
for this clarification. Parent owns recording this clarification in the accepted
decision and scheduling implementation verification.
