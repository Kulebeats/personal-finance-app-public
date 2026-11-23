#!/usr/bin/env node
/**
 * NEW-39 preflight: which tags would break the scoped uniqueness index
 * UNIQUE (household_id, lower(name))? Read-only; it never changes a row.
 *
 *   node scripts/report-tag-duplicates.mjs            uses DATABASE_URL from .env
 *
 * Prints one JSON object: the number of tags, the duplicate groups (household
 * id prefix, the lower-cased name, how many tags share it, their ids, archive
 * state and usage counts) and `indexWouldFail`. Tag names are user data, so
 * pipe the output to a private file rather than a shared channel.
 * Exit code 2 when duplicates exist, so a deploy step can stop on it.
 */
import "dotenv/config";
import pg from "pg";
import { resolveDatabaseConnection } from "../server/dbSsl.ts";

const connection = resolveDatabaseConnection();
const client = new pg.Client({ ...connection });
await client.connect();
try {
  await client.query("BEGIN READ ONLY");
  const { rows: [{ total }] } = await client.query("SELECT count(*)::int AS total FROM tags");
  const { rows } = await client.query(`
    SELECT left(household_id::text, 8) AS household, lower(name) AS name, count(*)::int AS tags,
           json_agg(json_build_object('id', id, 'name', name, 'archived', is_archived, 'usage', usage_count) ORDER BY created_at) AS members
      FROM tags
     GROUP BY household_id, lower(name)
    HAVING count(*) > 1
     ORDER BY household, name`);
  await client.query("ROLLBACK");
  console.log(JSON.stringify({ database: connection.database, tags: total, duplicateGroups: rows.length, indexWouldFail: rows.length > 0, groups: rows }, null, 2));
  if (rows.length > 0) process.exitCode = 2;
} finally {
  await client.end();
}
