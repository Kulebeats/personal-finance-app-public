import { randomUUID } from "node:crypto";
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { auditLogs, storageObjects } from "@shared/schema";
import { createStorageKey, hashStorageBytes, type StorageKey, type StoragePut, type StoredObject } from "../storage";
import { moveLegacyUploads, rollbackLegacyMoveRun } from "../storage/legacy-move";
import { finishLegacyMoveReport, readLegacyMoveReport, startLegacyMoveReport } from "../../../scripts/storage-legacy-move-report";

type Manifest = typeof storageObjects.$inferInsert;
type Audit = typeof auditLogs.$inferInsert;
const fake = vi.hoisted(() => ({
  goalReferences: [] as { filePath: string; householdId: string; mimeType: string }[],
  manifests: new Map<string, Manifest>(),
  audits: [] as Audit[],
  files: new Map<string, Buffer>(),
  objects: new Map<string, StoredObject>(),
  failPut: undefined as string | undefined,
  failDelete: undefined as string | undefined,
}));

vi.mock("node:fs/promises", async importOriginal => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  readFile: async (path: string) => {
    const bytes = fake.files.get(path.split(/[\\/]/).slice(-3).join("/"));
    if (!bytes) throw Object.assign(new Error("Synthetic missing upload"), { code: "ENOENT" });
    return bytes;
  },
}));

vi.mock("../storage/runtime", () => ({
  getObjectStore: () => ({
    put: async ({ key, bytes, mediaType }: StoragePut) => {
      if (Buffer.from(bytes).toString() === fake.failPut) throw new Error("Synthetic interruption");
      const metadata = { key, mediaType, sha256: hashStorageBytes(bytes), size: bytes.length };
      fake.objects.set(key, { bytes, metadata });
      return metadata;
    },
    get: async (key: StorageKey) => fake.objects.get(key),
    delete: async (key: StorageKey) => {
      if (key === fake.failDelete) throw new Error("Synthetic delete failure");
      fake.objects.delete(key);
    },
  }),
}));

vi.mock("../../db", () => {
  const query = (where: SQL) => new PgDialect().sqlToQuery(where);
  return {
    db: {
      select: () => ({
        from: (table: Table) => {
          switch (getTableName(table)) {
            case "goal_image_uploads": return fake.goalReferences;
            case "pending_receipts": return [];
            case "audit_logs": return { leftJoin: () => ({
              where: async (filter: SQL) => {
                const { sql, params } = query(filter);
                expect(sql).toContain("legacyMoveRunId");
                return fake.audits.filter(audit => {
                  const details = audit.details as { operation?: string; legacyMoveRunId?: string };
                  return audit.action === "CREATE" && audit.entityType === "storage_object"
                    && details.operation === "legacy_move" && params.includes(details.legacyMoveRunId);
                }).map(audit => ({
                  entityId: audit.entityId,
                  details: audit.details,
                  manifest: fake.manifests.get((audit.details as { legacyMoveKey: string }).legacyMoveKey) ?? null,
                }));
              },
            }) };
            case "storage_objects": return { where: (filter: SQL) => {
              const { sql, params } = query(filter);
              const rows = [...fake.manifests.values()].filter(row =>
                params.includes(sql.includes('"upload_name"') ? row.uploadName : row.key));
              return Object.assign(Promise.resolve(rows), { limit: async () => rows });
            } };
            default: return { innerJoin: () => Object.assign(Promise.resolve([]), { where: async () => [] }), where: async () => [] };
          }
        },
      }),
      transaction: async (operation: (tx: unknown) => Promise<unknown>) => {
        const commits: (() => void)[] = [];
        const result = await operation({
          insert: (table: Table) => ({
            values: (value: Manifest | Audit) => {
              if (getTableName(table) === "audit_logs") {
                commits.push(() => { fake.audits.push(value as Audit); });
                return Promise.resolve();
              }
              const manifest = value as Manifest;
              commits.push(() => { fake.manifests.set(manifest.key, manifest); });
              return { onConflictDoNothing: () => ({ returning: async () => [{ key: manifest.key }] }) };
            },
          }),
          delete: () => ({ where: async (filter: SQL) => {
            const [key] = query(filter).params as [string];
            commits.push(() => { fake.manifests.delete(key); });
          } }),
        });
        commits.forEach(commit => commit());
        return result;
      },
    },
  };
});

describe("interrupted legacy upload run", () => {
  let runId: string;
  let otherKey: string;
  let firstKey: string;
  let directory: string;
  let reportFile: string;
  let fileName: (name: string) => string;

  beforeEach(async () => {
    fake.goalReferences.length = 0;
    fake.audits.length = 0;
    fake.manifests.clear();
    fake.files.clear();
    fake.objects.clear();
    fake.failPut = undefined;
    fake.failDelete = undefined;
    const householdId = randomUUID();
    fileName = (name) => `goals/${householdId}/${name}.png`;
    for (const name of ["earlier", "first", "second"]) {
      fake.files.set(fileName(name), Buffer.from(name));
    }
    const reference = (name: string) => ({ filePath: `/uploads/${fileName(name)}`, householdId, mimeType: "image/png" });
    directory = mkdtempSync(join(tmpdir(), "a69-legacy-move-"));
    reportFile = join(directory, "move.json");
    runId = startLegacyMoveReport(reportFile);
    fake.goalReferences.push(reference("earlier"));
    const earlier = await moveLegacyUploads({ apply: true, runId: randomUUID() });
    otherKey = earlier.moved[0].key;
    fake.goalReferences.push(reference("first"), reference("second"));
    fake.failPut = "second";
    await expect(moveLegacyUploads({ apply: true, runId })).rejects.toThrow("Synthetic interruption");
    firstKey = [...fake.manifests.values()].find(row => row.uploadName === fileName("first"))!.key;
    fake.failPut = undefined;
  });

  afterEach(() => {
    unlinkSync(reportFile);
    rmdirSync(directory);
  });

  it("rolls back only this run using the committed journal before a full report exists", async () => {
    const saved = readLegacyMoveReport(reportFile);
    expect(saved).toEqual({ runId, state: "started" });
    if (!("runId" in saved)) throw new Error("Expected recoverable report");
    expect(await rollbackLegacyMoveRun(saved.runId)).toMatchObject({ removed: 1 });
    expect([...fake.manifests.keys()]).toEqual([otherKey]);
    expect([...fake.objects.keys()]).toEqual([otherKey]);
    expect(fake.files.get(fileName("first"))).toEqual(Buffer.from("first"));
  });

  it("includes earlier committed moves on resume without adopting another run", async () => {
    const saved = readLegacyMoveReport(reportFile);
    if (!("runId" in saved)) throw new Error("Expected recoverable report");
    expect(() => startLegacyMoveReport(reportFile)).toThrow("EEXIST");
    const resumed = await moveLegacyUploads({ apply: true, runId: saved.runId });
    finishLegacyMoveReport(reportFile, saved.runId, resumed);
    expect(readLegacyMoveReport(reportFile)).toEqual({ runId, state: "complete" });
    expect(resumed.alreadyStored).toBe(1);
    expect(resumed.moved.map(row => row.name).sort()).toEqual([fileName("first"), fileName("second")]);
    expect(resumed.moved.find(row => row.name === fileName("first"))?.key).toBe(firstKey);
    expect(await rollbackLegacyMoveRun(runId)).toMatchObject({ removed: 2 });
    expect([...fake.objects.keys()]).toEqual([otherKey]);
  });

  it("retries deletion of a committed owned key after its manifest has gone", async () => {
    fake.failDelete = firstKey;
    expect(await rollbackLegacyMoveRun(runId)).toMatchObject({ removed: 0, pendingCleanup: [firstKey] });
    expect(fake.manifests.has(firstKey)).toBe(false);
    fake.failDelete = undefined;
    expect(await rollbackLegacyMoveRun(runId)).toMatchObject({ retried: 1, pendingCleanup: [] });
    expect([...fake.objects.keys()]).toEqual([otherKey]);
  });

  it("refuses contradictory journal data before deleting any object", async () => {
    const row = fake.manifests.get(firstKey)!;
    fake.manifests.set(firstKey, { ...row, size: row.size + 1 });
    await expect(rollbackLegacyMoveRun(runId)).rejects.toThrow("Legacy move journal conflicts with its manifest");
    expect([...fake.objects.keys()]).toEqual([otherKey, firstKey]);
  });

  it("does not infer rollback membership for an unknown run id", async () => {
    expect(await rollbackLegacyMoveRun(randomUUID())).toMatchObject({ removed: 0, retried: 0 });
    expect([...fake.objects.keys()]).toEqual([otherKey, firstKey]);
  });

  it("leaves an object without a committed manifest and journal to the orphan cleanup path", async () => {
    const key = createStorageKey("goal-image");
    const bytes = fake.files.get(fileName("second"))!;
    fake.objects.set(key, { bytes, metadata: { key, sha256: hashStorageBytes(bytes), size: bytes.length, mediaType: "image/png" } });
    expect(await rollbackLegacyMoveRun(runId)).toMatchObject({ removed: 1, retried: 0 });
    expect([...fake.objects.keys()]).toEqual([otherKey, key]);
  });

  it("retains old completed reports and refuses an empty unjournaled report", () => {
    writeFileSync(reportFile, JSON.stringify({ applied: true, moved: [{ key: otherKey }] }));
    expect(readLegacyMoveReport(reportFile)).toEqual({ keys: [otherKey] });
    writeFileSync(reportFile, "");
    expect(() => readLegacyMoveReport(reportFile)).toThrow("Empty move report has no rollback membership");
  });
});
