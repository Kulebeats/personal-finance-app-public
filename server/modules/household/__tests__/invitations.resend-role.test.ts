import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HouseholdInvitation } from "@shared/schema";
import { rotateInvitationForResend } from "../invitations.resend";

const state = vi.hoisted(() => ({
  read: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("../../../utils/withTransaction", () => ({
  withTransaction: async (operation: (tx: unknown) => Promise<unknown>) => operation({
    select: () => ({
      from: (table: Parameters<typeof getTableName>[0]) => ({
        where: () => ({ for: (lock: string) => ({ limit: () => state.read(getTableName(table), lock) }) }),
      }),
    }),
    update: () => ({
      set: (values: Partial<HouseholdInvitation>) => ({
        where: () => ({ returning: () => state.update(values) }),
      }),
    }),
  }),
}));
vi.mock("../../../services/BusinessAuditService", () => ({ businessAuditService: { logUpdate: state.audit } }));

const actor = { userId: "actor", householdId: "household" };
const expired = {
  id: "invitation", householdId: actor.householdId, email: "invitee@example.invalid",
  role: "admin", expiresAt: new Date("2026-01-01T00:00:00Z"), inviteCode: "old-synthetic-code",
  acceptedAt: null,
};

function rows(memberRole: string | null, inviteRole = "admin") {
  const invite = { ...expired, role: inviteRole };
  state.read.mockImplementation((table: string) => {
    if (table === "households") return [{ id: actor.householdId }];
    if (table === "household_members") return memberRole ? [{ role: memberRole }] : [];
    if (table === "household_invitations") return [invite];
    throw new Error(`Unexpected read of ${table}`);
  });
  state.update.mockImplementation(values => [{ ...invite, ...values }]);
}

describe("A-54 invitation grants at the locked resend boundary", () => {
  beforeEach(() => vi.resetAllMocks());

  it("refuses an admin resending an expired owner-issued admin grant before rotation or audit", async () => {
    rows("admin");
    await expect(rotateInvitationForResend(actor, expired.id)).rejects.toMatchObject({ statusCode: 403 });
    expect(state.read.mock.calls).toEqual([
      ["households", "update"], ["household_members", "update"], ["household_invitations", "update"],
    ]);
    expect(state.update).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled();
  });

  it.each(["member", "view_only", "professional", null])("refuses current role %s before reading the invitation", async role => {
    rows(role, "member");
    await expect(rotateInvitationForResend(actor, expired.id)).rejects.toMatchObject({ statusCode: 403 });
    expect(state.read).not.toHaveBeenCalledWith("household_invitations", "update");
    expect(state.update).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled();
  });

  it("refuses an invitation with a legacy owner target role", async () => {
    rows("owner", "owner");
    await expect(rotateInvitationForResend(actor, expired.id)).rejects.toMatchObject({ statusCode: 403 });
    expect(state.update).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled();
  });

  it.each([["owner", "admin"], ["admin", "member"], ["admin", "view_only"], ["admin", "professional"]])(
    "permits %s renewing %s under the same role policy as creation", async (memberRole, inviteRole) => {
      rows(memberRole, inviteRole);
      const resent = await rotateInvitationForResend(actor, expired.id);
      expect(resent.invitation).toMatchObject({ role: inviteRole, inviteCode: resent.inviteCode });
      expect(resent.inviteCode).not.toBe(expired.inviteCode);
      expect(resent.invitation.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(state.audit).toHaveBeenCalledOnce();
      expect(state.audit.mock.calls[0][0]).toMatchObject({ userId: actor.userId, entityId: expired.id });
      expect(JSON.stringify(state.audit.mock.calls[0][0])).not.toContain(resent.inviteCode);
    },
  );
});
