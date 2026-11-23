import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, InsertAccount } from "@shared/schema";
import { AuthorizationError, ValidationError } from "../../utils/errorHandler";
import { AccountCoreService } from "../account/AccountCoreService";

const mocks = vi.hoisted(() => ({
  create: vi.fn(), nextOrder: vi.fn(), findMember: vi.fn(), audit: vi.fn(), tx: {},
}));
vi.mock("../../utils/withTransaction", () => ({ withTransaction: vi.fn(async (callback: (tx: object) => unknown) => callback(mocks.tx)) }));
vi.mock("../../repositories/AccountCreationGrant", () => ({ lockAccountCreationGrant: vi.fn() }));
vi.mock("../../repositories/AccountRepository", () => ({ accountRepository: { create: mocks.create, getNextDisplayOrder: mocks.nextOrder } }));
vi.mock("../../repositories/HouseholdRepository", () => ({ householdRepository: { findMember: mocks.findMember } }));
vi.mock("../../repositories/TransactionRepository", () => ({ transactionRepository: {} }));
vi.mock("../BusinessAuditService", () => ({ businessAuditService: { logCreate: mocks.audit } }));
vi.mock("../account/AccountArchiveService", () => ({ archiveAccount: vi.fn(), unarchiveAccount: vi.fn() }));
vi.mock("../../utils/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

const service = new AccountCoreService();
const householdId = "household", actor = "actor", otherOwner = "other-member";
const input = { name: "Owner semantics", type: "checking", initialBalance: "42.50", currency: "ZMW", isPrivate: false } as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.nextOrder.mockResolvedValue(7);
  mocks.audit.mockResolvedValue(undefined);
  mocks.create.mockImplementation(async (data: InsertAccount) => ({ id: "created-account", ...data }) as Account);
});

describe("R04 account creation ownership", () => {
  it.each([
    ["explicit null stays household-shared", { ownerUserId: null }, null],
    ["omitted owner defaults to actor", {}, actor],
    ["explicit undefined defaults to actor", { ownerUserId: undefined }, actor],
    ["explicit self stays actor-owned", { ownerUserId: actor }, actor],
  ] as const)("%s", async (_name, ownership, expectedOwner) => {
    const result = await service.createAccount({ ...input, ...ownership }, householdId, actor);
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      ...input, householdId, ownerUserId: expectedOwner, displayOrder: 7, isAsset: true, balance: "42.50",
    }), mocks.tx);
    expect(result.ownerUserId).toBe(expectedOwner);
    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      householdId, userId: actor, entityId: result.id,
      newValue: expect.objectContaining({ ownerUserId: expectedOwner, createdBy: actor, assignedToOther: false }),
    }));
    expect(mocks.findMember).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin"] as const)("preserves %s assignment to another household member", async role => {
    mocks.findMember.mockImplementation(async (_household: string, id: string) => id === actor ? { role } : { role: "member" });
    const result = await service.createAccount({ ...input, ownerUserId: otherOwner }, householdId, actor);
    expect(result.ownerUserId).toBe(otherOwner);
    expect(mocks.findMember.mock.calls).toEqual([[householdId, actor], [householdId, otherOwner]]);
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ownerUserId: otherOwner }), mocks.tx);
    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      newValue: expect.objectContaining({ ownerUserId: otherOwner, assignedToOther: true }),
    }));
  });

  it.each(["member", "view_only", "professional"] as const)("rejects %s assignment to another member without persistence", async role => {
    mocks.findMember.mockResolvedValue({ role });
    await expect(service.createAccount({ ...input, ownerUserId: otherOwner }, householdId, actor)).rejects.toThrow(AuthorizationError);
    expect(mocks.findMember.mock.calls).toEqual([[householdId, actor]]);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("rejects a nonmember target even for an administrator without persistence", async () => {
    mocks.findMember.mockImplementation(async (_household: string, id: string) => id === actor ? { role: "admin" } : undefined);
    await expect(service.createAccount({ ...input, ownerUserId: otherOwner }, householdId, actor)).rejects.toThrow(ValidationError);
    expect(mocks.findMember.mock.calls).toEqual([[householdId, actor], [householdId, otherOwner]]);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("rejects private ownership explicitly set to Shared without persistence", async () => {
    await expect(service.createAccount({ ...input, isPrivate: true, ownerUserId: null }, householdId, actor)).rejects.toThrow("Private accounts must have an owner");
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each([{}, { ownerUserId: actor }])("preserves private actor ownership for omitted or explicit self", async ownership => {
    const result = await service.createAccount({ ...input, isPrivate: true, ...ownership }, householdId, actor);
    expect(result).toMatchObject({ ownerUserId: actor, isPrivate: true });
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.audit).toHaveBeenCalledTimes(1);
  });
});
