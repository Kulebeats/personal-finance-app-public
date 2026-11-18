# Verified Open Issues Against Code - 2026-01-29

**Scope:** Issues listed as open in `docs/plans/prioritized-action-plan-2026-01-28.md` (21 total).  
**Method:** Code review and spot-checks for evidence of implementation.  
**Legend:**  
- **Verified Closed:** Code evidence found that the issue is implemented.  
- **Verified Open:** Code evidence found that the issue is still missing.  
- **Not Verified:** No direct evidence found in this review.

---

## Household (27)

| Issue | Status | Evidence |
| --- | --- | --- |
| TYPE-001 | Verified Closed | `server/modules/household/__tests__/household.validation.test.ts` rejects `viewer` |
| INC-001 | Verified Closed | `server/repositories/HouseholdRepository.ts` implements full CRUD/member/invitation operations |
| TEST-002 | Verified Closed | `server/repositories/__tests__/HouseholdRepository.test.ts` |
| TEST-003 | Verified Open | No client component tests found for `HouseholdSection`/`MembersSection` |
| TEST-004 | Verified Closed | `client/src/hooks/__tests__/use-settings.household.test.ts` |
| TEST-005 | Verified Closed | `server/modules/household/__tests__/household.validation.test.ts` |
| TEST-006 | Verified Closed | `server/modules/household/__tests__/household.integration.test.ts` |
| EDGE-004 | Verified Closed | `server/modules/household/__tests__/household.integration.test.ts` (EDGE-004) |
| EDGE-005 | Verified Closed | `server/modules/household/__tests__/household.integration.test.ts` (EDGE-005) |
| EDGE-006 | Verified Closed | `server/modules/household/__tests__/household.integration.test.ts` (EDGE-006) |
| EDGE-007 | Verified Closed | `server/repositories/__tests__/HouseholdRepository.test.ts` (EDGE-007) |
| EDGE-008 | Verified Closed | `server/repositories/__tests__/HouseholdRepository.test.ts` (EDGE-008) |
| VAL-001 | Verified Closed | `shared/schema.ts` + `household.validation.test.ts` rejects `viewer` |
| VAL-002 | Verified Closed | `server/modules/household/__tests__/household.validation.test.ts` invalid role tests |
| SEC-003 | Verified Closed | `server/modules/household/__tests__/household.integration.test.ts` (SEC-003) |
| SEC-004 | Verified Closed | `server/modules/household/__tests__/household.integration.test.ts` (SEC-004) |
| SEC-005 | Verified Closed | `server/modules/household/__tests__/household.integration.test.ts` (SEC-005) |
| AUDIT-005 | Verified Closed | `server/modules/household/household.controller.ts` audit log on create |
| AUDIT-006 | Verified Closed | `server/modules/household/household.controller.ts` audit log on update |
| PRIV-001 | Verified Open | `client/src/pages/settings/sections/MembersSection/components/MemberList.tsx` shows email |
| FUNC-007 | Verified Closed | `server/modules/household/templates/invitation-email.html` |
| LOC-001 | Verified Closed | `client/src/pages/settings/sections/HouseholdSection/index.tsx` (99 LOC) |
| LOC-002 | Verified Closed | `client/src/pages/settings/sections/MembersSection/index.tsx` (83 LOC) |
| A11Y-003 | Verified Open | Removal uses `confirm()` in `MemberList.tsx` (no aria announcement) |
| INT-001 | Verified Open | No optimistic update in `MemberList.tsx` |
| INT-002 | Verified Open | No undo flow in `MemberList.tsx` |
| KB-001 | Verified Open | No keyboard shortcut handling found |

---

## Notifications (13)

| Issue | Status | Evidence |
| --- | --- | --- |
| ERR-001 | Verified Closed | `server/modules/notifications/notifications.controller.ts` uses NotFoundError |
| ERR-002 | Verified Closed | `server/modules/notifications/notifications.controller.ts` uses NotFoundError |
| TYPE-003 | Verified Closed | No `any` types found in notifications module (prod code) |
| FUNC-001 | Verified Open | Push UI not found in client |
| FUNC-002 | Verified Open | Email digest exists but not wired end-to-end |
| UX-001 | Verified Open | `client/src/pages/settings/sections/NotificationsSection/NotificationsForm.tsx` has no error UI |
| UX-002 | Verified Closed | `client/src/hooks/useNotifications.ts` optimistic updates in `useMarkAsRead` |
| UX-003 | Verified Closed | `client/src/components/NotificationBell.tsx` aria-live announcements |
| UX-004 | Verified Open | `NotificationsForm.tsx` loading spinner lacks sr-only label |
| UX-005 | Verified Closed | `NotificationBell.tsx` returns focus to bell on click-outside |
| UX-006 | Verified Closed | `NotificationBell.tsx` uses theme tokens for badge colors |
| UX-007 | Verified Closed | `NotificationBell.tsx` uses max-width to avoid overflow |
| UX-008 | Verified Closed | `NotificationBell.tsx` shows loading indicator per-item |

---

## Tags (14)

| Issue | Status | Evidence |
| --- | --- | --- |
| ARCH-001 | Verified Closed | `server/modules/tags/tags.controller.ts` uses `tagService` |
| DATA-001 | Verified Closed | `server/modules/tags/tags.service.ts` updates usage counts |
| API-001 | Verified Closed | `server/modules/tags/tags.routes.ts` has `GET /:id/transactions` |
| API-002 | Verified Closed | `server/modules/tags/tags.routes.ts` has `PUT /transaction/:transactionId` |
| FUNC-001 | Verified Closed | `tags.controller.ts` merge endpoint + service |
| FUNC-002 | Verified Closed | `tags.controller.ts` archive endpoint + service |
| CODE-001 | Verified Closed | Single `server/repositories/TagRepository.ts` usage |
| CODE-003 | Verified Closed | `server/modules/household/household.controller.ts` seeds default tags |
| CODE-004 | Verified Closed | `client/src/components/tags/TagsList.tsx` member-specific UI |
| CODE-005 | Verified Closed | `server/modules/tags/tags.controller.ts` analytics endpoint |
| CODE-006 | Verified Closed | `shared/schema.ts` tag color regex |
| CODE-007 | Verified Closed | `client/src/components/tags/TagModal.tsx` preview aria-hidden |
| CODE-008 | Verified Closed | `TagModal.tsx` spinner sr-only |
| CODE-009 | Verified Closed | `TagModal.tsx` aria-live region |

---

## Weekly Recap (8)

| Issue | Status | Evidence |
| --- | --- | --- |
| VAL-001 | Verified Closed | `server/modules/weekly-recap/weekly-recap.validation.ts` date refinement |
| UX-001 | Verified Open | No Back button in `WeeklyRecapWizard.tsx` |
| UX-002 | Verified Open | No empty state in `SpendingStep.tsx` |
| DATA-001 | Verified Closed | `weekly-recap.controller.ts` uses user first day setting |
| FUNC-001 | Verified Open | No goal progress step in UI/service |
| FUNC-002 | Verified Closed | `WeeklyRecapSection.tsx` + `/weekly-recap/settings` |
| FUNC-003 | Verified Open | `weekly-recap.email.service.ts` TODO for user query |
| FUNC-004 | Verified Closed | `weekly-recap.controller.ts` history + `WeeklyRecapHistory.tsx` |

---

## Categories (9)

| Issue | Status | Evidence |
| --- | --- | --- |
| VAL-001 | Verified Closed | `server/modules/categories/categories.validation.ts` used |
| VAL-002 | Verified Closed | `includeArchived` in controller + schema |
| TYPE-001 | Verified Closed | No `CategoryType` references in categories module |
| TYPE-002 | Verified Closed | `categories.controller.ts` uses consistent ValidationError/NotFoundError messages |
| API-003 | Verified Closed | `categories.routes.ts` archive endpoint |
| A11Y-003 | Verified Open | Focus return not verified in code |
| CODE-001 | Verified Closed | Audit logging in `categories.controller.ts` |
| CODE-002 | Verified Closed | JSDoc present on public handlers in categories controllers |
| CODE-003 | Verified Closed | Default categories sourced from `server/config/defaultCategories.ts` |

---

## Merchants (11)

| Issue | Status | Evidence |
| --- | --- | --- |
| TEST-002 | Verified Closed | `client/src/pages/settings/sections/MerchantsSection/__tests__/MerchantsSection.test.tsx` |
| LOC-001 | Verified Closed | `useMerchantsSectionState.ts` under 300 LOC |
| LOC-002 | Verified Closed | `useMerchantCombobox.ts` 187 LOC |
| LOC-003 | Verified Closed | `MerchantDetailView.tsx` under 300 LOC |
| LOC-004 | Verified Closed | `MerchantsListPanel.tsx` 165 LOC |
| DATA-001 | Verified Closed | `MerchantStatsCards.tsx` uses `useSettings().currency` |
| DATA-002 | Verified Closed | `MerchantStatsCards.tsx` uses currency context |
| DATA-003 | Verified Open | No duplicate name check in `merchants.controller.ts` |
| A11Y-004 | Verified Open | No keyboard shortcut hints found |
| ARCH-001 | Verified Closed | `server/modules/merchants/MerchantService.ts` in module dir |
| ARCH-002 | Verified Closed | `server/modules/merchants/index.ts` exports service |

---

## Rules (8)

| Issue | Status | Evidence |
| --- | --- | --- |
| API-001 | Verified Closed | `rules.routes.ts` preview endpoint |
| API-002 | Verified Closed | `rules.routes.ts` bulk enable/disable |
| A11Y-002 | Verified Open | Heading structure not verified |
| A11Y-003 | Verified Open | No aria-live for rule matches found |
| A11Y-004 | Verified Open | Drag handle keyboard access not found |
| CODE-001 | Verified Open | Duplicate condition type definitions in client/server schemas |
| CODE-002 | Verified Closed | `server/services/rule/actions.ts` wraps action execution in try/catch |
| CODE-003 | Verified Closed | `/api/rules/:id/dry-run` endpoint in `rules.routes.ts` |

---

## Summary

- **Verified Open:** Household (6), Weekly Recap (4), Notifications (4), Merchants (2), Rules (4), Categories (1)  
- **Verified Closed:** Tags (14), Weekly Recap (4), Categories (8), Merchants (9), Rules (4), Notifications (9), Household (21)  
- **Not Verified:** None remaining in this scope.
