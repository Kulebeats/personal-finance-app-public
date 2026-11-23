import { expect, it } from "vitest";
import { createStorageKey, hashStorageBytes } from "../storage";
import { ownedS3 } from "./fixtures/owned-s3";

const bytes = Buffer.from("owned fixture bytes");
const object = () => ({ key: createStorageKey("receipt"), bytes, mediaType: "image/png" });

it("actual SDK signs owned loopback CRUD and checksum requests, with no public ACL or durability claim", async () => {
  const fixture = await ownedS3();
  try {
    const input = object();
    expect(await fixture.store.put(input)).toMatchObject({ sha256: hashStorageBytes(bytes), size: bytes.length });
    expect(await fixture.store.head(input.key)).toMatchObject({ sha256: hashStorageBytes(bytes) });
    expect(Buffer.from((await fixture.store.get(input.key)).bytes)).toEqual(bytes);
    await expect(fixture.store.put(input)).rejects.toMatchObject({ code: "CONFLICT", writeOutcome: "not_attempted" });
    await fixture.store.probe();
    await fixture.store.delete(input.key);
    await fixture.store.delete(input.key);
    await expect(fixture.store.get(input.key)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fixture.state.checkedWrites).toBe(1);
    expect(fixture.state.signatures).toBe(fixture.state.requests);
    console.log(JSON.stringify({ ownedS3: { host: "127.0.0.1", port: fixture.port, requests: fixture.state.requests,
      signedRequests: fixture.state.signatures, checkedWrites: fixture.state.checkedWrites, ordinaryNetworkGuard: true } }));
  } finally { await fixture.close(); }
});

it("actual SDK readback requests the exact version returned by the write", async () => {
  const fixture = await ownedS3();
  try {
    const input = object();
    const stored = await fixture.store.put(input);
    const versionId = fixture.objects.get(input.key)?.versionId;
    expect(versionId).toEqual(expect.any(String));
    expect(stored.versionId).toBe(versionId);
    expect(fixture.state.lastGetVersionId).toBe(versionId);
    expect(fixture.state.signatures).toBe(2);
    expect(fixture.state.requests).toBe(2);
  } finally { await fixture.close(); }
});

it.each([["forbidden", "FORBIDDEN"], ["unavailable", "UNAVAILABLE"]])("actual SDK normalizes %s without automatic retry", async (mode, code) => {
  const fixture = await ownedS3();
  try {
    fixture.state.mode = mode;
    await expect(fixture.store.get(createStorageKey("receipt"))).rejects.toMatchObject({ code });
    expect(fixture.state.requests).toBe(1);
  } finally { await fixture.close(); }
});

it.each(["tampered", "wrong-hash"])("actual SDK readback rejects %s bytes before write success", async (mode) => {
  const fixture = await ownedS3();
  try {
    fixture.state.mode = mode;
    await expect(fixture.store.put(object())).rejects.toMatchObject({ code: "INTEGRITY", writeOutcome: "unknown" });
    expect(fixture.state.checkedWrites).toBe(1);
  } finally { await fixture.close(); }
});

it("actual stalled HTTP request has bounded unknown write outcome", async () => {
  const fixture = await ownedS3();
  try {
    fixture.state.mode = "hang";
    const started = performance.now();
    await expect(fixture.store.put(object(), { timeoutMs: 100 })).rejects.toMatchObject({ code: "DEADLINE", writeOutcome: "unknown" });
    expect(performance.now() - started).toBeLessThan(1000);
    expect(fixture.state.requests).toBe(1);
  } finally { await fixture.close(); }
});

it("actual stalled response stream is aborted within the overall deadline", async () => {
  const fixture = await ownedS3();
  try {
    const input = object(); await fixture.store.put(input);
    fixture.state.mode = "stream-hang";
    await expect(fixture.store.get(input.key, { timeoutMs: 100 })).rejects.toMatchObject({ code: "DEADLINE" });
  } finally { await fixture.close(); }
});

it("lost write acknowledgement remains unknown even though reconciliation finds the bytes", async () => {
  const fixture = await ownedS3();
  try {
    const input = object();
    fixture.state.mode = "lost-write";
    await expect(fixture.store.put(input, { timeoutMs: 100 })).rejects.toMatchObject({ code: "DEADLINE", writeOutcome: "unknown" });
    fixture.state.mode = "normal";
    expect(Buffer.from((await fixture.store.get(input.key)).bytes)).toEqual(bytes);
    expect(fixture.state.checkedWrites).toBe(1);
  } finally { await fixture.close(); }
});

it("actual caller cancellation after dispatch aborts the HTTP request with unknown outcome", async () => {
  const fixture = await ownedS3();
  try {
    fixture.state.mode = "hang";
    const controller = new AbortController();
    const dispatched = fixture.waitForRequest();
    const pending = fixture.store.put(object(), { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ code: "ABORTED", writeOutcome: "unknown" });
    await dispatched;
    controller.abort();
    await rejected;
    expect(fixture.state.requests).toBe(1);
  } finally { await fixture.close(); }
});
