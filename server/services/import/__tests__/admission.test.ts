import { EventEmitter } from "node:events";
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { accountImportKey, batchImportKey, withImportAdmission } from "../admission";

function session() {
  const seen: string[] = [];
  const release = vi.fn();
  const attempt = vi.fn((_key: string) => ({ acquired: true, pid: 42 }));
  const unlock = vi.fn((_key: string) => ({ released: true }));
  const verify = vi.fn(() => ({ pid: 42, held: 2 }));
  const connection = Object.assign(new EventEmitter(), { release, query: vi.fn(async (query: { text: string; values?: string[] }) => {
    const { text, values } = query;
    const key = values?.[0] ?? "";
    if (text.includes("pg_try_advisory_lock")) { seen.push(`lock:${key}`); return { rows: [attempt(key)] }; }
    if (text.includes("pg_advisory_unlock")) { seen.push(`unlock:${key}`); return { rows: [unlock(key)] }; }
    if (text.includes("pg_locks")) { seen.push("verify"); return { rows: [verify()] }; }
    seen.push(text);
    return { rows: [] };
  }) });
  const pool = { connect: vi.fn(async () => connection as unknown as PoolClient) };
  const timing = { waitMs: 20, pollMs: 5, now: () => elapsed, sleep: async (ms: number) => { elapsed += ms; } };
  let elapsed = 0;
  return { connection, pool, timing, seen, attempt, unlock, verify, release };
}

const batch = batchImportKey("HOUSE", "BATCH");
const account = accountImportKey("ACCOUNT");

describe("import admission with a simulated driver session", () => {
  it("holds wizard batch then account on the same session as its transaction, and releases in reverse", async () => {
    const f = session();
    expect(batch).toBe("csv-import-batch:house:batch");
    expect(account).toBe("csv-import:account");
    await expect(withImportAdmission(async lease => {
      await lease.acquire(batch);
      await lease.acquire(account);
      return lease.transaction(async () => "committed");
    }, f.pool, f.timing)).resolves.toBe("committed");
    expect(f.seen).toEqual([`lock:${batch}`, `lock:${account}`, "begin", "verify", "commit", `unlock:${account}`, `unlock:${batch}`]);
    expect(f.release).toHaveBeenCalledOnce();
    expect(f.release).toHaveBeenCalledWith(false);
  });

  it("bounds contention and releases the prior lock without opening a writer transaction", async () => {
    const f = session();
    f.attempt.mockImplementation(key => ({ acquired: key === batch, pid: 42 }));
    const work = vi.fn();
    await expect(withImportAdmission(async lease => {
      await lease.acquire(batch);
      await lease.acquire(account);
      await lease.transaction(work);
    }, f.pool, f.timing)).rejects.toMatchObject({ statusCode: 503, code: "IMPORT_BUSY" });
    expect(work).not.toHaveBeenCalled();
    expect(f.seen.at(-1)).toBe(`unlock:${batch}`);
    expect(f.release).toHaveBeenCalledWith(false);
  });

  it("never opens financial work after session loss or backend change", async () => {
    for (const failure of ["disconnect", "backend"] as const) {
      const f = session();
      const work = vi.fn();
      await expect(withImportAdmission(async lease => {
        await lease.acquire(account);
        if (failure === "disconnect") f.connection.emit("error", new Error("socket closed"));
        else f.verify.mockReturnValue({ pid: 43, held: 1 });
        await lease.transaction(work);
      }, f.pool, f.timing)).rejects.toMatchObject({ statusCode: 503, code: "IMPORT_UNAVAILABLE" });
      expect(work).not.toHaveBeenCalled();
      expect(f.release).toHaveBeenCalledWith(true);
    }
  });

  it("preserves an earlier committed row and refuses the next row if its session is lost", async () => {
    const f = session();
    f.verify.mockReturnValue({ pid: 42, held: 1 });
    const write = vi.fn(async () => "row");
    await expect(withImportAdmission(async lease => {
      await lease.acquire(account);
      expect(await lease.transaction(write)).toBe("row");
      f.connection.emit("end");
      await lease.transaction(write);
    }, f.pool, f.timing)).rejects.toMatchObject({ code: "IMPORT_UNAVAILABLE" });
    expect(write).toHaveBeenCalledOnce();
    expect(f.seen.filter(step => step === "commit")).toHaveLength(1);
    expect(f.release).toHaveBeenCalledWith(true);
  });

  it("discards a connection when acquisition is uncertain or a release returns false", async () => {
    const uncertain = session();
    uncertain.attempt.mockImplementation(() => { throw new Error("query I/O lost"); });
    await expect(withImportAdmission(lease => lease.acquire(account), uncertain.pool, uncertain.timing))
      .rejects.toMatchObject({ code: "IMPORT_UNAVAILABLE" });
    expect(uncertain.release).toHaveBeenCalledWith(true);

    const unreleased = session();
    unreleased.unlock.mockReturnValue({ released: false });
    await expect(withImportAdmission(async lease => { await lease.acquire(account); return "committed"; }, unreleased.pool, unreleased.timing))
      .resolves.toBe("committed");
    expect(unreleased.release).toHaveBeenCalledWith(true);
  });
});
