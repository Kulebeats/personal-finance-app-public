import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
const state = vi.hoisted(() => ({ user: { id: "user", email: "synthetic@example.invalid", passwordHash: "hash", emailVerified: false, pendingEmail: null, erasedAt: null, emailVerificationToken: "hash", emailVerificationExpiry: null as Date | null }, update: vi.fn(), lock: vi.fn() }));
vi.mock("../../auth", () => ({ verifyPassword: async () => true }));
vi.mock("../../repositories/UserRepository", () => ({ userRepository: { findById: async () => state.user, findByEmail: async () => state.user } }));
vi.mock("../session-identity", () => ({ lockCurrentSessionCredential: async () => { await state.lock(); return state.user; } }));
vi.mock("../../utils/withTransaction", () => ({ withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
  select: () => ({ from: () => ({ where: () => ({ for: async () => { await state.lock(); return [state.user]; } }) }) }),
  update: () => ({ set: (value: Partial<typeof state.user>) => ({ where: async () => { state.update(value); Object.assign(state.user, value); } }) }),
}) }));
import { issueInitialEmailVerification, resendOwnEmailVerification } from "../security-email";
const req = { session: { userId: "user" } } as Request;
describe("C2 persisted email resend cooldown (UNIT locked-row adapter)", () => {
  beforeEach(() => { vi.clearAllMocks(); state.lock.mockResolvedValue(undefined); state.user.emailVerificationExpiry = null; });
  afterEach(() => vi.useRealTimers());
  it.each(["public", "authenticated"])("%s starts its cooldown after a 61-second row-lock wait", async entry => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); state.lock.mockImplementationOnce(() => gate);
    const issue = () => entry === "public" ? issueInitialEmailVerification(state.user.email) : resendOwnEmailVerification(req);
    const pending = issue();
    await vi.waitFor(() => expect(state.lock).toHaveBeenCalledOnce());
    vi.setSystemTime(Date.now() + 61000); release(); await pending;
    const token = state.user.emailVerificationToken;
    if (entry === "public") expect(await issue()).toBeNull();
    else await expect(issue()).rejects.toMatchObject({ statusCode: 429, retryAfter: 60 });
    expect(state.user.emailVerificationToken).toBe(token); expect(state.update).toHaveBeenCalledOnce();
  });
  it("prevents immediate repeated authenticated token rotation", async () => {
    await resendOwnEmailVerification(req);
    await expect(resendOwnEmailVerification(req)).rejects.toMatchObject({ statusCode: 429, retryAfter: expect.any(Number) });
    expect(state.update).toHaveBeenCalledTimes(1);
  });
  it("public resend cannot bypass an authenticated resend cooldown", async () => {
    await resendOwnEmailVerification(req);
    expect(await issueInitialEmailVerification(state.user.email)).toBeNull();
    expect(state.update).toHaveBeenCalledTimes(1);
  });
  it("authenticated resend cannot bypass a public resend cooldown", async () => {
    await issueInitialEmailVerification(state.user.email);
    await expect(resendOwnEmailVerification(req)).rejects.toMatchObject({ statusCode: 429 });
    expect(state.update).toHaveBeenCalledTimes(1);
  });
  it("permits resend after the cooldown expires", async () => {
    state.user.emailVerificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000 - 61000);
    expect(await resendOwnEmailVerification(req)).toMatchObject({ email: state.user.email });
    expect(state.update).toHaveBeenCalledTimes(1);
  });
});
