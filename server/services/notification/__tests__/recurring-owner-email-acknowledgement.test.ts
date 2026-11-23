import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchRecurringOwnerEmail } from "../recurring-owner-email";

const state = vi.hoisted(() => ({
  sendMail: vi.fn(),
  readRecipientFails: false,
  row: undefined as { id: string; status: string; attempts: number; reason?: string | null } | undefined,
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: state.sendMail }) },
}));
vi.mock("../../../repositories/NotificationRepository", () => ({
  notificationRepository: { existsByDedupeKey: async () => false },
}));
vi.mock("../recurring-notice", () => {
  const decision = { owner: "bill-owner", content: { title: "Bill due" }, message: { title: "Bill due", body: "Water bill" } };
  return {
    recurringEmailDecision: async () => decision,
    recurringNoticeDedupeKey: () => "water-bill-on-2026-11-25",
    sameContent: Object.is,
    withRecurringEmailDecision: async (_ref: unknown, visit: (value: typeof decision) => Promise<unknown>) => visit(decision),
    RECONSIDERED_EMAIL_REASONS: ["not_email_owner", "not_visible", "email_owner_only"],
  };
});
vi.mock("../../../db", () => ({
  db: {
    insert: () => ({ values: (value: { status: string }) => ({ onConflictDoNothing: () => ({
      returning: async () => {
        if (state.row) return [];
        state.row = { id: "notice", status: value.status, attempts: 1 };
        return [{ id: state.row.id }];
      },
    }) }) }),
    update: () => ({ set: (patch: { status: string; reason?: string | null }) => ({
      where: (filter: SQL) => {
        if (patch.status === "pending") {
          return { returning: async () => {
            const sql = new PgDialect().sqlToQuery(filter);
            if (!state.row || !sql.params.includes(state.row.status)) return [];
            if (state.row.reason && sql.sql.includes("is distinct from") && sql.params.includes(state.row.reason)) return [];
            state.row.status = patch.status;
            state.row.attempts++;
            return [{ id: state.row.id }];
          } };
        }
        Object.assign(state.row!, patch);
        return Promise.resolve();
      },
    }) }),
    select: () => ({ from: (table: Table) => ({
      where: () => {
        const rows = getTableName(table) === "users"
          ? [{ email: "bill-owner@example.invalid" }] : state.row ? [state.row] : [];
        return Object.assign(Promise.resolve(rows), { limit: async () => {
          if (getTableName(table) === "users" && state.readRecipientFails) throw new Error("Synthetic recipient lookup failure");
          return rows;
        } });
      },
    }) }),
  },
}));

const ref = { householdId: "bill-household", recurringId: "water-bill", dueDate: "2026-11-25" };
const gates = { emailEnabled: async () => true, inQuietHours: async () => false };
const acceptance = { accepted: ["bill-owner@example.invalid"], response: "250 queued" };
const failure = (fields: object) => Object.assign(new Error("Synthetic SMTP outcome"), fields);

describe("Recurring owner email acknowledgements", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMTP_HOST", "fake.example.invalid");
    vi.stubEnv("SMTP_USER", "synthetic");
    vi.stubEnv("SMTP_PASS", "synthetic");
    vi.stubEnv("SMTP_FROM", "reminders@example.invalid");
    state.row = undefined;
    state.readRecipientFails = false;
    state.sendMail.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    { code: "ECONNECTION", command: "CONN" },
    { code: "ETIMEDOUT", command: "CONN", timeoutType: "SOCKET_TIMEOUT" },
    { code: "EPROTOCOL", command: "CONN", responseCode: 421, response: "421 unavailable", message: "Unexpected Response: 421 unavailable" },
  ])("suppresses retries after a possibly accepted reminder with %j", async transportError => {
    const acceptedByServer = vi.fn();
    state.sendMail.mockImplementation(async message => {
      acceptedByServer(message.to);
      throw failure(transportError);
    });
    await expect(dispatchRecurringOwnerEmail(ref, gates)).resolves.toBeNull();
    expect(state.row).toMatchObject({ status: "unknown", attempts: 1 });
    await expect(dispatchRecurringOwnerEmail(ref, gates)).resolves.toBeNull();
    expect(state.row).toMatchObject({ status: "unknown", attempts: 1 });
    expect(state.sendMail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ to: "bill-owner@example.invalid" }));
    expect(acceptedByServer).toHaveBeenCalledExactlyOnceWith("bill-owner@example.invalid");
  });

  it.each([
    { code: "EDNS", command: "CONN" },
    { code: "ESOCKET", command: "CONN", syscall: "connect" },
    { code: "ETIMEDOUT", command: "CONN", timeoutType: "GREETING_TIMEOUT" },
    { code: "EPROTOCOL", command: "CONN", responseCode: 421, response: "421 unavailable", message: "Invalid greeting. response=421 unavailable: 421 unavailable" },
    { code: "EENVELOPE", command: "RCPT TO", responseCode: 450 },
    { code: "EMESSAGE", command: "DATA", responseCode: 554 },
  ])("retries a provable non-delivery with %j and dedupes its confirmed acknowledgement", async transportError => {
    state.sendMail.mockRejectedValueOnce(failure(transportError)).mockResolvedValue(acceptance);
    await expect(dispatchRecurringOwnerEmail(ref, gates)).rejects.toThrow("requires a retry");
    expect(state.row).toMatchObject({ status: "failed", reason: "transport_not_accepted", attempts: 1 });
    await expect(dispatchRecurringOwnerEmail(ref, gates)).resolves.toBe("bill-owner");
    expect(state.row).toMatchObject({ status: "sent", attempts: 2 });
    await expect(dispatchRecurringOwnerEmail(ref, gates)).resolves.toBeNull();
    expect(state.sendMail).toHaveBeenCalledTimes(2);
  });

  it("does not replay an older receipt with an opaque transport failure", async () => {
    const receipt = { id: "notice", status: "failed", attempts: 2, reason: "transport_rejected" };
    state.row = { ...receipt };
    await expect(dispatchRecurringOwnerEmail(ref, gates)).resolves.toBeNull();
    expect(state.row).toEqual(receipt);
    expect(state.sendMail).not.toHaveBeenCalled();
  });

  it("retries a failed recipient read before contacting SMTP", async () => {
    state.readRecipientFails = true;
    await expect(dispatchRecurringOwnerEmail(ref, gates)).rejects.toThrow("requires a retry");
    expect(state.row).toMatchObject({ status: "failed", reason: "pre_dispatch_failed", attempts: 1 });
    expect(state.sendMail).not.toHaveBeenCalled();

    state.readRecipientFails = false;
    state.sendMail.mockResolvedValue(acceptance);
    await expect(dispatchRecurringOwnerEmail(ref, gates)).resolves.toBe("bill-owner");
    expect(state.row).toMatchObject({ status: "sent", attempts: 2 });
    expect(state.sendMail).toHaveBeenCalledTimes(1);
  });
});
