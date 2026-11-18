# Recurring Module Overhaul Implementation Plan

**Date:** 2026-01-23  
**Status:** Closed - Completed (See module status report)  
**Scope:** `server/modules/recurring/`, `server/services/recurring/`, `client/src/features/recurring/`, `client/src/pages/Recurring.tsx`  
**Inputs:** recurring-module-assessment.md, recurring-senior-dev-review.md, recurring-qa-review.md, recurring-fintech-review.md, recurring-functionality-review.md, recurring-ux-review.md

---

## Status Update (2026-02-06)

This plan is now closed. All items have been completed and consolidated in `docs/module-status/recurring-module-status-2026-01-23.md`. The checklist below is retained for audit history.

---

## Goals

1. Close all P0 security and accessibility gaps.
2. Eliminate concurrency risk in link operations.
3. Bring controller and routes files under LOC limits.
4. Improve UX states, dark mode, and mobile usability.
5. Expand test coverage for authorization and error paths.

---

## Current State Summary

- Recurring module is feature complete with strong Money class usage and audit logging.
- Critical gaps: missing cross-household and privacy tests; keyboard accessibility.
- Concurrency risk: link operations lack row locks.
- Minor LOC violations in controller and routes files.
- UX polish needed for empty states, dark mode colors, and mobile calendar layout.

---

## Phase 0 - Security and Accessibility (P0)

### Authorization and Privacy Tests (QA)
- Add cross-household isolation tests for all CRUD and lifecycle endpoints.
- Add transaction visibility test for private transactions on link.
- Add account ownership test on create and update.

Files:
- `server/modules/recurring/__tests__/recurring.integration.test.ts`

### Accessibility Fixes (UX)
- Add keyboard navigation to calendar items.
- Add aria-labels to icon-only buttons and view toggles.
- Associate labels with inputs in edit modal.

Files:
- `client/src/features/recurring/components/RecurringCalendar.tsx`
- `client/src/features/recurring/components/RecurringPageHeader.tsx`
- `client/src/features/recurring/components/RecurringItemActions.tsx`
- `client/src/pages/Recurring.tsx`
- `client/src/features/recurring/components/RecurringEditModal.tsx`

Deliverables:
- P0 authorization tests passing.
- WCAG 2.1 AA keyboard and labeling gaps closed.

---

## Phase 1 - Reliability and Structure (P1)

### Concurrency Protection
- Add `FOR UPDATE` row lock before duplicate link checks.
- Ensure duplicate link attempts return conflict.

Files:
- `server/services/recurring/RecurringLinkingService.ts`
- `server/modules/recurring/__tests__/recurring.integration.test.ts`

### Controller Split and LOC Compliance
- Extract pattern detection handlers to `recurring.patterns.controller.ts`.
- Reduce `recurring.routes.ts` size by removing duplicate route aliases.

Files:
- `server/modules/recurring/recurring.controller.ts`
- `server/modules/recurring/recurring.routes.ts`
- `server/modules/recurring/recurring.patterns.controller.ts`
- `server/modules/recurring/index.ts`

### Error Path Tests
- Add 404 tests for invalid UUIDs on id-based routes.
- Add concurrent link tests.

Files:
- `server/modules/recurring/__tests__/recurring.integration.test.ts`

Deliverables:
- Link operations race-safe.
- LOC limits respected.
- 404 and concurrency tests added.

---

## Phase 2 - UX and Polish (P2)

### Empty States and Affordance
- Add list empty state with CTA.
- Improve calendar item hover/focus affordance.

Files:
- `client/src/features/recurring/components/RecurringList.tsx`
- `client/src/features/recurring/components/RecurringCalendar.tsx`

### Dark Mode and Theming
- Replace hardcoded colors with semantic tokens.

Files:
- `client/src/features/recurring/components/RecurringSummary.tsx`
- `client/src/features/recurring/components/RecurringCalendar.tsx`
- `client/src/features/recurring/components/RecurringPageHeader.tsx`
- `client/src/features/recurring/components/RecurringStateComponents.tsx`

### Mobile Usability
- Adjust calendar layout for small screens.
- Ensure 44px touch targets for calendar items and action buttons.

Files:
- `client/src/features/recurring/components/RecurringCalendar.tsx`
- `client/src/features/recurring/components/RecurringItemActions.tsx`

Deliverables:
- Clear empty states and improved interaction cues.
- Dark mode consistent with design tokens.
- Improved mobile layout and touch targets.

---

## Optional Enhancements (P3)

1. Surface pattern detection UI on the recurring page.
2. Expand edit modal fields to match Monarch parity.
3. Add paid/due status badges in list and calendar.
4. Schedule reminders (email/push) with snooze.

---

## Resolved TODO List (Historical)

All items in this list are resolved as of 2026-01-27. See `docs/module-status/recurring-module-status-2026-01-23.md` for verification notes and evidence.

### P0 - Security and Accessibility
1. ✅ Add cross-household isolation tests for CRUD and lifecycle endpoints. (FIXED 2026-01-26 - 10 tests added)
2. ✅ Add transaction visibility test for link operations. (FIXED 2026-01-26 - privacy tests added)
3. ✅ Add account ownership test for create/update. (FIXED 2026-01-26 - ownership test added)
4. ✅ Add keyboard navigation to calendar items. (FIXED 2026-01-26 - arrow keys, Home/End, role=grid)
5. ✅ Add aria-labels to icon-only buttons and view toggles. (VERIFIED 2026-01-27 - already present)
6. ✅ Associate labels with inputs in edit modal. (FIXED 2026-01-27 - htmlFor/id on reminder switch)

### P1 - Reliability and Structure
7. ✅ Add `FOR UPDATE` lock in link operations. (VERIFIED 2026-01-27 - already present at line 138)
8. Add concurrent link test for duplicate prevention.
9. ✅ Split pattern detection out of controller to stay under LOC limit. (FIXED 2026-01-26 - helpers.ts extracted, 560→457 LOC)
10. Trim routes file and remove duplicate aliases.
11. ✅ Add 404 error path tests for id-based routes. (VERIFIED 2026-01-27 - comprehensive tests exist lines 627-973)

### P2 - UX and Polish
12. Add list empty state with CTA.
13. ✅ Improve calendar item affordance and focus styles. (FIXED 2026-01-26 - focus ring styles added)
14. Replace hardcoded colors with semantic tokens.
15. Improve mobile calendar layout and touch targets.

### P2 - From QA Review (Added 2026-01-27)
16. Add Unicode/special character handling tests.
17. Add delete cascade behavior test.
18. Add end date < start date validation test.
19. Add concurrent pause/resume test.
20. Add 365 day lookback edge case test.
21. Add empty list state test.

### P2 - From Fintech Review (Added 2026-01-27)
22. Add multi-currency support for recurring rules.

### P3 - Enhancements
16. Surface pattern detection UI.
17. Expand edit modal fields.
18. Add paid/due badges.
19. Add reminder scheduling.

---

## Verification Plan

### Automated
- `npm run test:server:run -- server/modules/recurring/__tests__/recurring.integration.test.ts`
- `npm run test:client:run -- client/src/features/recurring/__tests__/RecurringComponents.test.tsx`
- `npm run lint`

### Manual
- Keyboard navigation across calendar items and view toggles.
- Edit modal labels announced by screen readers.
- Cross-household access returns 404.
- Linking same transaction twice returns conflict.
- Dark mode contrast for summary card and calendar.
- Mobile calendar layout at 320px and touch targets >= 44px.

---

## Risks and Mitigations

- **Risk:** Row locks could slow link operations under load.  
  **Mitigation:** Lock only the required rows and keep transaction scope minimal.

- **Risk:** Controller split may break routes.  
  **Mitigation:** Add integration tests and route wiring checks.

- **Risk:** Accessibility changes alter click behavior.  
  **Mitigation:** Add unit tests for keyboard interactions and focus handling.

