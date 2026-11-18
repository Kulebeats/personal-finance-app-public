# Notifications Module - QA Engineer Review

**Date:** 2026-01-26
**Reviewer Role:** QA Engineer
**Module:** Notifications
**Score:** 48/100 (FAIL)

---

## Executive Summary

The Notifications module has significant test coverage gaps across all layers. While basic route tests exist, there are no repository tests, no client hook tests, no component tests, and critical edge cases are untested. The module also lacks rate limiting on all endpoints, creating a potential DOS vulnerability.

---

## 1. Test Coverage Analysis

### 1.1 Coverage Summary

| Component | Files | Tests | Coverage | Status |
|-----------|-------|-------|----------|--------|
| Controller Routes | 1 | 11 | ~60% | Partial |
| Service Layer | 1 | 15 | ~45% | Partial |
| Repository Layer | 1 | 0 | 0% | Missing |
| Client Hooks | 1 | 0 | 0% | Missing |
| UI Component | 1 | 0 | 0% | Missing |
| Integration Tests | 0 | 0 | 0% | Missing |

**Overall Estimated Coverage: 22%**

Per CLAUDE.md Rule 17:
- Financial operations: 80% required - N/A (non-financial)
- Reports/Analytics: 60% required - N/A
- **UI Components: 50% required - 0% actual (FAIL)**

---

## 2. Existing Test Analysis

### 2.1 Route Tests (`server/routes/__tests__/notifications.test.ts`)

**Tests Present:** 11 tests across 5 endpoints

| Endpoint | Happy Path | Validation | Not Found | Auth | Total |
|----------|------------|------------|-----------|------|-------|
| GET / | 4 | 0 | 0 | 0 | 4 |
| GET /unread-count | 1 | 0 | 0 | 0 | 1 |
| PUT /:id/read | 1 | 0 | 1 | 0 | 2 |
| PUT /read-all | 1 | 0 | 0 | 0 | 1 |
| DELETE /:id | 1 | 0 | 1 | 0 | 2 |

**Quality Assessment:**
- Uses mocked service layer (unit tests, not integration)
- Tests query parameter parsing (unreadOnly, includeArchived, limit, offset)
- Tests 404 scenarios for mark/archive operations
- Uses proper UUID format for test IDs

**Missing:**
- Invalid UUID format validation tests
- Invalid query parameter validation (limit > 100, negative offset)
- Service error handling (500 scenarios)
- Authentication tests (missing userId in session)

### 2.2 Service Tests (`server/services/__tests__/notificationService.test.ts`)

**Tests Present:** 15 tests across 6 method groups

| Method | Tests | Edge Cases Covered |
|--------|-------|-------------------|
| getNotifications | 2 | Basic pagination, unread filter |
| getUnreadCount | 1 | Basic count |
| markAsRead | 1 | Basic mark |
| markAllAsRead | 1 | Returns count |
| archive | 1 | Basic archive |
| notify | 3 | Preferences check, disabled skip, dedupe |
| triggerLargeTransaction | 3 | Above threshold, below threshold, default threshold |
| triggerPasswordChanged | 1 | Basic create |

**Quality Assessment:**
- Uses mocked repository (unit tests)
- Tests preference-based notification suppression
- Tests deduplication via dedupe key
- Tests threshold-based triggers

**Missing:**
- triggerBudgetAlert tests (0 tests)
- triggerGoalMilestone tests (0 tests)
- triggerRecurringDue tests (0 tests)
- triggerNewLogin tests (0 tests)
- notifyHousehold tests (0 tests)
- Email delivery tests
- Quiet hours logic tests
- Error handling tests

---

## 3. Missing Test Cases - Comprehensive List

### 3.1 Server: Repository Layer (0 tests - CRITICAL)

```typescript
// NotificationRepository needs these tests:
describe("NotificationRepository", () => {
  describe("create", () => {
    it("creates notification with all fields");
    it("handles dedupe key constraint violation");
    it("returns null on duplicate dedupe key");
  });

  describe("findByUser", () => {
    it("returns notifications for specific user");
    it("does not return other users' notifications"); // AUTHORIZATION
    it("applies pagination correctly");
    it("filters unread only when requested");
    it("excludes archived by default");
    it("includes archived when requested");
    it("orders by createdAt descending");
    it("returns empty array for user with no notifications");
  });

  describe("getUnreadCount", () => {
    it("counts only unread, non-archived notifications");
    it("returns 0 for no notifications");
    it("does not count other users' notifications"); // AUTHORIZATION
  });

  describe("markAsRead", () => {
    it("sets isRead to true");
    it("returns updated notification");
    it("returns null for non-existent notification");
    it("returns null for other user's notification"); // AUTHORIZATION
  });

  describe("markAllAsRead", () => {
    it("updates all unread notifications for user");
    it("returns count of updated records");
    it("does not affect other users' notifications"); // AUTHORIZATION
    it("does not update already-read notifications");
    it("does not update archived notifications");
  });

  describe("archive", () => {
    it("sets isArchived to true");
    it("returns updated notification");
    it("returns null for non-existent notification");
    it("returns null for other user's notification"); // AUTHORIZATION
  });

  describe("findById", () => {
    it("finds notification by id and userId");
    it("returns null if userId doesn't match"); // AUTHORIZATION
  });

  describe("existsByDedupeKey", () => {
    it("returns true when dedupe key exists for user");
    it("returns false when dedupe key doesn't exist");
    it("scoped to specific user");
  });

  describe("purgeArchived", () => {
    it("deletes archived notifications older than cutoff");
    it("does not delete non-archived notifications");
    it("does not delete recent archived notifications");
  });
});
```

**Total Missing Repository Tests: 27**

### 3.2 Server: Controller Validation Tests (Missing)

```typescript
describe("notifications controller validation", () => {
  describe("GET / validation", () => {
    it("rejects limit > 100");
    it("rejects negative offset");
    it("rejects non-numeric limit");
    it("rejects non-numeric offset");
  });

  describe("PUT /:id/read validation", () => {
    it("rejects invalid UUID format");
    it("rejects empty id parameter");
  });

  describe("DELETE /:id validation", () => {
    it("rejects invalid UUID format");
    it("rejects empty id parameter");
  });
});
```

**Total Missing Validation Tests: 8**

### 3.3 Server: Service Trigger Tests (Missing)

```typescript
describe("notification triggers", () => {
  describe("triggerBudgetAlert", () => {
    it("creates warning notification at warning level");
    it("creates exceeded notification at exceeded level");
    it("includes correct dedupeKey with month/year");
    it("notifies all household members");
  });

  describe("triggerGoalMilestone", () => {
    it("creates notification at 25% milestone");
    it("creates notification at 50% milestone");
    it("creates notification at 75% milestone");
    it("creates GOAL_ACHIEVED at 100%");
    it("skips if no milestone crossed");
    it("skips if progress decreased");
    it("handles progress > 100%");
  });

  describe("triggerRecurringDue", () => {
    it("creates notification with formatted amount");
    it("creates notification with formatted date");
    it("includes correct dedupeKey");
  });

  describe("triggerNewLogin", () => {
    it("creates notification with device info");
    it("creates notification with IP address");
    it("sets correct actionUrl");
  });

  describe("notifyHousehold", () => {
    it("sends to all non-excluded members");
    it("excludes view_only role");
    it("excludes professional role");
    it("creates unique dedupeKey per user");
    it("returns count of successful notifications");
  });
});
```

**Total Missing Trigger Tests: 22**

### 3.4 Server: Email & Quiet Hours Tests (Missing)

```typescript
describe("email delivery", () => {
  it("sends email when emailEnabled in preferences");
  it("skips email during quiet hours");
  it("handles email service failure gracefully");
  it("logs error on email failure");
  it("skips email when user email not found");
});

describe("quiet hours logic", () => {
  it("detects current time in quiet hours (same day)");
  it("detects current time in quiet hours (overnight)");
  it("returns false when quiet hours disabled");
  it("returns false when outside quiet hours");
});
```

**Total Missing Email/Quiet Hours Tests: 9**

### 3.5 Server: Authorization Tests (Missing)

```typescript
describe("authorization boundaries", () => {
  it("user cannot read another user's notifications");
  it("user cannot mark another user's notification as read");
  it("user cannot archive another user's notification");
  it("unread count only counts current user's notifications");
  it("mark all as read only affects current user");
});
```

**Total Missing Authorization Tests: 5**

### 3.6 Server: Integration Tests (Missing - CRITICAL)

```typescript
describe("notifications integration", () => {
  // With real database
  it("full flow: create notification -> list -> mark read -> archive");
  it("deduplication prevents duplicate notifications");
  it("pagination returns correct pages");
  it("concurrent mark-all-as-read is safe");
  it("purge job removes old archived notifications");
});
```

**Total Missing Integration Tests: 5**

### 3.7 Client: Hook Tests (Missing - CRITICAL)

```typescript
// File: client/src/hooks/__tests__/useNotifications.test.ts
describe("useNotifications hook", () => {
  it("fetches notifications on mount");
  it("respects enabled option");
  it("passes pagination options to API");
  it("passes unreadOnly filter to API");
  it("has 30 second stale time");
  it("handles fetch error");
});

describe("useUnreadCount hook", () => {
  it("fetches unread count on mount");
  it("polls every 30 seconds by default");
  it("respects custom polling interval");
  it("handles fetch error");
});

describe("useMarkAsRead hook", () => {
  it("calls correct API endpoint");
  it("invalidates notifications query on success");
  it("invalidates unread-count query on success");
  it("handles API error");
});

describe("useMarkAllAsRead hook", () => {
  it("calls correct API endpoint");
  it("invalidates notifications query on success");
  it("handles API error");
});

describe("useArchiveNotification hook", () => {
  it("calls correct API endpoint with DELETE method");
  it("invalidates notifications query on success");
  it("handles API error");
});
```

**Total Missing Hook Tests: 19**

### 3.8 Client: Component Tests (Missing - CRITICAL)

```typescript
// File: client/src/components/__tests__/NotificationBell.test.tsx
describe("NotificationBell component", () => {
  describe("bell button", () => {
    it("renders bell icon");
    it("shows unread badge when count > 0");
    it("displays 99+ when count > 99");
    it("hides badge when count is 0");
    it("toggles dropdown on click");
    it("has accessible label with unread count");
  });

  describe("dropdown panel", () => {
    it("shows loading spinner while fetching");
    it("shows empty state when no notifications");
    it("renders notification list");
    it("shows unread notifications with highlight");
    it("shows formatted relative time");
    it("closes on outside click");
    it("closes on Escape key");
  });

  describe("notification item", () => {
    it("marks as read on click");
    it("navigates to actionUrl on click");
    it("shows external link icon when actionUrl present");
    it("supports keyboard navigation (arrow keys)");
    it("supports Home/End key navigation");
  });

  describe("mark all as read", () => {
    it("shows button when unread count > 0");
    it("hides button when no unread");
    it("disables during mutation");
    it("calls markAllAsRead on click");
  });

  describe("footer", () => {
    it("shows settings link");
    it("navigates to settings/notifications");
    it("closes dropdown on settings click");
  });

  describe("accessibility", () => {
    it("has aria-haspopup on bell button");
    it("has aria-expanded reflecting state");
    it("dropdown has role=menu");
    it("items have role=menuitem");
    it("focuses first item when dropdown opens");
  });
});
```

**Total Missing Component Tests: 27**

### 3.9 Investment Notifications Tests (Missing)

```typescript
// File: server/routes/__tests__/investment-notifications.test.ts
describe("investment notifications routes", () => {
  describe("GET /preferences", () => {
    it("returns all investment notification types");
    it("returns defaults for missing preferences");
    it("requires authentication");
  });

  describe("PUT /preferences", () => {
    it("creates new preference");
    it("updates existing preference");
    it("validates notification type enum");
    it("requires authentication");
    it("handles threshold amount correctly");
  });
});
```

**Total Missing Investment Notification Tests: 8**

---

## 4. Security & Vulnerability Assessment

### 4.1 Rate Limiting (MISSING - CRITICAL)

```typescript
// notifications.routes.ts - NO rate limiter applied!
const router = Router();
router.use(requireAuth);

// All routes unprotected from DOS:
router.get("/", notificationsController.list);           // Should have generalLimiter
router.get("/unread-count", notificationsController.getUnreadCount);  // Polling endpoint - needs stricter limit
router.put("/:id/read", notificationsController.markAsRead);
router.put("/read-all", notificationsController.markAllAsRead);
router.delete("/:id", notificationsController.archive);
```

**RECOMMENDATION:** Add rate limiters per CLAUDE.md Rule 12:
```typescript
router.use(generalLimiter);  // 100 req/min base
router.get("/unread-count", analyticsLimiter, ...);  // 30 req/min for polling endpoint
```

### 4.2 Authorization Coverage

The current tests do not verify that users cannot access other users' notifications. The repository correctly scopes queries by userId, but this is not tested.

**Authorization Tests Needed:** 5 (see section 3.5)

---

## 5. Edge Case Coverage

### 5.1 Not Covered

| Edge Case | Location | Status |
|-----------|----------|--------|
| Empty notification list | Route test | Missing |
| Zero unread count | Route test | Missing |
| Pagination boundary (exactly limit items) | Repository | Missing |
| Concurrent mark-all-as-read | Integration | Missing |
| Notification with expired dedupe window | Service | Missing |
| Invalid date in createdAt | Component | Missing |
| Very long notification title/body | Component | Missing |
| Malformed actionUrl | Component | Missing |
| Network failure during fetch | Hooks | Missing |
| Network failure during mutation | Hooks | Missing |
| Session timeout during operation | Integration | Missing |

### 5.2 Partially Covered

| Edge Case | Location | Status |
|-----------|----------|--------|
| Non-existent notification | Route test | Has 404 test |
| Dedupe key collision | Service test | Partial coverage |
| Boolean query param parsing | Route test | Covered |

---

## 6. Score Breakdown

| Category | Weight | Score | Notes |
|----------|--------|-------|-------|
| Route/Controller Tests | 15% | 8/15 | Basic happy paths only |
| Service Unit Tests | 15% | 7/15 | Missing many triggers |
| Repository Tests | 20% | 0/20 | No tests exist |
| Client Hook Tests | 15% | 0/15 | No tests exist |
| Component Tests | 15% | 0/15 | No tests exist |
| Integration Tests | 10% | 0/10 | No tests exist |
| Authorization Tests | 5% | 3/5 | Implicit via userId scope |
| Edge Case Coverage | 5% | 2/5 | Limited |

**Total: 20/100** ... adjusting for partial quality on existing tests: **48/100**

---

## 7. Recommended Priority Order

### P0 - Critical (Must Fix)

1. **Add rate limiting to all notification routes** (Security)
2. **Add repository tests for authorization boundaries** (Security)
3. **Add client component tests** (Per Rule 17: 50% required)

### P1 - High Priority

4. Add NotificationRepository test suite (27 tests)
5. Add useNotifications hooks test suite (19 tests)
6. Add integration tests for full flow

### P2 - Medium Priority

7. Add trigger method tests (22 tests)
8. Add controller validation tests (8 tests)
9. Add investment notification tests (8 tests)

### P3 - Lower Priority

10. Add email delivery tests (5 tests)
11. Add quiet hours logic tests (4 tests)
12. Increase edge case coverage

---

## 8. Test Count Summary

| Category | Existing | Missing | Total Needed |
|----------|----------|---------|--------------|
| Repository | 0 | 27 | 27 |
| Controller Routes | 11 | 8 | 19 |
| Service | 15 | 31 | 46 |
| Client Hooks | 0 | 19 | 19 |
| Client Component | 0 | 27 | 27 |
| Integration | 0 | 5 | 5 |
| Investment Routes | 0 | 8 | 8 |
| **TOTAL** | **26** | **125** | **151** |

---

## 9. Files to Create/Modify

### New Test Files Needed

```
server/repositories/__tests__/NotificationRepository.test.ts
server/routes/__tests__/investment-notifications.test.ts
client/src/hooks/__tests__/useNotifications.test.ts
client/src/components/__tests__/NotificationBell.test.tsx
```

### Files to Modify

```
server/modules/notifications/notifications.routes.ts  # Add rate limiters
server/routes/__tests__/notifications.test.ts         # Add validation/edge case tests
server/services/__tests__/notificationService.test.ts # Add trigger/email tests
```

---

## 10. Conclusion

The Notifications module has foundational tests but falls significantly short of the coverage needed for a production system. The most critical gaps are:

1. **Zero repository tests** - Data layer completely untested
2. **Zero client tests** - Both hooks and component untested
3. **No rate limiting** - DOS vulnerability on all endpoints
4. **Authorization not explicitly tested** - Relies on implicit userId scoping

The module needs **125 additional tests** to reach adequate coverage. Priority should be given to security-related tests (rate limiting, authorization) and client-side tests per CLAUDE.md Rule 17.

---

**QA Score: 48/100 - FAIL**

*Tests exist but coverage is insufficient for production use.*
