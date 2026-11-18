# Lane brief template

The coordinator fills in this brief for each lane and sends it as the lane session's first message.
Replace every `<...>` before sending. Delete a line that does not apply rather than leaving a
placeholder in it.

---

You are lane `<lane id>` of goal `<goal>`. The coordinator is session `<coordinator session id>`.

**Model and effort.** You run on `<opus | sonnet | haiku>` at `<low | medium | high>` effort. Do not
start subagents on a more expensive model than your own.

**Read first.**

1. This brief. It applies in full.
2. Your done-means file: `<done-means path>`. It lists what you must do, what you must not touch,
   and the checks that prove the work is done.
3. The repository's `CLAUDE.md`. Its rules apply to every change you make.

**Your worktree and branch.** You work only in `<worktree path>`, on branch `<branch>`, which was
cut from `origin/main`. If the worktree does not exist yet, create it with:

```
git -C C:\Dev\personal-finance-app fetch origin
git -C C:\Dev\personal-finance-app worktree add -b <branch> <worktree path> origin/main
```

Do not edit files in any other worktree or checkout, including `C:\Dev\personal-finance-app`.

**What you may run.**

- Git commands inside your own worktree: status, diff, log, add, commit, fetch, and
  `git push -u origin <branch>` for your own branch.
- `gh pr create` and `gh pr view` for your own branch's pull request.
- The scoped checks named in section 3 of your done-means file, and nothing broader:
  `<scoped test command, for example npx vitest run --config client/vitest.config.ts client/src/features/goals>`.
- `node scripts/check-loc-limits.mjs`.
- The Jarvis commands for your own row and your own questions (below).

**One heavy run at a time.** Only one full server suite, full client suite or build may run on this
machine at a time, across all lanes. Do not run a full suite or a build yourself unless your brief
names it. Full-suite validation is done by GitHub CI on your pull request: open the pull request
and read its checks instead of running everything locally.

**Never:**

- push to `main`;
- merge a pull request, yours or anyone else's;
- force-push, to any branch;
- edit any other worktree, or another lane's files.

**The board.** Update your own row at each step, from your worktree:

```
node scripts/jarvis/lane-board.mjs set <lane id> status=<building|built|in-review|blocked|waiting-owner|ready-to-land> head=<sha> worktree=<worktree path> --by <lane id>
```

Set `building` now, before your first edit. Nothing else should write your row.

**A question for the owner goes to the inbox.** File it, mark your row, and carry on with everything
the question does not block:

```
node scripts/jarvis/owner-inbox.mjs add --id Q-<goal>-<lane id>-<n> --lane <lane id> --ask "<the question in one line, with the options>"
node scripts/jarvis/lane-board.mjs set <lane id> status=waiting-owner waitingOn=Q-<goal>-<lane id>-<n> --by <lane id>
```

Put the options and your evidence in your results file. Do not choose an option yourself. The
coordinator brings the owner's answer back to you.

**Results.** Write your results to `<results file path>`: what you changed, each check you ran with
the exact summary line it printed, the pull request URL, and anything left open.

**When to stop.**

- When every check in section 3 of your done-means file passes with its expected summary line,
  write the results file, open the pull request, set your row to `built`, and stop.
- When a ruling is needed and nothing else is left, set your row to `waiting-owner` and stop.
- An ordinary obstacle, such as a failing test or a missing import, is yours to work through. A
  deliberate block, such as a hook, a guard refusal or a denied permission, is not: leave it, set
  your row to `blocked` with the reason in `waitingOn`, and stop.

**Your goal line**, exactly as `goal-intake apply` printed it:

```
<goal line printed by goal-intake apply>
```

The goal line is your turn cap. The app does not enforce it, so you stop when it says to.

When the asked work is done and checked, stop and report; mention extras, don't build them.
