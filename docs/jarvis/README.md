# Jarvis: the lane board, goal intake, owner inbox and tick

Jarvis is a small set of Node scripts that help one coordinator session run several helper
sessions ("lanes") on this repository without losing track of them. It is tooling only. Nothing in
`scripts/jarvis/` is imported by the application, and nothing here changes how the app builds,
tests or deploys.

The flow is:

1. The owner states a goal. The coordinator drafts a goal plan: a JSON file that splits the goal
   into lanes, grouped into waves.
2. `goal-intake check` validates the plan. The coordinator shows the result to the owner.
3. When the owner approves, `goal-intake apply --approved "<owner's words>"` puts every lane on the
   lane board as one row and writes one "done means" file per lane.
4. The coordinator starts lanes in waves, each in its own worktree, with a brief made from
   `lane-brief-template.md`. Each lane updates its own board row as it works.
5. A lane that needs the owner files a question in the owner's inbox and keeps working on whatever
   the question does not block. The coordinator puts the open questions to the owner in batches.
6. The coordinator runs the tick regularly. It prints the board digest and flags lanes that have
   gone quiet, stale locks, old questions, lanes that are ready to start, and the capacity limit.

## Commands

Run every command from a checkout of this repository.

### Lane board

```
node scripts/jarvis/lane-board.mjs list
node scripts/jarvis/lane-board.mjs show <lane id>
node scripts/jarvis/lane-board.mjs set <lane id> key=value ... --by "<lane or session>"
node scripts/jarvis/lane-board.mjs claim <lane id> --by "<coordinator>"
node scripts/jarvis/lane-board.mjs digest
```

- `list` prints one line per lane.
- `show` prints one lane's row as JSON.
- `set` adds a lane or changes its fields. The fields are `title`, `branch`, `worktree`, `session`,
  `waitingOn`, `doneMeans`, `goal`, `wave`, `model`, `status`, `reviewRound`, `head`, `runsAfter`
  and `signOffIds`. A list field takes comma-separated values, and an empty value clears a field.
  Every row is validated before it is written; a refused change writes nothing and exits 1.
- `claim` moves a `planned` lane to `starting`. It succeeds once, so two coordinators cannot both
  start the same lane. Claim a lane before starting its session.
- `digest` prints the lanes grouped by goal and wave, with a count line per goal, followed by the
  questions waiting on the owner.

### Goal intake

```
node scripts/jarvis/goal-intake.mjs check <plan.json>
node scripts/jarvis/goal-intake.mjs apply <plan.json> --by "<coordinator>" --approved "<the owner's words>" [--out <folder>]
```

- `check` reads only. It prints the lanes by wave, or every reason the plan is refused.
- `apply` writes the board rows and the done-means files in one locked step: either every new lane
  goes on the board or none does. It refuses to run without `--approved`. A lane already on the
  board is left as it is, so running `apply` twice is harmless. It prints each lane's goal line for
  its brief.
- The plan is refused when: the goal id is not lower-case letters, digits and dashes; a lane has no
  `do` item, no check, or a check without its expected summary line; a lane has no branch or wave;
  the model is not `opus`, `sonnet` or `haiku`; two lanes share an id; a `runsAfter` names a lane
  that does not exist or makes a loop; a lane id already belongs to another goal on the board; two
  open lanes have worktree names one could confuse with the other; or a wave holds more than 5
  lanes.
- A lane with `rulingOwed` goes on the board `held`, so the tick never calls it ready. When the
  owner has ruled, set it back with
  `node scripts/jarvis/lane-board.mjs set <id> status=planned waitingOn= --by coordinator`.
- See `goal-plan.example.json` for a complete plan.

### Owner inbox

```
node scripts/jarvis/owner-inbox.mjs list
node scripts/jarvis/owner-inbox.mjs add --id Q-<goal>-<lane>-<n> --lane <lane id> --ask "<one line>" [--line "<draft answer>"] [--session <id>]
node scripts/jarvis/owner-inbox.mjs batch
node scripts/jarvis/owner-inbox.mjs done <id>
```

- `list` prints the open questions, oldest first.
- `add` files a question. Filing the same question twice keeps one copy. An id that is already
  open for a different question, or was already answered, is refused.
- `batch` prints the open questions as JSON, four to a group: one group is one question form for
  the owner.
- `done` marks a question answered. It records no answer: the answer goes to the lane that asked.

### Tick

```
node scripts/jarvis/jarvis-tick.mjs [--no-stamp]
```

The tick prints the digest, the heavy-run lock line and a list of flags. It changes nothing except
its own stamp file, which lets the next tick notice a long gap (the machine slept or the app was
closed). `--no-stamp` skips that write. The flags are:

| Flag | Meaning |
|---|---|
| `gap` | No tick for over 90 minutes. Re-check every running lane before re-tasking any of them. |
| `quiet` | A `starting`, `building` or `in-review` lane has not written its row or its transcript for 30 minutes. |
| `lock` | The heavy-run lock has been held for 45 minutes or more. |
| `statelock` | A board or inbox write lock is older than 30 seconds, so the process that took it stopped. Check that no writer is running, then remove the `.lock` folder by hand. |
| `inbox` | The inbox file is not valid JSON. Tell the owner; do not overwrite it. |
| `waiting` | A question has waited more than 12 hours. |
| `ready` | A `planned` lane whose `runsAfter` lanes have all landed, and a running place is free. Claim it, then start it. |
| `capacity` | Lanes are ready, but the running limit is reached. Start nothing. |

## Lane statuses

| Status | Meaning |
|---|---|
| `planned` | On the board, not started. |
| `starting` | Claimed by the coordinator; its session is being started. |
| `building` | The lane is working. |
| `built` | The lane's checks pass and its results file is written. |
| `in-review` | The lane's pull request is under review. |
| `blocked` | A deliberate block (a hook, a refusal, a denied permission) stopped it; `waitingOn` says why. |
| `waiting-owner` | It waits on an owner question; `waitingOn` names the inbox item. |
| `ready-to-land` | Review is done and CI is green; it waits for the owner to merge. |
| `landed` | Merged; `head` records the commit that landed. |
| `held` | Not to be started, for example until an owner ruling exists. |

A lane may go through at most 2 review rounds (`reviewRound` 0 to 2).

## Limits

- **At most 3 lanes run at once.** A lane holds a running place while it is `starting`,
  `building`, `built`, `in-review` or `waiting-owner`. The board refuses a change that would give a
  fourth lane a place, and the tick names no more ready lanes than there are free places. The cap is
  the one constant `MAX_RUNNING` in `scripts/jarvis/lane-board-core.mjs`.
- **At most 5 lanes per wave.** Goal intake refuses a plan with a larger wave
  (`MAX_LANES_PER_WAVE` in `scripts/jarvis/goal-intake-core.mjs`).
- **Lane models** are exactly `opus`, `sonnet` and `haiku`. A lane's goal line caps it at 60 turns
  on Opus and 40 on Sonnet or Haiku, unless the plan gives the lane its own `turnCap`.

## Where state lives

| File | Default location | Override |
|---|---|---|
| Lane board | `.local/jarvis/lane-board.json` in the main checkout | `CAPITAL_LANE_BOARD` |
| Board write lock | `.local/jarvis/lane-board.json.lock` (a folder, held for milliseconds) | follows the board |
| Tick stamp | `.local/jarvis/jarvis-tick.json` in the main checkout | `CAPITAL_TICK_STAMP` |
| Heavy-run lock | `.local/jarvis/heavy-run.lock` in the main checkout | `CAPITAL_HEAVY_LOCK` |
| Done-means files | `docs/jarvis/done-means/` of the checkout that runs `apply` (tracked) | `apply --out <folder>` |
| Owner inbox | `Documents/smartcare-handoffs/waiting-on-owner.json` in the home directory | `CAPITAL_OWNER_INBOX` |

- `CAPITAL_JARVIS_DIR` moves the whole `.local/jarvis/` folder.
- "The main checkout" is the folder that holds the repository's shared `.git` directory. The scripts
  find it with `git rev-parse --git-common-dir`, so a lane in any worktree reads and writes the same
  board. `.local/` is ignored by `.gitignore`.
- The owner inbox is deliberately the same file the owner's control room already shows, in the same
  shape, so this project's questions appear in the owner's existing inbox.
- Session transcripts, used to tell whether a lane is quiet, are read from `~/.claude/projects`
  (`CAPITAL_CLAUDE_PROJECTS` overrides it).

## Tests

```
npm run test:jarvis
```

This runs only `scripts/jarvis/**/*.test.mjs` with `scripts/jarvis/vitest.config.mjs`, in a node
environment. The config points every state file, including the owner inbox, at a temporary folder,
so the tests never touch the real inbox or the main checkout's board.
