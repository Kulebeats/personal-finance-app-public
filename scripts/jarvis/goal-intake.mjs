#!/usr/bin/env node
// The goal intake CLI. See docs/jarvis/README.md.
//
//   node scripts/jarvis/goal-intake.mjs check <plan.json>
//   node scripts/jarvis/goal-intake.mjs apply <plan.json> --by "<coordinator>" --approved "<the owner's words>" [--out <folder for the done-means files>]
//
// `check` reads only. `apply` puts a plan's lanes on the board, each with a done-means file. The
// done-means files go to `docs/jarvis/done-means/` of this checkout unless `--out` names a folder.
//
// - The owner approves a goal's plan before it goes on the board: show them `check`'s
//   output, then pass their words to `apply`, which quotes them in each done-means file.
//   `--approved` is a record the caller supplies. Nothing here can check that the owner said it, and
//   no other tool may read it as proof of approval.
// - The whole apply is one locked read-change-write of the board: the plan is validated against
//   the board as it is then, the files are written, and every row is written once. If anything
//   fails, no row is written and the files this call created are removed. A done-means file that
//   is already there is never overwritten.
// - A lane already on the board is left exactly as it is, so applying a plan again cannot move a
//   started or landed lane back to `planned`.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { goalLine, planToRows, renderDoneMeans, validatePlan } from './goal-intake-core.mjs';
import { defaultDoneMeansDir } from './jarvis-paths.mjs';
import { applySet } from './lane-board-core.mjs';
import { changeBoard, loadBoard } from './lane-board.mjs';

function option(args, name) {
  const at = args.indexOf(name);
  return at === -1 ? '' : (args[at + 1] ?? '');
}

function readPlan(file) {
  if (!file) throw new Error('goal intake: name the plan file');
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`goal intake: ${file} is not readable JSON (${err.message})`);
  }
}

function refuseInvalid(plan, board, where = {}) {
  const errors = validatePlan(plan, board, where);
  if (errors.length) throw new Error(`goal intake: the plan is refused:\n  - ${errors.join('\n  - ')}`);
}

function summary(plan, rows) {
  const waves = [...new Set(rows.map((row) => row.changes.wave))];
  const lines = [`Goal ${plan.goal}: ${rows.length} lanes in ${waves.length} waves`];
  for (const row of rows) {
    const after = row.changes.runsAfter.length ? `, after ${row.changes.runsAfter.join(', ')}` : '';
    const held = row.changes.status === 'held' ? `  [held: ${row.changes.waitingOn}]` : '';
    lines.push(`  wave ${row.changes.wave}  ${row.id}  (${row.changes.model}${after})  ${row.changes.title}${held}`);
  }
  return lines.join('\n');
}

/**
 * Create each new lane's done-means file and prove it reads back. A file that is already there is
 * never overwritten: it may be another apply's, or a lane's edited copy. `created` is told of each
 * file as it is made, so the caller can remove exactly those if a later step fails.
 */
function writeDoneMeans(plan, rows, approval, created) {
  for (const row of rows) {
    const path = row.changes.doneMeans;
    const lane = plan.lanes.find((entry) => entry.id === row.id);
    mkdirSync(dirname(path), { recursive: true });
    try {
      writeFileSync(path, renderDoneMeans(plan, lane) + approval, { flag: 'wx' });
    } catch (err) {
      if (err.code !== 'EEXIST') {
        rmSync(path, { force: true }); // created by this call, perhaps half written
        throw err;
      }
      throw new Error(`goal intake: ${path} already exists and is left as it is; move it away, or name another --out folder`);
    }
    created(path);
    readFileSync(path, 'utf8');
  }
}

/**
 * Put the plan's new lanes on the board. `publish` is the board's locked read-change-write
 * (a test seam). Nothing is left behind on failure: the board is written last and whole, and the
 * files this call created are removed if anything after them fails. `publish` throws only
 * when the board was NOT written: a lock that cannot be released afterwards is not an error
 * (file-lock.mjs), so a published board never loses the files its rows point at.
 */
export function applyPlan(plan, { dir, by, approval, now }, { publish = changeBoard } = {}) {
  let made = [];
  try {
    return publish((board) => {
      refuseInvalid(plan, board, { dir, now });
      const rows = planToRows(plan, { dir, now });
      const kept = rows.filter((row) => board.lanes.some((lane) => lane.id === row.id));
      const fresh = rows.filter((row) => !kept.includes(row));
      // Every new row is checked in memory before any file exists.
      const next = fresh.reduce((current, row) => applySet(current, row.id, row.changes, { by, now }).board, board);
      writeDoneMeans(plan, fresh, approval, (path) => {
        made = [...made, path];
      });
      return { board: next, result: { rows, fresh, kept: kept.map((row) => `${row.id} (${board.lanes.find((lane) => lane.id === row.id).status})`) } };
    });
  } catch (err) {
    made.forEach((path) => rmSync(path, { force: true }));
    throw err;
  }
}

export function run(argv, { now = Date.now(), out = console.log } = {}) {
  const [command, file, ...args] = argv;
  if (command !== 'check' && command !== 'apply') throw new Error('goal intake: unknown command (check, apply)');
  const plan = readPlan(file);
  // An absolute folder, so a lane in any worktree can read its done-means file.
  const dir = resolve(option(args, '--out') || defaultDoneMeansDir());
  if (command === 'check') {
    refuseInvalid(plan, loadBoard(), { dir, now });
    out(summary(plan, planToRows(plan, { dir, now })));
    return 0;
  }
  const by = option(args, '--by').trim();
  if (!by) throw new Error('goal intake: say who is writing (--by "<coordinator>")');
  const approved = option(args, '--approved').replace(/\s+/g, ' ').trim();
  if (!approved) throw new Error('goal intake: a plan goes on the board once the owner has approved it; show them `check`, then pass --approved "<their words>"');
  const approval = `\n> The owner approved this goal's plan: "${approved}" (recorded by ${by}, ${new Date(now).toISOString()}; a record supplied by the caller). It approves the plan only: no sign-off, no merge.\n`;
  const { rows, fresh, kept } = applyPlan(plan, { dir, by, approval, now });
  const held = fresh.filter((row) => row.changes.status === 'held').length;
  out(summary(plan, rows));
  out(`${fresh.length} lanes planned${held ? `, ${held} of them held until a ruling exists` : ''}.`);
  if (kept.length) out(`kept, already on the board: ${kept.join(', ')}`);
  if (fresh.length) out('Goal lines for the briefs:');
  for (const row of fresh) out(`  ${row.id}: ${goalLine(plan.lanes.find((entry) => entry.id === row.id), row.changes.doneMeans)}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
