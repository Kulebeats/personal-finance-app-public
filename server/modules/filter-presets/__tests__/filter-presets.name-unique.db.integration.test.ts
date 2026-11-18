/**
 * Filter preset name uniqueness - REAL DB.
 *
 * Proves the production invariant for saved filter names: a user may have at
 * most one preset with a given name per household/context. The service's
 * read-then-insert check gives the friendly 409 on the common path; the
 * database unique index (migration 0007) is the backstop for concurrent
 * writers, and its 23505 is translated to the same ConflictError contract.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";

import { db } from "../../../db";
import { filterPresetsService } from "../filter-presets.service";
import { ConflictError } from "../../../core/errors";
import {
  filterPresets,
  householdMembers,
  households,
  users,
} from "@shared/schema";
import {
  createTestHousehold,
  createTestUser,
} from "../../../__tests__/fixtures";
import { getPostgresError } from "../../../utils/postgresError";

const NAME_INDEX_NAME = "filter_presets_name_unique_per_scope";

describe("Filter preset name uniqueness", () => {
  const createdHouseholdIds: string[] = [];
  const createdUserIds: string[] = [];
  let createdNameIndex = false;

  async function ensureNameIndex() {
    const existing = await db.execute(sql`
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ${NAME_INDEX_NAME}
    `);

    if (existing.rows.length > 0) return;

    // Mirror migration 0007: collapse duplicates (keep default, then oldest)
    // before building the index, so this works on a dirty dev database.
    await db.execute(sql`
      DELETE FROM filter_presets
      WHERE id IN (
        SELECT id
        FROM (
          SELECT
            id,
            row_number() OVER (
              PARTITION BY household_id, user_id, context, name
              ORDER BY
                CASE WHEN is_default THEN 0 ELSE 1 END,
                created_at NULLS LAST,
                id
            ) AS rn
          FROM filter_presets
        ) ranked
        WHERE ranked.rn > 1
      )
    `);

    await db.execute(sql`
      CREATE UNIQUE INDEX ${sql.identifier(NAME_INDEX_NAME)}
      ON filter_presets (household_id, user_id, context, name)
    `);
    createdNameIndex = true;
  }

  async function seedScope(label: string) {
    const suffix = `${label}-${randomUUID().slice(0, 8)}`;
    const user = createTestUser({
      email: `filter-name-${suffix}@example.com`,
      username: `filter_name_${suffix.replace(/-/g, "_")}`,
    });
    const household = createTestHousehold(user.id, {
      name: `Filter Name ${suffix}`,
    });

    await db.insert(households).values({
      id: household.id,
      name: household.name,
      currency: household.currency,
    });
    await db.insert(users).values({
      id: user.id,
      email: user.email,
      username: user.username,
      passwordHash: user.passwordHash,
      fullName: user.fullName,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil,
    });
    await db.insert(householdMembers).values({
      householdId: household.id,
      userId: user.id,
      role: "owner",
      joinedAt: new Date(),
    });

    createdHouseholdIds.push(household.id);
    createdUserIds.push(user.id);

    return { householdId: household.id, userId: user.id };
  }

  beforeAll(async () => {
    await ensureNameIndex();
  });

  afterAll(async () => {
    try {
      for (const householdId of createdHouseholdIds) {
        await db
          .delete(filterPresets)
          .where(eq(filterPresets.householdId, householdId));
        await db
          .delete(householdMembers)
          .where(eq(householdMembers.householdId, householdId));
        await db.delete(households).where(eq(households.id, householdId));
      }
      for (const userId of createdUserIds) {
        await db.delete(users).where(eq(users.id, userId));
      }
      if (createdNameIndex) {
        await db.execute(
          sql`DROP INDEX IF EXISTS ${sql.identifier(NAME_INDEX_NAME)}`,
        );
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("filter preset name uniqueness cleanup error", error);
    }
  });

  it("database rejects two presets with the same name in one scope", async () => {
    const { householdId, userId } = await seedScope("db");

    await db.insert(filterPresets).values({
      householdId,
      userId,
      name: "Monthly Spend",
      context: "transactions",
      filters: { type: "expense" },
      isDefault: false,
      isShared: false,
    });

    let duplicateError: unknown;
    try {
      await db.insert(filterPresets).values({
        householdId,
        userId,
        name: "Monthly Spend",
        context: "transactions",
        filters: { type: "income" },
        isDefault: false,
        isShared: false,
      });
    } catch (error) {
      duplicateError = error;
    }

    expect(getPostgresError(duplicateError)).toMatchObject({
      code: "23505",
      constraint: NAME_INDEX_NAME,
    });
  });

  it("concurrent same-name creates leave exactly one preset and surface a 409", async () => {
    const { householdId, userId } = await seedScope("create-race");

    const results = await Promise.allSettled([
      filterPresetsService.createPreset({
        householdId,
        userId,
        name: "Race Name",
        context: "transactions",
        filters: { category: "food" },
      }),
      filterPresetsService.createPreset({
        householdId,
        userId,
        name: "Race Name",
        context: "transactions",
        filters: { category: "transport" },
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictError);
    expect(String(rejected[0].reason.message)).toContain("Race Name");

    const rows = await db
      .select()
      .from(filterPresets)
      .where(
        and(
          eq(filterPresets.householdId, householdId),
          eq(filterPresets.userId, userId),
          eq(filterPresets.context, "transactions"),
          eq(filterPresets.name, "Race Name"),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("renaming onto an existing name is rejected with a 409", async () => {
    const { householdId, userId } = await seedScope("rename");

    await filterPresetsService.createPreset({
      householdId,
      userId,
      name: "Keep Me",
      context: "transactions",
      filters: { a: 1 },
    });
    const victim = await filterPresetsService.createPreset({
      householdId,
      userId,
      name: "Rename Me",
      context: "transactions",
      filters: { b: 2 },
    });

    await expect(
      filterPresetsService.updatePreset(victim.id, householdId, userId, {
        name: "Keep Me",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
