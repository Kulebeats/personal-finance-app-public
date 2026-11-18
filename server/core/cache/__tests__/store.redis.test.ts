import { afterEach, describe, expect, it, vi } from "vitest";
import { CacheStore, type CacheRedisBackend } from "../store";

type RemoteEntry = {
  value: unknown;
  ttlSeconds: number;
};

function makeRedisBackend() {
  const remote = new Map<string, RemoteEntry>();
  const backend = {
    isEnabled: vi.fn(() => true),
    getJson: vi.fn(async <T>(key: string): Promise<T | null> => {
      return remote.has(key) ? (remote.get(key)!.value as T) : null;
    }),
    setJson: vi.fn(async <T>(
      key: string,
      value: T,
      ttlSeconds: number,
    ): Promise<boolean> => {
      remote.set(key, { value, ttlSeconds });
      return true;
    }),
    deleteKey: vi.fn(async (key: string): Promise<boolean> => remote.delete(key)),
    deleteByPrefix: vi.fn(async (prefix: string): Promise<number> => {
      let deleted = 0;
      for (const key of [...remote.keys()]) {
        if (key.startsWith(prefix)) {
          remote.delete(key);
          deleted++;
        }
      }
      return deleted;
    }),
  };

  return { backend, remote };
}

describe("CacheStore Redis backend", () => {
  const stores: CacheStore[] = [];

  afterEach(() => {
    for (const store of stores) {
      store.destroy();
    }
    stores.length = 0;
  });

  function makeStore(
    backend: ReturnType<typeof makeRedisBackend>["backend"],
    config = {},
  ) {
    const store = new CacheStore(
      { checkIntervalMs: 60_000, ...config },
      backend as CacheRedisBackend,
    );
    stores.push(store);
    return store;
  }

  it("uses Redis as shared cache when enabled", async () => {
    const { backend } = makeRedisBackend();
    const first = makeStore(backend);
    const second = makeStore(backend);

    await first.setAsync("txn-summary:hh-1", { totalExpenses: 42 }, 5_000);

    expect(first.get("txn-summary:hh-1")).toBeUndefined();
    await expect(second.getAsync("txn-summary:hh-1")).resolves.toEqual({
      totalExpenses: 42,
    });
    expect(backend.setJson).toHaveBeenCalledWith(
      "core-cache:txn-summary:hh-1",
      { totalExpenses: 42 },
      5,
    );
  });

  it("honors millisecond TTLs by rounding up to Redis seconds", async () => {
    const { backend, remote } = makeRedisBackend();
    const store = makeStore(backend);

    await store.setAsync("short", "value", 2_100);

    expect(remote.get("core-cache:short")?.ttlSeconds).toBe(3);
  });

  it("falls back to in-memory cache when Redis is disabled", async () => {
    const { backend } = makeRedisBackend();
    backend.isEnabled.mockReturnValue(false);
    const store = makeStore(backend, { defaultTtlMs: 5 });

    await store.setAsync("local", "value");
    await expect(store.getAsync("local")).resolves.toBe("value");

    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(store.getAsync("local")).resolves.toBeUndefined();
    expect(backend.getJson).not.toHaveBeenCalled();
    expect(backend.setJson).not.toHaveBeenCalled();
  });

  it("deletes Redis keys by prefix-compatible patterns", async () => {
    const { backend, remote } = makeRedisBackend();
    const store = makeStore(backend);

    await store.setAsync("reports:a", 1, 5_000);
    await store.setAsync("reports:b", 2, 5_000);
    await store.setAsync("other:c", 3, 5_000);

    await expect(store.deletePatternAsync("^reports:")).resolves.toBe(2);

    expect([...remote.keys()].sort()).toEqual(["core-cache:other:c"]);
  });
});
