# Household Module Overhaul Plan

**Created:** 2026-01-26
**Module Score:** 60/100 → Target: 88/100
**Status:** Closed (Re-audited 2026-02-07)

---
## Re-Audit 2026-02-07

Most critical risks from this plan are implemented:

- Route-level rate limiting is present.
- Member role/remove authorization checks are present.
- Audit logging is present across member/invitation/ownership flows.
- Invitation API surface (`accept`, `resend`, `list`, `cancel`, ownership transfer, leave) exists.
- Invitation email delivery now executes via `sendEmail` in invite and resend flows.
- Household integration and validation tests are present.
- Keyboard shortcut and ARIA improvements exist in Members UI.

---

## Current State Summary

The Household module controls access to ALL financial data in the application but has **critical security and compliance gaps**:

### Critical Issues
- **ZERO audit logging** - Member operations (role changes, removals) are not logged
- **ZERO rate limiting** - All 7 endpoints vulnerable to DOS
- **NO authorization checks** - Any member can change any role
- **Invitation system is placeholder** - No emails sent, no tokens created
- **<20% test coverage** - Only middleware has tests

### What's Working Well
- householdGuard middleware (excellent isolation)
- Clean server architecture (all files under LOC limits)
- Data isolation (household-scoped queries)
- Functional UI with dark mode
- Mobile responsiveness

---

## Issue Registry

### From Senior Developer Review (62/100)

| ID | Description | Location | Priority |
|----|-------------|----------|----------|
| ARCH-001 | Missing authorization checks in controller | household.controller.ts:135-180 | P0 |
| RATE-001 | No rate limiting on any endpoint | household.routes.ts | P0 |
| AUDIT-001 | No audit logging for member operations | household.controller.ts | P0 |
| TYPE-001 | Role enum mismatch (3 locations) | schema, controller, validation | P1 |
| IMPL-001 | Invitation system is placeholder only | household.controller.ts:187-214 | P1 |
| INC-001 | Incomplete repository (delegates to other repos) | household.repository.ts | P2 |

### From QA Engineer Review (45/100)

| ID | Description | Location | Priority |
|----|-------------|----------|----------|
| TEST-001 | No tests for household.controller | modules/household/__tests__/ | P0 |
| TEST-002 | No tests for HouseholdRepository | repositories/__tests__/ | P1 |
| TEST-003 | No client component tests | client tests | P1 |
| EDGE-001 | Owner self-removal not tested | - | P0 |
| EDGE-002 | Last member removal not tested | - | P0 |
| EDGE-003 | Role escalation not tested | - | P0 |
| EDGE-004 | Duplicate member addition not tested | - | P1 |
| EDGE-005 | Concurrent role changes not tested | - | P2 |
| VAL-001 | Role enum "viewer" should be "view_only" | household.validation.ts:18 | P1 |
| SEC-001 | No role escalation prevention test | - | P0 |
| SEC-002 | No authorization test for non-admin | - | P0 |
| SEC-003 | No rate limiting tests | - | P1 |

### From Fintech Compliance Review (55/100)

| ID | Description | Location | Priority |
|----|-------------|----------|----------|
| AUTHZ-001 | No role-based authorization in controller | household.controller.ts | P0 |
| AUDIT-002 | No logging for role changes | household.controller.ts:135 | P0 |
| AUDIT-003 | No logging for member removal | household.controller.ts:160 | P0 |
| AUDIT-004 | No logging for invitations | household.controller.ts:187 | P0 |
| AUDIT-005 | No logging for household creation | household.controller.ts:50 | P1 |
| AUDIT-006 | No logging for settings updates | household.controller.ts:80 | P1 |
| PRIV-001 | Member emails exposed to all household members | MembersSection.tsx | P2 |

### From Product Manager Review (68/100)

| ID | Description | Location | Priority |
|----|-------------|----------|----------|
| FUNC-001 | Invitation system not implemented (placeholder) | household.controller.ts:187-214 | P1 |
| FUNC-002 | No self-operation protection | household.controller.ts | P0 |
| FUNC-003 | No owner transfer feature | - | P1 |
| FUNC-004 | No leave household feature | - | P1 |
| FUNC-005 | No pending invitations list | - | P2 |
| FUNC-006 | No resend/cancel invitation | - | P2 |
| API-001 | Missing POST /invite/accept endpoint | - | P1 |
| API-002 | Missing POST /transfer-ownership endpoint | - | P1 |
| API-003 | Missing POST /leave endpoint | - | P1 |
| API-004 | Missing GET /invitations endpoint | - | P2 |
| API-005 | Missing DELETE /invite/:id endpoint | - | P2 |
| ERR-001 | Missing "insufficient permission" error | household.controller.ts | P0 |
| ERR-002 | Missing "cannot remove owner" error | household.controller.ts | P0 |
| ERR-003 | Missing "cannot remove self" error | household.controller.ts | P0 |

### From UI/UX Review (72/100)

| ID | Description | Location | Priority |
|----|-------------|----------|----------|
| LOC-001 | HouseholdSection 395 LOC (over by 95) | HouseholdSection/index.tsx | P1 |
| LOC-002 | MembersSection 447 LOC (over by 147) | MembersSection/index.tsx | P1 |
| A11Y-001 | Role descriptions not accessible to screen readers | MembersSection.tsx | P1 |
| A11Y-002 | Member action buttons missing aria-labels | MembersSection.tsx | P1 |
| A11Y-003 | Remove confirmation dialog not announced | MembersSection.tsx | P2 |
| INT-001 | No optimistic updates for role changes | MembersSection.tsx | P2 |
| INT-002 | No undo option for member removal | MembersSection.tsx | P2 |
| KB-001 | No keyboard shortcuts for common actions | MembersSection.tsx | P3 |

---

## Phased Implementation

### Phase 1: Security & Compliance (P0 - BLOCKING)

**Goal:** Fix all security vulnerabilities and compliance gaps

#### 1.1 Add Rate Limiting

**File:** `server/modules/household/household.routes.ts`

```typescript
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { generalLimiter } from "../../middleware/rateLimit";
import { householdController } from "./household.controller";

const router = Router();

// Authentication required for all routes
router.use(requireAuth);

// Rate limiting for all routes
router.use(generalLimiter);  // ADD THIS LINE

router.get("/general", householdController.getGeneral);
router.post("/", householdController.create);
router.put("/general", householdController.updateGeneral);
router.get("/members", householdController.getMembers);
router.put("/members/:userId/role", householdController.updateMemberRole);
router.delete("/members/:userId", householdController.removeMember);
router.post("/invite", householdController.inviteMember);

export default router;
```

#### 1.2 Add Authorization Checks

**File:** `server/modules/household/household.controller.ts`

```typescript
// Add at top of file
import { ForbiddenError, BadRequestError } from "../../core/errors";

// Helper function
function requireRole(context: HouseholdContext, allowedRoles: string[]): void {
  if (!allowedRoles.includes(context.role)) {
    throw new ForbiddenError(
      `This action requires one of: ${allowedRoles.join(", ")}`
    );
  }
}

// Update updateMemberRole
async updateMemberRole(req: Request, res: Response, next: NextFunction) {
  try {
    const context = req.householdContext!;
    const targetUserId = req.params.userId;

    // Authorization check
    requireRole(context, ["owner", "admin"]);

    // Self-modification check
    if (targetUserId === context.userId) {
      throw new BadRequestError("Cannot modify your own role");
    }

    // Prevent removing owner role
    const targetMember = await householdRepository.getMember(
      context.householdId,
      targetUserId
    );
    if (targetMember?.role === "owner" && context.role !== "owner") {
      throw new ForbiddenError("Only the owner can modify the owner role");
    }

    // ... rest of implementation
  } catch (error) {
    next(error);
  }
}

// Update removeMember
async removeMember(req: Request, res: Response, next: NextFunction) {
  try {
    const context = req.householdContext!;
    const targetUserId = req.params.userId;

    // Authorization check
    requireRole(context, ["owner", "admin"]);

    // Self-removal check
    if (targetUserId === context.userId) {
      throw new BadRequestError("Cannot remove yourself from household");
    }

    // Owner protection
    const targetMember = await householdRepository.getMember(
      context.householdId,
      targetUserId
    );
    if (targetMember?.role === "owner") {
      throw new BadRequestError("Cannot remove the household owner");
    }

    // Last member check
    const memberCount = await householdRepository.getMemberCount(context.householdId);
    if (memberCount <= 1) {
      throw new BadRequestError("Cannot remove the last household member");
    }

    // ... rest of implementation
  } catch (error) {
    next(error);
  }
}
```

#### 1.3 Add Audit Logging

**File:** `server/modules/household/household.controller.ts`

```typescript
import { businessAuditService } from "../../core/audit";

// In updateMemberRole - after successful update
await businessAuditService.logUpdate({
  householdId: context.householdId,
  userId: context.userId,
  entityType: "household_member",
  entityId: targetUserId,
  changes: {
    role: { from: targetMember.role, to: parseResult.data.role }
  },
  ipAddress: req.ip || "unknown",
});

// In removeMember - after successful removal
await businessAuditService.logDelete({
  householdId: context.householdId,
  userId: context.userId,
  entityType: "household_member",
  entityId: targetUserId,
  details: {
    removedUserEmail: targetMember.user?.email,
    removedUserRole: targetMember.role,
  },
  ipAddress: req.ip || "unknown",
});

// In inviteMember - after invitation created
await businessAuditService.logCreate({
  householdId: context.householdId,
  userId: context.userId,
  entityType: "household_invitation",
  entityId: invitation.id,
  details: {
    invitedEmail: parseResult.data.email,
    invitedRole: parseResult.data.role,
  },
  ipAddress: req.ip || "unknown",
});

// In create - after household created
await businessAuditService.logCreate({
  householdId: newHousehold.id,
  userId: req.user!.id,
  entityType: "household",
  entityId: newHousehold.id,
  details: {
    name: newHousehold.name,
    currency: newHousehold.currency,
  },
  ipAddress: req.ip || "unknown",
});

// In updateGeneral - after settings updated
await businessAuditService.logUpdate({
  householdId: context.householdId,
  userId: context.userId,
  entityType: "household",
  entityId: context.householdId,
  changes: {
    name: { from: oldHousehold.name, to: parseResult.data.name },
    currency: { from: oldHousehold.currency, to: parseResult.data.currency },
  },
  ipAddress: req.ip || "unknown",
});
```

#### 1.4 Add Authorization Tests

**File:** `server/modules/household/__tests__/household.authorization.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../../app";
import { createTestHousehold, createTestUser } from "../../../test/helpers";

describe("Household Authorization", () => {
  describe("Role Change Authorization", () => {
    it("allows owner to change any member role", async () => {
      const { owner, member, household } = await createTestHousehold();

      const res = await request(app)
        .put(`/api/household/members/${member.id}/role`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ role: "admin" });

      expect(res.status).toBe(200);
    });

    it("allows admin to change member/view_only roles", async () => {
      const { admin, member, household } = await createTestHousehold({ withAdmin: true });

      const res = await request(app)
        .put(`/api/household/members/${member.id}/role`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ role: "view_only" });

      expect(res.status).toBe(200);
    });

    it("prevents member from changing roles", async () => {
      const { member, otherMember, household } = await createTestHousehold({ withMembers: 2 });

      const res = await request(app)
        .put(`/api/household/members/${otherMember.id}/role`)
        .set("Authorization", `Bearer ${member.token}`)
        .send({ role: "admin" });

      expect(res.status).toBe(403);
    });

    it("prevents view_only from changing roles", async () => {
      const { viewer, member, household } = await createTestHousehold({ withViewer: true });

      const res = await request(app)
        .put(`/api/household/members/${member.id}/role`)
        .set("Authorization", `Bearer ${viewer.token}`)
        .send({ role: "admin" });

      expect(res.status).toBe(403);
    });

    it("prevents self role change", async () => {
      const { owner, household } = await createTestHousehold();

      const res = await request(app)
        .put(`/api/household/members/${owner.id}/role`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ role: "member" });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("own role");
    });

    it("prevents role escalation to owner", async () => {
      const { admin, member, household } = await createTestHousehold({ withAdmin: true });

      const res = await request(app)
        .put(`/api/household/members/${member.id}/role`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ role: "owner" });

      expect(res.status).toBe(403);
    });
  });

  describe("Member Removal Authorization", () => {
    it("allows owner to remove members", async () => {
      const { owner, member, household } = await createTestHousehold();

      const res = await request(app)
        .delete(`/api/household/members/${member.id}`)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
    });

    it("prevents owner from removing themselves", async () => {
      const { owner, household } = await createTestHousehold();

      const res = await request(app)
        .delete(`/api/household/members/${owner.id}`)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("yourself");
    });

    it("prevents removing household owner", async () => {
      const { owner, admin, household } = await createTestHousehold({ withAdmin: true });

      const res = await request(app)
        .delete(`/api/household/members/${owner.id}`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("owner");
    });

    it("prevents removing last member", async () => {
      const { owner, household } = await createTestHousehold({ membersOnly: true });

      // Remove all but owner, then try to remove owner
      const res = await request(app)
        .delete(`/api/household/members/${owner.id}`)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(400);
    });

    it("prevents member from removing others", async () => {
      const { member, otherMember, household } = await createTestHousehold({ withMembers: 2 });

      const res = await request(app)
        .delete(`/api/household/members/${otherMember.id}`)
        .set("Authorization", `Bearer ${member.token}`);

      expect(res.status).toBe(403);
    });
  });
});
```

---

### Phase 2: Type Safety & Validation (P1)

**Goal:** Fix type inconsistencies and validation issues

#### 2.1 Create Shared Role Types

**File:** `shared/types/household.ts` (CREATE)

```typescript
/**
 * Household role definitions - SINGLE SOURCE OF TRUTH
 * Used by: schema, controller, validation, client
 */

export const HOUSEHOLD_ROLES = [
  "owner",
  "admin",
  "member",
  "view_only",
  "professional"
] as const;

export type HouseholdRole = typeof HOUSEHOLD_ROLES[number];

export const ASSIGNABLE_ROLES = [
  "admin",
  "member",
  "view_only",
  "professional"
] as const;

export type AssignableRole = typeof ASSIGNABLE_ROLES[number];

export const ROLE_PERMISSIONS = {
  owner: {
    canManageMembers: true,
    canManageSettings: true,
    canManageBudgets: true,
    canViewAll: true,
    canTransferOwnership: true,
  },
  admin: {
    canManageMembers: true,
    canManageSettings: true,
    canManageBudgets: true,
    canViewAll: true,
    canTransferOwnership: false,
  },
  member: {
    canManageMembers: false,
    canManageSettings: false,
    canManageBudgets: true,
    canViewAll: true,
    canTransferOwnership: false,
  },
  view_only: {
    canManageMembers: false,
    canManageSettings: false,
    canManageBudgets: false,
    canViewAll: true,
    canTransferOwnership: false,
  },
  professional: {
    canManageMembers: false,
    canManageSettings: false,
    canManageBudgets: false,
    canViewAll: true,
    canTransferOwnership: false,
  },
} as const;

export function canManageMembers(role: HouseholdRole): boolean {
  return ROLE_PERMISSIONS[role].canManageMembers;
}

export function canManageSettings(role: HouseholdRole): boolean {
  return ROLE_PERMISSIONS[role].canManageSettings;
}
```

#### 2.2 Update Validation File

**File:** `server/modules/household/household.validation.ts`

```typescript
import { z } from "zod";
import { HOUSEHOLD_ROLES, ASSIGNABLE_ROLES } from "../../../shared/types/household";

export const householdRoleSchema = z.enum(HOUSEHOLD_ROLES);

export const assignableRoleSchema = z.enum(ASSIGNABLE_ROLES);

export const createHouseholdSchema = z.object({
  name: z.string().min(1).max(255),
  currency: z.string().length(3).default("ZMW"),
  fiscalYearStartMonth: z.number().int().min(1).max(12).default(1),
});

export const updateHouseholdSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  currency: z.string().length(3).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
});

export const updateMemberRoleSchema = z.object({
  role: assignableRoleSchema,
});

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: assignableRoleSchema.default("member"),
});

export type CreateHouseholdInput = z.infer<typeof createHouseholdSchema>;
export type UpdateHouseholdInput = z.infer<typeof updateHouseholdSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
```

#### 2.3 Update Controller Schemas

**File:** `server/modules/household/household.controller.ts`

```typescript
// Remove inline schemas, import from validation
import {
  createHouseholdSchema,
  updateHouseholdSchema,
  updateMemberRoleSchema,
  inviteMemberSchema,
} from "./household.validation";
```

---

### Phase 3: Feature Completion (P1)

**Goal:** Complete invitation system and missing features

#### 3.1 Implement Invitation System

**File:** `server/modules/household/household.invitation.ts` (CREATE)

```typescript
import crypto from "crypto";
import { db } from "../../storage";
import { householdInvitations } from "../../../shared/schema";
import { eq, and } from "drizzle-orm";
import { emailService } from "../../services/email";

const INVITATION_EXPIRY_HOURS = 48;

export interface CreateInvitationInput {
  householdId: string;
  email: string;
  role: string;
  invitedBy: string;
}

export async function createInvitation(input: CreateInvitationInput) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_HOURS * 60 * 60 * 1000);

  const [invitation] = await db.insert(householdInvitations).values({
    householdId: input.householdId,
    email: input.email,
    role: input.role,
    invitationToken: token,
    invitedBy: input.invitedBy,
    expiresAt,
  }).returning();

  // Send email
  await emailService.send({
    to: input.email,
    template: "household-invitation",
    data: {
      inviteUrl: `${process.env.APP_URL}/invite/accept?token=${token}`,
      householdName: input.householdName,
      inviterName: input.inviterName,
      role: input.role,
      expiresAt: expiresAt.toISOString(),
    },
  });

  return invitation;
}

export async function acceptInvitation(token: string, userId: string) {
  const [invitation] = await db.select()
    .from(householdInvitations)
    .where(eq(householdInvitations.invitationToken, token));

  if (!invitation) {
    throw new NotFoundError("Invitation not found");
  }

  if (invitation.acceptedAt) {
    throw new ConflictError("Invitation already accepted");
  }

  if (new Date() > invitation.expiresAt) {
    throw new BadRequestError("Invitation has expired");
  }

  // Add user to household
  await db.insert(householdMembers).values({
    householdId: invitation.householdId,
    userId,
    role: invitation.role,
  });

  // Mark invitation as accepted
  await db.update(householdInvitations)
    .set({ acceptedAt: new Date() })
    .where(eq(householdInvitations.id, invitation.id));

  return invitation;
}
```

#### 3.2 Add New Endpoints

**File:** `server/modules/household/household.routes.ts`

```typescript
// Add new routes
router.post("/invite/accept", householdController.acceptInvitation);
router.get("/invitations", householdController.getPendingInvitations);
router.delete("/invitations/:id", householdController.cancelInvitation);
router.post("/transfer-ownership", householdController.transferOwnership);
router.post("/leave", householdController.leaveHousehold);
```

#### 3.3 Implement Owner Transfer

**File:** `server/modules/household/household.controller.ts`

```typescript
async transferOwnership(req: Request, res: Response, next: NextFunction) {
  try {
    const context = req.householdContext!;
    const { newOwnerId } = req.body;

    // Only owner can transfer
    if (context.role !== "owner") {
      throw new ForbiddenError("Only the owner can transfer ownership");
    }

    // Verify new owner is a member
    const newOwner = await householdRepository.getMember(
      context.householdId,
      newOwnerId
    );
    if (!newOwner) {
      throw new NotFoundError("User is not a household member");
    }

    // Transfer ownership in transaction
    await withTransaction(async (tx) => {
      // Demote current owner to admin
      await tx.update(householdMembers)
        .set({ role: "admin" })
        .where(and(
          eq(householdMembers.householdId, context.householdId),
          eq(householdMembers.userId, context.userId)
        ));

      // Promote new owner
      await tx.update(householdMembers)
        .set({ role: "owner" })
        .where(and(
          eq(householdMembers.householdId, context.householdId),
          eq(householdMembers.userId, newOwnerId)
        ));
    });

    // Audit log
    await businessAuditService.log({
      householdId: context.householdId,
      userId: context.userId,
      action: "OWNERSHIP_TRANSFERRED",
      entityType: "household",
      entityId: context.householdId,
      details: {
        previousOwner: context.userId,
        newOwner: newOwnerId,
      },
      ipAddress: req.ip || "unknown",
    });

    success(res, { transferred: true });
  } catch (error) {
    next(error);
  }
}

async leaveHousehold(req: Request, res: Response, next: NextFunction) {
  try {
    const context = req.householdContext!;

    // Owner cannot leave without transferring
    if (context.role === "owner") {
      throw new BadRequestError(
        "Owner cannot leave. Transfer ownership first."
      );
    }

    // Check not last member
    const memberCount = await householdRepository.getMemberCount(context.householdId);
    if (memberCount <= 1) {
      throw new BadRequestError("Cannot leave - you are the last member");
    }

    await householdRepository.removeMember(context.householdId, context.userId);

    // Audit log
    await businessAuditService.logDelete({
      householdId: context.householdId,
      userId: context.userId,
      entityType: "household_member",
      entityId: context.userId,
      details: { action: "self_removed" },
      ipAddress: req.ip || "unknown",
    });

    success(res, { left: true });
  } catch (error) {
    next(error);
  }
}
```

---

### Phase 4: Client-Side Improvements (P1)

**Goal:** Split LOC violations and fix accessibility

#### 4.1 Split HouseholdSection (395 LOC → ~250 LOC)

**New Structure:**
```
HouseholdSection/
├── index.tsx              # Container (~80 LOC)
├── HouseholdForm.tsx      # Form logic (~120 LOC)
├── CurrencySelector.tsx   # Currency dropdown (~50 LOC)
└── FiscalYearSelector.tsx # Month picker (~50 LOC)
```

#### 4.2 Split MembersSection (447 LOC → ~300 LOC)

**New Structure:**
```
MembersSection/
├── index.tsx              # Container (~80 LOC)
├── MemberList.tsx         # List display (~100 LOC)
├── MemberCard.tsx         # Single member (~80 LOC)
├── RoleSelector.tsx       # Role dropdown with a11y (~60 LOC)
├── AddMemberModal.tsx     # Invitation dialog (~80 LOC)
└── RemoveMemberDialog.tsx # Confirmation dialog (~50 LOC)
```

#### 4.3 Fix Accessibility Issues

**File:** `MemberCard.tsx`

```tsx
// A11Y-002: Add aria-labels to action buttons
<Button
  variant="ghost"
  size="icon"
  onClick={() => onRemove(member.id)}
  aria-label={`Remove ${member.user.fullName || member.user.email} from household`}
>
  <Trash className="h-4 w-4" />
</Button>

<Button
  variant="ghost"
  size="icon"
  onClick={() => onEdit(member.id)}
  aria-label={`Edit role for ${member.user.fullName || member.user.email}`}
>
  <Settings className="h-4 w-4" />
</Button>
```

**File:** `RoleSelector.tsx`

```tsx
// A11Y-001: Make role descriptions accessible
<Select
  value={role}
  onValueChange={onChange}
  aria-label="Member role"
>
  <SelectTrigger>
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    {ASSIGNABLE_ROLES.map((r) => (
      <SelectItem
        key={r}
        value={r}
        aria-describedby={`role-desc-${r}`}
      >
        <div className="flex flex-col">
          <span>{formatRole(r)}</span>
          <span
            id={`role-desc-${r}`}
            className="text-xs text-muted-foreground"
          >
            {ROLE_DESCRIPTIONS[r]}
          </span>
        </div>
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

**File:** `RemoveMemberDialog.tsx`

```tsx
// A11Y-003: Proper dialog announcement
<AlertDialog>
  <AlertDialogContent
    role="alertdialog"
    aria-labelledby="remove-dialog-title"
    aria-describedby="remove-dialog-description"
  >
    <AlertDialogHeader>
      <AlertDialogTitle id="remove-dialog-title">
        Remove {memberName}?
      </AlertDialogTitle>
      <AlertDialogDescription id="remove-dialog-description">
        This will revoke their access to all household data.
        This action cannot be undone.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={onConfirm}>
        Remove Member
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

---

### Phase 5: Testing & Documentation (P1-P2)

**Goal:** Achieve >80% test coverage

#### 5.1 Test File Structure

```
server/modules/household/__tests__/
├── household.controller.test.ts      # Unit tests
├── household.validation.test.ts      # Schema tests
├── household.integration.test.ts     # API tests
├── household.authorization.test.ts   # Permission tests (Phase 1)
├── household.invitation.test.ts      # Invitation flow tests
└── household.edge-cases.test.ts      # Edge case tests

server/repositories/__tests__/
└── HouseholdRepository.test.ts       # Data layer tests

client/src/pages/settings/sections/HouseholdSection/__tests__/
├── HouseholdSection.test.tsx
└── HouseholdForm.test.tsx

client/src/pages/settings/sections/MembersSection/__tests__/
├── MembersSection.test.tsx
├── MemberCard.test.tsx
└── RoleSelector.test.tsx
```

#### 5.2 Required Test Scenarios

```typescript
// household.integration.test.ts
describe("Household API", () => {
  describe("GET /api/household/general", () => {
    it("returns household details for authenticated user");
    it("returns 401 for unauthenticated request");
    it("returns 404 if user has no household");
  });

  describe("POST /api/household", () => {
    it("creates household for new user");
    it("returns 409 if user already has household");
    it("sets creator as owner");
    it("creates with default preferences");
  });

  describe("PUT /api/household/general", () => {
    it("allows owner to update settings");
    it("allows admin to update settings");
    it("prevents member from updating settings");
    it("validates currency code");
  });

  describe("GET /api/household/members", () => {
    it("returns all members with roles");
    it("includes user details");
    it("orders by role then name");
  });

  describe("PUT /api/household/members/:userId/role", () => {
    it("allows owner to change any role");
    it("prevents non-admin from changing roles");
    it("prevents self-role-change");
    it("validates role enum");
  });

  describe("DELETE /api/household/members/:userId", () => {
    it("allows admin to remove member");
    it("prevents removing owner");
    it("prevents self-removal");
    it("prevents removing last member");
  });

  describe("POST /api/household/invite", () => {
    it("creates invitation with token");
    it("sends email to invitee");
    it("prevents duplicate invitations");
    it("validates email format");
  });

  describe("POST /api/household/invite/accept", () => {
    it("adds user to household");
    it("marks invitation as accepted");
    it("rejects expired invitations");
    it("rejects already-accepted invitations");
  });

  describe("POST /api/household/transfer-ownership", () => {
    it("transfers ownership successfully");
    it("demotes previous owner to admin");
    it("prevents non-owner from transferring");
    it("validates new owner is member");
  });

  describe("POST /api/household/leave", () => {
    it("allows member to leave");
    it("prevents owner from leaving");
    it("prevents last member from leaving");
  });
});
```

---

## Detailed TODO Checklist

### P0 - Must Ship (Blocking)
- [ ] 1. Add `generalLimiter` to household.routes.ts
- [ ] 2. Add authorization check in updateMemberRole
- [ ] 3. Add authorization check in removeMember
- [ ] 4. Add self-operation prevention (cannot modify own role)
- [ ] 5. Add owner protection (cannot remove owner)
- [ ] 6. Add last member protection
- [ ] 7. Add audit logging for role changes
- [ ] 8. Add audit logging for member removal
- [ ] 9. Add audit logging for invitations
- [ ] 10. Create authorization test suite
- [ ] 11. Create integration test suite

### P1 - Should Ship
- [ ] 12. Create shared/types/household.ts with role types
- [ ] 13. Update household.validation.ts to use shared types
- [ ] 14. Update household.controller.ts to use shared types
- [ ] 15. Implement invitation system (token, email, accept)
- [ ] 16. Add POST /invite/accept endpoint
- [ ] 17. Add POST /transfer-ownership endpoint
- [ ] 18. Add POST /leave endpoint
- [ ] 19. Add audit logging for household creation
- [ ] 20. Add audit logging for settings updates
- [ ] 21. Split HouseholdSection into components
- [ ] 22. Split MembersSection into components
- [ ] 23. Add aria-labels to action buttons
- [ ] 24. Make role descriptions accessible
- [ ] 25. Add invitation tests
- [ ] 26. Add client component tests

### P2 - Nice to Have
- [ ] 27. Add GET /invitations endpoint (pending list)
- [ ] 28. Add DELETE /invitations/:id endpoint (cancel)
- [ ] 29. Add proper remove confirmation dialog with announcement
- [ ] 30. Add optimistic updates for role changes
- [ ] 31. Add undo option for member removal
- [ ] 32. Add email visibility toggle option
- [ ] 33. Add repository unit tests

### P3 - Future
- [ ] 34. Add keyboard shortcuts
- [ ] 35. Add concurrent operation handling
- [ ] 36. Add invitation email templates

---

## Verification Checklist

After completing each phase, verify:

### Phase 1 Verification (Security)
- [ ] `npm run check` passes
- [ ] `npm run test:server:run` passes
- [ ] All 7 endpoints have rate limiting
- [ ] Role changes require owner/admin
- [ ] Member removal requires owner/admin
- [ ] Cannot modify own role
- [ ] Cannot remove owner
- [ ] Cannot remove last member
- [ ] All member ops are audit logged
- [ ] Authorization tests pass

### Phase 2 Verification (Types)
- [ ] Single role type definition exists
- [ ] All 3 files use shared types
- [ ] No "viewer" references (should be "view_only")
- [ ] TypeScript compilation passes

### Phase 3 Verification (Features)
- [ ] Invitation emails are sent
- [ ] Invitation acceptance works
- [ ] Owner transfer works
- [ ] Leave household works
- [ ] All new endpoints have audit logging

### Phase 4 Verification (Client)
- [ ] HouseholdSection < 300 LOC
- [ ] MembersSection < 300 LOC
- [ ] All buttons have aria-labels
- [ ] Role descriptions accessible
- [ ] `npm run test:run` passes

### Final Verification
- [ ] Test coverage >80%
- [ ] No CLAUDE.md violations
- [ ] All security tests pass
- [ ] Accessibility audit passes

---

## Files Summary

### Files to CREATE
| File | Purpose |
|------|---------|
| `shared/types/household.ts` | Shared role types |
| `server/modules/household/household.invitation.ts` | Invitation logic |
| `server/modules/household/__tests__/household.authorization.test.ts` | Auth tests |
| `server/modules/household/__tests__/household.integration.test.ts` | API tests |
| `server/modules/household/__tests__/household.invitation.test.ts` | Invite tests |
| `client/.../HouseholdSection/HouseholdForm.tsx` | Split component |
| `client/.../HouseholdSection/CurrencySelector.tsx` | Split component |
| `client/.../MembersSection/MemberList.tsx` | Split component |
| `client/.../MembersSection/MemberCard.tsx` | Split component |
| `client/.../MembersSection/RoleSelector.tsx` | Split component |
| `client/.../MembersSection/AddMemberModal.tsx` | Split component |

### Files to MODIFY
| File | Changes |
|------|---------|
| `server/modules/household/household.routes.ts` | Add rate limiter, new endpoints |
| `server/modules/household/household.controller.ts` | Add authz, audit logging, new handlers |
| `server/modules/household/household.validation.ts` | Use shared types, fix enum |
| `client/.../HouseholdSection/index.tsx` | Refactor to use split components |
| `client/.../MembersSection/index.tsx` | Refactor to use split components |

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Overall Score | 60/100 | 88/100 |
| Senior Dev Score | 62/100 | 85/100 |
| QA Score | 45/100 | 85/100 |
| Fintech Score | 55/100 | 90/100 |
| Test Coverage | <20% | >80% |
| Audit Logging | 0 events | 6 events |
| Rate Limiting | 0/7 endpoints | 7/7 endpoints |
| Authorization Tests | 0 | 15+ |

---

## Timeline Estimate

| Phase | Scope | Effort |
|-------|-------|--------|
| Phase 1 | Security & Compliance | Medium-High |
| Phase 2 | Type Safety | Low |
| Phase 3 | Feature Completion | Medium |
| Phase 4 | Client-Side | Medium |
| Phase 5 | Testing | Medium |

**Recommended Order:** Phase 1 → Phase 2 → Phase 4 → Phase 3 → Phase 5

Phase 1 is blocking and must be completed first. Phase 2 is quick. Phase 4 can be done in parallel with Phase 3.
