import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CreateTransactionInput } from "../api";
import * as lifetime from "../operation-lifetime";
import * as drafts from "../ordinary-transaction-draft";

const identity = { subject: "subject-a", household: "household-a" };
const input: CreateTransactionInput = { accountId: "cash", date: "2026-02-12", name: "Confidential orchard",
  amount: { amount: "25.00", currency: "ZMW" }, type: "expense", isPrivate: true, ownerUserId: identity.subject };
const key = () => crypto.randomUUID();
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", { get length() { return values.size; }, key: (index: number) => Array.from(values.keys())[index] ?? null,
    getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, value: string) => { values.set(name, value); },
    removeItem: (name: string) => { values.delete(name); }, clear: () => values.clear() });
  lifetime.activateOperationLifetime(lifetime.createOperationLifetime(identity));
});
afterEach(() => { lifetime.retireOperationLifetime(); vi.unstubAllGlobals(); });

it("retires the cached form and exact payload immediately, retaining only a key/hash across a same-tab module reload", async () => {
  const operation = lifetime.captureOperationLifetime();
  const original = await drafts.prepareOrdinaryDraft(operation, input, { note: "Private form input" }, key);
  expect(Object.isFrozen(original.request)).toBe(true); expect(Object.isFrozen(original.request.amount)).toBe(true);
  lifetime.retireOperationLifetime(); expect(drafts.ordinaryDraftForm(operation)).toBeUndefined();
  const stored = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.getItem(sessionStorage.key(index)!)).join("");
  expect(stored).toContain(original.request.idempotencyKey); for (const secret of ["Confidential", "25.00", "ZMW", "Private form input"]) expect(stored).not.toContain(secret);
  vi.resetModules();
  const reloadedLifetime = await import("../operation-lifetime"), reloadedDrafts = await import("../ordinary-transaction-draft");
  const next = reloadedLifetime.createOperationLifetime(identity); reloadedLifetime.activateOperationLifetime(next);
  try {
    expect(reloadedDrafts.ordinaryDraftForm(next)).toBeUndefined();
    const replay = await reloadedDrafts.prepareOrdinaryDraft(next, input, { reentered: true }, key);
    expect(replay.request).toEqual(original.request);
    reloadedDrafts.completeOrdinaryDraft(replay);
  } finally { reloadedLifetime.retireOperationLifetime(); }
});
it("does not clear a safe retry identity when completion storage fails after a committed response", async () => {
  const operation = lifetime.captureOperationLifetime(), original = await drafts.prepareOrdinaryDraft(operation, input, {}, key);
  const failure = vi.spyOn(sessionStorage, "removeItem").mockImplementationOnce(() => { throw new Error("Synthetic unavailable storage"); });
  expect(() => drafts.completeOrdinaryDraft(original)).toThrow("Synthetic unavailable storage"); failure.mockRestore();
  const replay = await drafts.prepareOrdinaryDraft(operation, input, {}, key); expect(replay.request).toEqual(original.request);
  drafts.completeOrdinaryDraft(replay);
});
it("blocks a retired preparation before it can register or dispatch a replacement operation", async () => {
  const operation = lifetime.captureOperationLifetime(); lifetime.retireOperationLifetime();
  await expect(drafts.prepareOrdinaryDraft(operation, input, {}, key)).rejects.toThrow(/session changed/i);
  expect(sessionStorage.length).toBe(0);
});
