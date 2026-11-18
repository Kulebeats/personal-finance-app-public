# Done means: <lane title>

> One file per lane, written before the lane starts and handed to it with its brief. Goal intake
> writes these files for you into `docs/jarvis/done-means/`, named `DD-MM-YYYY_<lane-id>-done-means.md`,
> and puts the path in the board row (`doneMeans=<path>`). Use this template only for a lane added by
> hand. Replace every `<...>`, and delete a line that does not apply rather than leaving a placeholder.
> The lane brief (`docs/jarvis/lane-brief-template.md`) applies in full; this file says only what THIS
> lane owes.

- **Lane id:** `<id on the board>`
- **Branch / worktree:** `<branch>` in `<worktree path>`, cut from `origin/main`
- **Audit ID:** `<review id, or "none yet">` (one per branch)
- **Runs after:** `<lane ids, or "nothing">`
- **Model:** `<opus | sonnet | haiku>`

## 1. Do

<What the lane must change, as checkable items. Name the files, rules, routes or findings.>

- [ ] <item>

## 2. Do not touch

<Paths, modules and decisions that are out of scope. Name the other lanes whose files are nearby.>

- <path or area> - <why: another lane owns it, or it is out of scope>

## 3. Checks that prove it

<Each command, run from the lane's worktree, with the summary line it must print. "Green" means the
quoted line. Use scoped commands only; full suites and builds run in GitHub CI on the pull request.>

| Command | Expected summary line |
|---|---|
| `<scoped test command> <path or pattern>` | `Test Files <n> passed` |
| `node scripts/check-loc-limits.mjs` | no new file over its limit |

## 4. Owner rulings and sign-offs needed, by ID

<Each owner ruling or sign-off this lane depends on, by ID. Write "none" when there is none.>

- `<id>` - covers <what>

## 5. What "landed" requires

- A pull request against `main` from the lane's branch, with GitHub CI green at the final head.
- At most 2 review rounds; every finding fixed in its own commit or set out for the owner to decide.
- The owner merges the pull request. A lane never merges, and never pushes to `main`.
- <anything lane-specific, for example a live check in the dev app>
