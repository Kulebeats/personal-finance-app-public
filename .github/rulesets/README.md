# Branch rulesets

Repository rulesets are configured in GitHub's settings, not read from this
directory — these files are the **source of truth for what was applied**, so the
policy is reviewable, diffable, and re-appliable after an accidental change.

## `main-require-uptodate-verify.json`

### Why it exists

On 2026-07-20 two PRs that were each green in CI broke `main` on contact:

- **#141** added a LOC ratchet guard forbidding growth of already-oversized files.
- **#142** added ~122 lines to `server/modules/ai/ai.service.ts` (already 891 lines).

Neither run could have caught it. #142's CI predated the guard; #141's predated
the lines. `verify` then failed on `main` — CI *detected* it post-merge, but
nothing *blocked* the merge and nobody was watching the push run.

### What closes the gap

`strict_required_status_checks_policy: true` — "require branches to be up to
date before merging". With it, #142 could not have merged without first updating
onto `main`-with-#141, which would have re-run `verify` against the combined
state and gone red **before** the merge.

That single setting is the fix. The rest is scaffolding to make it coherent.

### Policy

| Rule | Effect |
| --- | --- |
| `pull_request`, 0 approvals | Changes go through a PR so checks have something to attach to. Zero required approvals, so solo self-merge still works with no extra step. |
| `required_status_checks`: `verify`, strict | Branch must be current with `main` **and** `verify` green. |
| `deletion`, `non_fast_forward` | `main` can't be deleted or force-pushed. |
| Bypass: repository admin | You are never locked out of your own repo in an emergency. |

`e2e` is deliberately **not** required: it was flaky on `main` at the time of
writing (skipped / failure / success across three consecutive runs). Gating on a
flaky check blocks merges for reasons unrelated to the change. Add it here once
it is stable.

### Apply

```bash
gh api repos/Kulebeats/personal-finance-app/rulesets \
  -X POST --input .github/rulesets/main-require-uptodate-verify.json
```

### Inspect / undo

```bash
# list (note the id)
gh api repos/Kulebeats/personal-finance-app/rulesets --jq '.[] | "\(.id)  \(.name)  \(.enforcement)"'

# soft-disable, keeping the config
gh api repos/Kulebeats/personal-finance-app/rulesets/RULESET_ID \
  -X PUT -f enforcement=disabled

# remove entirely
gh api repos/Kulebeats/personal-finance-app/rulesets/RULESET_ID -X DELETE
```

### Re-apply after editing

Rulesets are replaced, not merged — `PUT` the whole document:

```bash
gh api repos/Kulebeats/personal-finance-app/rulesets/RULESET_ID \
  -X PUT --input .github/rulesets/main-require-uptodate-verify.json
```
