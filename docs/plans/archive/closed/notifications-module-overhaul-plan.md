# Notifications Module - Overhaul Plan

**Created:** 2026-01-27
**Based On:** 5-Skill Assessment (64/100)
**Status:** Closed (Re-audited 2026-02-07)

---
## Re-Audit 2026-02-07

Most critical items in this plan are already implemented:

- Route rate limiting is present on notifications routes.
- Audit logging is present for read/archive/batch operations.
- Notification service uses Money-safe threshold comparison.
- Email and push delivery paths are implemented in `server/services/notification/service.ts`.
- Notification cleanup retention jobs are scheduled in `server/scheduler.ts`.
- Integration and client tests exist.
- NotificationBell panel styling now uses semantic design tokens (`border-border`, `bg-card`, `divide-border`) with hardcoded dark hex tokens removed.

---

## Executive Summary

The Notifications module requires immediate fixes for **critical compliance failures**: zero audit logging and zero rate limiting. Additionally, 125 tests are missing across repository, client hooks, and components. This plan addresses all 35 issues identified across the 5-skill reviews.

---

## Issue Registry

### Phase 1: Security & Compliance (P0) - 5 Issues

| ID | Issue | Location | Severity | Effort |
|----|-------|----------|----------|--------|
| RATE-001 | No rate limiting on notification routes | `notifications.routes.ts` | CRITICAL | 15 min |
| RATE-002 | No rate limiting on investment-notifications | `investment-notifications.ts:10-19` | CRITICAL | 15 min |
| AUDIT-001 | No audit logging for markAsRead | `controller.ts:69-86` | CRITICAL | 30 min |
| AUDIT-002 | No audit logging for markAllAsRead | `controller.ts:88-99` | CRITICAL | 30 min |
| AUDIT-003 | No audit logging for archive | `controller.ts:101-125` | CRITICAL | 30 min |

**Phase 1 Total Effort:** ~2 hours

### Phase 2: Error Handling & Type Safety (P1) - 8 Issues

| ID | Issue | Location | Severity | Effort |
|----|-------|----------|----------|--------|
| ERR-001 | Manual 404 response instead of NotFoundError | `controller.ts:80-84` | HIGH | 15 min |
| ERR-002 | Manual 404 response instead of NotFoundError | `controller.ts:114-118` | HIGH | 15 min |
| TYPE-001 | Client duplicates server Notification type | `useNotifications.ts:6-19` | HIGH | 30 min |
| TYPE-002 | `any` types in preferences handling | `useNotifications.ts:145` | MEDIUM | 20 min |
| TYPE-003 | `any` types in notification preferences | `NotificationsForm.tsx` | MEDIUM | 20 min |
| MONEY-001 | Money.toNumber() defeats purpose | `service.ts:179` | MEDIUM | 30 min |
| FUNC-001 | Push notifications UI exists but not implemented | `NotificationsForm.tsx` | HIGH | Note only |
| FUNC-002 | Email sending placeholder (no actual emails) | `service.ts:430-445` | MEDIUM | Note only |

**Phase 2 Total Effort:** ~2.5 hours (excluding FUNC items which need product decision)

### Phase 3: Test Coverage (P1) - 9 Issues

| ID | Issue | Location | Tests Needed | Effort |
|----|-------|----------|--------------|--------|
| TEST-001 | Repository tests missing | `NotificationRepository.ts` | 27 | 4 hours |
| TEST-002 | Controller validation tests | `notifications.controller.ts` | 8 | 1.5 hours |
| TEST-003 | Service trigger tests | `service.ts` | 22 | 3 hours |
| TEST-004 | Email/quiet hours tests | `service.ts` | 9 | 1.5 hours |
| TEST-005 | Authorization boundary tests | All layers | 5 | 1 hour |
| TEST-006 | Integration tests | End-to-end | 5 | 2 hours |
| TEST-007 | Client hook tests | `useNotifications.ts` | 19 | 3 hours |
| TEST-008 | Component tests | `NotificationBell.tsx` | 27 | 4 hours |
| TEST-009 | Investment notification tests | `investment-notifications.ts` | 3 | 45 min |

**Phase 3 Total Effort:** ~20 hours (125 test cases)

### Phase 4: UX Improvements (P2) - 8 Issues

| ID | Issue | Location | Severity | Effort |
|----|-------|----------|----------|--------|
| UX-001 | No error state UI for fetch failures | `NotificationBell.tsx` | HIGH | 1 hour |
| UX-002 | No optimistic updates for mark-as-read | `NotificationBell.tsx` | MEDIUM | 1.5 hours |
| UX-003 | No screen reader announcements | `NotificationBell.tsx` | MEDIUM | 1 hour |
| UX-004 | Loading spinner lacks sr-only label | `NotificationBell.tsx` | LOW | 15 min |
| UX-005 | Focus doesn't return on click-outside | `NotificationBell.tsx` | LOW | 30 min |
| UX-006 | Hardcoded badge colors | `NotificationBell.tsx` | LOW | 20 min |
| UX-007 | Fixed dropdown width overflow risk | `NotificationBell.tsx` | LOW | 30 min |
| UX-008 | No loading indicator for mark-as-read | `NotificationBell.tsx` | MEDIUM | 30 min |

**Phase 4 Total Effort:** ~5.5 hours

### Phase 5: Privacy & Data (P2) - 5 Issues

| ID | Issue | Location | Severity | Effort |
|----|-------|----------|----------|--------|
| PII-001 | IP addresses stored in notification metadata | `service.ts` | MEDIUM | 1 hour |
| PII-002 | Device names in notification content | `service.ts` | LOW | 30 min |
| DATA-001 | No automated retention policy | `NotificationRepository.ts` | MEDIUM | 2 hours |
| DATA-002 | Purge method exists but not scheduled | `NotificationRepository.ts:purgeOld` | MEDIUM | 1 hour |
| DATA-003 | No notification archival strategy | Repository | LOW | 2 hours |

**Phase 5 Total Effort:** ~6.5 hours

---

## Total Issue Count: 35

| Phase | Issues | Priority | Effort |
|-------|--------|----------|--------|
| Phase 1: Security & Compliance | 5 | P0 | 2 hours |
| Phase 2: Error Handling & Types | 8 | P1 | 2.5 hours |
| Phase 3: Test Coverage | 9 | P1 | 20 hours |
| Phase 4: UX Improvements | 8 | P2 | 5.5 hours |
| Phase 5: Privacy & Data | 5 | P2 | 6.5 hours |
| **TOTAL** | **35** | | **36.5 hours** |

---

## Implementation Details

### Phase 1: Security & Compliance

#### RATE-001 & RATE-002: Add Rate Limiting

**File:** `server/modules/notifications/notifications.routes.ts`

```typescript
// BEFORE
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import * as controller from "./notifications.controller";

const router = Router();
router.use(requireAuth);

// AFTER
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { generalLimiter } from "../../middleware/rateLimit";
import * as controller from "./notifications.controller";

const router = Router();
router.use(requireAuth);
router.use(generalLimiter);  // ADD THIS LINE
```

**File:** `server/routes/investment-notifications.ts`

```typescript
// ADD at top
import { generalLimiter } from "../middleware/rateLimit";

// ADD after requireAuth
router.use(generalLimiter);
```

#### AUDIT-001, AUDIT-002, AUDIT-003: Add Audit Logging

**File:** `server/modules/notifications/notifications.controller.ts`

```typescript
import { businessAuditService } from "../../core/audit";

// In markAsRead (after success):
await businessAuditService.log({
  householdId: req.user!.householdId,
  userId: req.user!.id,
  action: "UPDATE",
  entityType: "notification",
  entityId: result.id,
  details: { action: "mark_as_read" },
  ipAddress: businessAuditService.getIpAddress(req),
});

// In markAllAsRead (after success):
await businessAuditService.log({
  householdId: req.user!.householdId,
  userId: req.user!.id,
  action: "UPDATE",
  entityType: "notification",
  entityId: "bulk",
  details: { action: "mark_all_as_read", count: result.count },
  ipAddress: businessAuditService.getIpAddress(req),
});

// In archive (after success):
await businessAuditService.log({
  householdId: req.user!.householdId,
  userId: req.user!.id,
  action: "DELETE",
  entityType: "notification",
  entityId: req.params.id,
  details: { action: "archive" },
  ipAddress: businessAuditService.getIpAddress(req),
});
```

### Phase 2: Error Handling & Type Safety

#### ERR-001 & ERR-002: Fix NotFoundError Pattern

**File:** `server/modules/notifications/notifications.controller.ts`

```typescript
import { NotFoundError } from "../../core/errors";

// BEFORE (line 80-84)
if (!result) {
  res.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: "Notification not found" },
  });
  return;
}

// AFTER
if (!result) {
  throw new NotFoundError("Notification not found");
}
```

#### TYPE-001: Fix Type Duplication

**File:** `client/src/hooks/useNotifications.ts`

```typescript
// BEFORE (lines 6-19)
interface Notification {
  id: string;
  type: string;
  // ... duplicated type
}

// AFTER
import type { Notification } from "@shared/schema";
// Or create shared/types/notification.ts if needed
```

#### MONEY-001: Fix Money.toNumber() Pattern

**File:** `server/services/notification/service.ts:179`

```typescript
// BEFORE
const threshold = new Money(preferences.largeTransactionThreshold).toNumber();
if (amount >= threshold) { ... }

// AFTER
const threshold = new Money(preferences.largeTransactionThreshold);
const amountMoney = new Money(amount);
if (amountMoney.greaterThanOrEqual(threshold)) { ... }
```

### Phase 3: Test Coverage

#### TEST-001: Repository Tests

**Create:** `server/repositories/__tests__/NotificationRepository.test.ts`

```typescript
import { NotificationRepository } from "../NotificationRepository";
import { db } from "../../storage";

describe("NotificationRepository", () => {
  let repo: NotificationRepository;

  beforeEach(() => {
    repo = new NotificationRepository();
  });

  describe("create", () => {
    it("should create notification with all fields", async () => { });
    it("should generate UUID if not provided", async () => { });
    it("should set createdAt to now", async () => { });
  });

  describe("findByUserId", () => {
    it("should return only user's notifications", async () => { });
    it("should filter by unread only", async () => { });
    it("should filter by archived", async () => { });
    it("should paginate correctly", async () => { });
    it("should order by createdAt desc", async () => { });
  });

  describe("markAsRead", () => {
    it("should set readAt timestamp", async () => { });
    it("should not modify other user's notifications", async () => { });
    it("should return null for non-existent id", async () => { });
  });

  describe("markAllAsRead", () => {
    it("should mark all unread as read", async () => { });
    it("should return count of updated", async () => { });
    it("should not affect other users", async () => { });
  });

  describe("archive", () => {
    it("should set archivedAt timestamp", async () => { });
    it("should not archive other user's notifications", async () => { });
  });

  describe("getUnreadCount", () => {
    it("should count only unread notifications", async () => { });
    it("should not count archived", async () => { });
  });

  describe("findDuplicate", () => {
    it("should find by dedupeKey within window", async () => { });
    it("should not find outside window", async () => { });
  });

  describe("purgeOld", () => {
    it("should delete notifications older than days", async () => { });
    it("should not delete recent notifications", async () => { });
  });

  // ... 27 total test cases
});
```

#### TEST-007: Client Hook Tests

**Create:** `client/src/hooks/__tests__/useNotifications.test.ts`

```typescript
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useNotifications, useUnreadCount, useMarkAsRead } from "../useNotifications";

describe("useNotifications", () => {
  describe("useNotifications hook", () => {
    it("should fetch notifications on mount", async () => { });
    it("should handle loading state", async () => { });
    it("should handle error state", async () => { });
    it("should filter unread only", async () => { });
  });

  describe("useUnreadCount hook", () => {
    it("should fetch unread count", async () => { });
    it("should refetch on interval", async () => { });
  });

  describe("useMarkAsRead mutation", () => {
    it("should mark notification as read", async () => { });
    it("should invalidate queries on success", async () => { });
  });

  describe("useMarkAllAsRead mutation", () => {
    it("should mark all as read", async () => { });
    it("should invalidate queries on success", async () => { });
  });

  describe("useArchiveNotification mutation", () => {
    it("should archive notification", async () => { });
    it("should invalidate queries on success", async () => { });
  });

  // ... 19 total test cases
});
```

#### TEST-008: Component Tests

**Create:** `client/src/components/__tests__/NotificationBell.test.tsx`

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationBell } from "../NotificationBell";

describe("NotificationBell", () => {
  describe("rendering", () => {
    it("should render bell icon", () => { });
    it("should show badge with unread count", () => { });
    it("should hide badge when count is 0", () => { });
  });

  describe("dropdown", () => {
    it("should open on click", async () => { });
    it("should close on escape", async () => { });
    it("should close on click outside", async () => { });
    it("should show empty state when no notifications", async () => { });
    it("should show loading skeleton", async () => { });
  });

  describe("keyboard navigation", () => {
    it("should focus first item on open", async () => { });
    it("should navigate with arrow keys", async () => { });
    it("should navigate with Home/End", async () => { });
  });

  describe("mark as read", () => {
    it("should call mutation on click", async () => { });
    it("should update UI optimistically", async () => { }); // After UX-002 fix
  });

  describe("accessibility", () => {
    it("should have aria-label with count", () => { });
    it("should announce changes to screen readers", () => { }); // After UX-003 fix
  });

  // ... 27 total test cases
});
```

### Phase 4: UX Improvements

#### UX-001: Add Error State UI

**File:** `client/src/components/NotificationBell.tsx`

```tsx
// Add error state handling
const { data, isLoading, isError, error } = useNotifications();

// In render:
{isError && (
  <div className="p-4 text-center">
    <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
    <p className="text-sm text-muted-foreground">
      Failed to load notifications
    </p>
    <Button variant="ghost" size="sm" onClick={() => refetch()}>
      Try again
    </Button>
  </div>
)}
```

#### UX-002: Add Optimistic Updates

**File:** `client/src/hooks/useNotifications.ts`

```typescript
export function useMarkAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.markAsRead(id),
    onMutate: async (id) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["notifications"] });

      // Snapshot previous value
      const previous = queryClient.getQueryData(["notifications"]);

      // Optimistically update
      queryClient.setQueryData(["notifications"], (old: Notification[]) =>
        old?.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
      );

      // Update unread count
      queryClient.setQueryData(["notifications", "unread-count"], (old: number) =>
        Math.max(0, (old || 0) - 1)
      );

      return { previous };
    },
    onError: (err, id, context) => {
      // Rollback on error
      queryClient.setQueryData(["notifications"], context?.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
```

#### UX-003: Add Screen Reader Announcements

**File:** `client/src/components/NotificationBell.tsx`

```tsx
import { useEffect, useRef } from "react";

// Add live region for announcements
const announcementRef = useRef<HTMLDivElement>(null);

const announce = (message: string) => {
  if (announcementRef.current) {
    announcementRef.current.textContent = message;
  }
};

// In markAsRead handler:
const handleMarkAsRead = async (id: string) => {
  await markAsRead.mutateAsync(id);
  announce("Notification marked as read");
};

// In render (at component root):
<div
  ref={announcementRef}
  role="status"
  aria-live="polite"
  className="sr-only"
/>
```

### Phase 5: Privacy & Data

#### DATA-001 & DATA-002: Automate Retention Policy

**Create:** `server/jobs/notificationPurge.ts`

```typescript
import { NotificationRepository } from "../repositories/NotificationRepository";
import { logger } from "../core/logger";

const RETENTION_DAYS = 180;

export async function purgeOldNotifications(): Promise<void> {
  const repo = new NotificationRepository();

  try {
    const count = await repo.purgeOld(RETENTION_DAYS);
    logger.info("Notification purge completed", { deletedCount: count });
  } catch (error) {
    logger.error("Notification purge failed", { error });
  }
}

// Schedule with node-cron or similar
// cron.schedule("0 3 * * *", purgeOldNotifications); // Daily at 3 AM
```

---

## Verification Checklist

### After Phase 1
```bash
# Verify rate limiters
grep -n "generalLimiter" server/modules/notifications/notifications.routes.ts
grep -n "generalLimiter" server/routes/investment-notifications.ts

# Verify audit logging
grep -n "businessAuditService" server/modules/notifications/notifications.controller.ts
# Should return 3+ lines
```

### After Phase 2
```bash
# Verify no manual 404 responses
grep -n "res.status(404)" server/modules/notifications/notifications.controller.ts
# Should return 0 matches

# Verify type imports
grep -n "from \"@shared" client/src/hooks/useNotifications.ts
```

### After Phase 3
```bash
# Run tests
npm run test:server:run -- --grep "NotificationRepository"
npm run test:run -- --grep "useNotifications"
npm run test:run -- --grep "NotificationBell"

# Check coverage
npm run test:server:coverage
```

### Full Verification
```bash
npm run check              # TypeScript must pass
npm run test:run           # Client tests must pass
npm run test:server:run    # Server tests must pass
```

---

## Success Criteria

### Phase 1 Complete When:
- [ ] All notification routes have `generalLimiter` applied
- [ ] Investment notification routes have `generalLimiter` applied
- [ ] `markAsRead` has audit logging
- [ ] `markAllAsRead` has audit logging
- [ ] `archive` has audit logging
- [ ] `npm run check` passes

### Phase 2 Complete When:
- [ ] Zero manual `res.status(404)` in controller
- [ ] Client imports types from shared, not duplicating
- [ ] Zero `any` types in notification hooks
- [ ] Money comparison uses Money methods, not toNumber()

### Phase 3 Complete When:
- [ ] Repository test file exists with 27+ tests
- [ ] Client hook test file exists with 19+ tests
- [ ] Component test file exists with 27+ tests
- [ ] All tests pass
- [ ] Coverage reaches 80% for notification module

### Phase 4 Complete When:
- [ ] Error state UI displays on fetch failure
- [ ] Mark-as-read uses optimistic updates
- [ ] Screen reader announcements work
- [ ] Loading states visible during operations

### Phase 5 Complete When:
- [ ] Retention job scheduled
- [ ] PII minimized in notification content
- [ ] Documentation updated

---

## Dependencies

| Phase | Depends On |
|-------|------------|
| Phase 1 | None (start immediately) |
| Phase 2 | Phase 1 |
| Phase 3 | Phase 2 (types must be fixed first) |
| Phase 4 | Phase 3 (tests should cover new behavior) |
| Phase 5 | Phase 1 (audit logging needed for compliance) |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Rate limiting breaks polling | Low | High | Test with 30s interval before deploy |
| Audit logging adds latency | Low | Low | Async logging, non-blocking |
| Type changes break client | Medium | Medium | Run full test suite |
| Optimistic updates cause UI flicker | Medium | Low | Test thoroughly, add rollback |

---

## Timeline Estimate

| Phase | Effort | Calendar Time |
|-------|--------|---------------|
| Phase 1 | 2 hours | Day 1 |
| Phase 2 | 2.5 hours | Day 1 |
| Phase 3 | 20 hours | Days 2-4 |
| Phase 4 | 5.5 hours | Day 5 |
| Phase 5 | 6.5 hours | Day 5-6 |
| **Total** | **36.5 hours** | **~6 days** |

---

## References

- [Notifications Module Assessment](../../../reviews/notifications/notifications-module-assessment.md)
- [Senior Developer Review](../../../reviews/notifications/notifications-senior-dev-review.md)
- [QA Engineer Review](../../../reviews/notifications/notifications-qa-review.md)
- [Fintech Compliance Review](../../../reviews/notifications/notifications-fintech-review.md)
- [Functionality Review](../../../reviews/notifications/notifications-functionality-review.md)
- [UI/UX Review](../../../reviews/notifications/notifications-ux-review.md)

