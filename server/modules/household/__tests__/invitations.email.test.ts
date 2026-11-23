import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHouseholdRepository = vi.hoisted(() => ({
  findByUserId: vi.fn(),
  findMember: vi.fn(),
  findPendingInvitationByEmail: vi.fn(),
  createInvitation: vi.fn(),
  findInvitationById: vi.fn(),
}));

const mockUserRepository = vi.hoisted(() => ({
  findByEmail: vi.fn(),
  findById: vi.fn(),
}));

const mockAuditService = vi.hoisted(() => ({
  logCreate: vi.fn().mockResolvedValue(undefined),
  logUpdate: vi.fn().mockResolvedValue(undefined),
  logDelete: vi.fn().mockResolvedValue(undefined),
  log: vi.fn().mockResolvedValue(undefined),
  getIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
}));

const mockSendEmail = vi.hoisted(() => vi.fn().mockResolvedValue(true));

const mockRotateInvitationForResend = vi.hoisted(() => vi.fn());

vi.mock("../invitations.resend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../invitations.resend")>()),
  rotateInvitationForResend: mockRotateInvitationForResend,
}));

vi.mock("../../../repositories/HouseholdRepository", () => ({
  householdRepository: mockHouseholdRepository,
}));

vi.mock("../../../repositories/UserRepository", () => ({
  userRepository: mockUserRepository,
}));

vi.mock("../../../services/BusinessAuditService", () => ({
  businessAuditService: mockAuditService,
}));

vi.mock("../../../services/emailService", () => ({
  sendEmail: mockSendEmail,
}));

import { invitationsController } from "../invitations.controller";

function createResponse() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("household invitations email delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockHouseholdRepository.findByUserId.mockResolvedValue({
      id: "household-1",
      name: "Family Home",
      currency: "ZMW",
    });
    mockHouseholdRepository.findMember.mockResolvedValue({
      householdId: "household-1",
      userId: "user-1",
      role: "owner",
    });
    mockUserRepository.findByEmail.mockResolvedValue(undefined);
    mockUserRepository.findById.mockResolvedValue({
      id: "user-1",
      fullName: "Owner User",
      displayName: null,
      username: "owner-user",
    });
    mockSendEmail.mockResolvedValue(true);
  });

  it("sends email when creating an invitation", async () => {
    mockHouseholdRepository.findPendingInvitationByEmail.mockResolvedValue(
      undefined
    );
    mockHouseholdRepository.createInvitation.mockResolvedValue({
      id: "invite-1",
      householdId: "household-1",
      email: "invitee@example.com",
      role: "member",
      inviteCode: "a".repeat(64),
      invitedBy: "user-1",
      expiresAt: new Date("2026-02-14T00:00:00.000Z"),
      createdAt: new Date("2026-02-07T00:00:00.000Z"),
    });

    const req: any = {
      session: { userId: "user-1" },
      body: { email: "invitee@example.com", role: "member" },
    };
    const res = createResponse();
    const next = vi.fn();

    await invitationsController.inviteMember(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "invitee@example.com",
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("emails only the new code when resending an invitation", async () => {
    const existingInvitation = {
      id: "invite-2",
      householdId: "household-1",
      email: "invitee@example.com",
      role: "member",
      inviteCode: "b".repeat(64),
      invitedBy: "user-1",
      expiresAt: new Date("2026-02-10T00:00:00.000Z"),
      acceptedAt: null,
      createdAt: new Date("2026-02-07T00:00:00.000Z"),
    };

    const rotatedCode = "d".repeat(64);
    mockRotateInvitationForResend.mockResolvedValue({
      invitation: {
        ...existingInvitation,
        inviteCode: rotatedCode,
        expiresAt: new Date("2026-02-14T00:00:00.000Z"),
      },
      inviteCode: rotatedCode,
    });

    const req: any = {
      session: { userId: "user-1" },
      params: { inviteId: "invite-2" },
    };
    const res = createResponse();
    const next = vi.fn();

    await invitationsController.resendInvite(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "invitee@example.com",
      })
    );
    const [{ html, text }] = mockSendEmail.mock.calls[0];
    expect(text).toContain(`/invite/${rotatedCode}`);
    expect(html).toContain(`/invite/${rotatedCode}`);
    expect(`${html}${text}`).not.toContain(existingInvitation.inviteCode);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("does not block invitation creation when email sending fails", async () => {
    mockSendEmail.mockResolvedValue(false);
    mockHouseholdRepository.findPendingInvitationByEmail.mockResolvedValue(
      undefined
    );
    mockHouseholdRepository.createInvitation.mockResolvedValue({
      id: "invite-3",
      householdId: "household-1",
      email: "invitee@example.com",
      role: "member",
      inviteCode: "c".repeat(64),
      invitedBy: "user-1",
      expiresAt: new Date("2026-02-14T00:00:00.000Z"),
      createdAt: new Date("2026-02-07T00:00:00.000Z"),
    });

    const req: any = {
      session: { userId: "user-1" },
      body: { email: "invitee@example.com", role: "member" },
    };
    const res = createResponse();
    const next = vi.fn();

    await invitationsController.inviteMember(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

