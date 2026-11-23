import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import type { User } from "@shared/schema";

const state = vi.hoisted(() => ({ current: {} as User, found: true, valid: true,
  sessions: vi.fn(), revoke: vi.fn(), insert: vi.fn(), regenerate: vi.fn() }));
vi.mock("../../../../../server/db", () => ({ db: { select: () => ({ from: () => ({ where: async () => [{
  generation: state.current.securityGeneration, hash: state.current.passwordHash, erasedAt: null,
}] }) }) } }));
vi.mock("../../../../../server/utils/withTransaction", () => ({ withTransaction: async (fn: (tx: unknown) => unknown) => fn({
  select: () => ({ from: () => ({ where: () => ({ for: async () => [state.current] }) }) }),
  insert: state.insert,
}) }));
vi.mock("../../../../../server/services/session-revocation", () => ({ revokeSessionByToken: state.revoke }));
vi.mock("../../../../../server/repositories/UserRepository", () => ({ userRepository: {
  findByEmail: async () => state.found ? { ...state.current } : undefined,
  findById: async () => ({ ...state.current }), update: vi.fn(), createLoginHistory: vi.fn(), findSessions: state.sessions,
} }));
vi.mock("../../../../../server/auth", () => ({ verifyPassword: async () => state.valid, hashPassword: vi.fn(), validatePasswordComplexity: vi.fn() }));
vi.mock("../../../../../server/seed", () => ({ seedDefaultNotificationPreferences: vi.fn() }));
vi.mock("../../../../../server/services/NotificationService", () => ({ notificationService: { triggerNewLogin: vi.fn() } }));
vi.mock("../../../../../server/services/AuditService", () => ({ auditService: { log: vi.fn() }, AuditEventType: { LOGIN_FAILED: "LOGIN_FAILED" } }));
vi.mock("../../../../../server/modules/auth/auth.security.monitor", () => ({ authSecurityMonitor: {
  checkGeoAnomaly: async () => undefined, checkLoginVelocity: async () => undefined,
} }));
vi.mock("../../../../../server/modules/auth/auth.mfa.service", () => ({ authMfaService: {} }));
vi.mock("../../../../../server/modules/auth/auth.email.service", () => ({ authEmailService: {} }));
vi.mock("../../../../../server/utils/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { authService } from "../../../../../server/modules/auth/auth.service";
import { handleLoginApi } from "../useAuthHandlers";
import { clearCsrfToken } from "@/lib/csrf";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";
import { listenForRemoteSessionInvalidation } from "@/lib/session";

function deferred() { let resolve!: () => void; return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() }; }

describe("C2 actual login/session/identity sequence with synthetic persistence adapters", () => {
  let req: Request;
  let responseCode: string | undefined;
  beforeEach(() => {
    vi.clearAllMocks(); clearCsrfToken(); responseCode = undefined; state.found = true; state.valid = true;
    state.current = { id: "synthetic-user", email: "synthetic@example.invalid", passwordHash: "old-hash",
      securityGeneration: 0, emailVerified: true, mfaEnabled: false, erasedAt: null, failedLoginAttempts: 0 } as User;
    state.sessions.mockResolvedValue([]); state.revoke.mockResolvedValue(undefined);
    req = { ip: "192.0.2.1", headers: {}, sessionID: "old-sid", session: {
      userId: state.current.id, securityGeneration: 0, cookie: {}, regenerate: (done: (error?: Error) => void) => {
        state.regenerate(); Object.assign(req, { sessionID: "new-sid", session: { cookie: {} } }); done();
      },
    } } as unknown as Request;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/csrf-token") return new Response(JSON.stringify({ csrfToken: "token" }));
      try {
        const data = await authService.login({ email: state.current.email, password: "submitted", rememberMe: false }, req);
        return new Response(JSON.stringify({ success: true, data }));
      } catch (error) {
        const failure = error as { code: string; statusCode: number; message: string }; responseCode = failure.code;
        return new Response(JSON.stringify({ error: { code: failure.code, message: failure.message } }), { status: failure.statusCode });
      }
    }));
  });
  afterEach(() => { retireOperationLifetime(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  function deliverToPeer(calls: unknown[][]) {
    // A separate tab owns its own operation module. Activate its simulated
    // lifetime after origin completion, then replay only emitted storage signals.
    const peer = createOperationLifetime({ subject: "synthetic-user" }); activateOperationLifetime(peer);
    let draft = "unsaved household draft";
    const unsubscribe = listenForRemoteSessionInvalidation(() => { draft = ""; });
    try {
      for (const [key, newValue] of calls) if (key === "capital.session.invalidate")
        window.dispatchEvent(new StorageEvent("storage", { key: String(key), newValue: String(newValue) }));
      return { active: peer.active, draft };
    } finally { unsubscribe(); }
  }

  it("retires the peer lifetime when credential reset wins after SID regeneration", async () => {
    const gate = deferred(); state.sessions.mockImplementationOnce(async () => { await gate.promise; return []; });
    const broadcast = vi.spyOn(localStorage, "setItem");
    const pending = handleLoginApi({ email: state.current.email, password: "submitted", rememberMe: false });
    await vi.waitFor(() => expect(state.sessions).toHaveBeenCalledOnce());
    expect(state.revoke).toHaveBeenCalledWith(expect.anything(), "synthetic-user", "old-sid");
    expect(state.regenerate).toHaveBeenCalledOnce(); expect(req.sessionID).toBe("new-sid");
    state.current = { ...state.current, passwordHash: "reset-hash", securityGeneration: 1 };
    gate.resolve(); expect(await pending).toMatchObject({ success: false });
    expect(responseCode).toBe("UNAUTHORIZED"); expect(req.session.userId).toBeUndefined();
    expect(state.insert).not.toHaveBeenCalled();
    expect(deliverToPeer(broadcast.mock.calls)).toEqual({ active: false, draft: "" });
  });
  it.each([true, false])("credential rejection (existing user %s) preserves peer drafts before rotation", async found => {
    state.found = found; state.valid = false;
    const broadcast = vi.spyOn(localStorage, "setItem");
    expect(await handleLoginApi({ email: state.current.email, password: "wrong", rememberMe: false })).toMatchObject({ success: false });
    expect(responseCode).toBe("INVALID_CREDENTIALS");
    expect(state.regenerate).not.toHaveBeenCalled(); expect(state.revoke).not.toHaveBeenCalled();
    expect(deliverToPeer(broadcast.mock.calls)).toEqual({ active: true, draft: "unsaved household draft" });
  });
});
