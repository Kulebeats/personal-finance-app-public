# Open Plan Backlog (Re-Audit 2026-02-07)

All four originally open plan-gap items were resolved on 2026-02-07.
Final active overhaul plan (`tags-module-overhaul-plan.md`) was re-audited, closed, and archived on 2026-02-07.
There are no active module overhaul/refactor plans remaining in `docs/plans`.

## WR-BL-001 Weekly Recap Settings Persistence
- Module: Weekly Recap
- Priority: P1
- Status: Closed (2026-02-07)
- Closure evidence:
- `server/modules/weekly-recap/weekly-recap.controller.ts:230` now reads persisted settings from `user_notification_preferences` and `user_display_settings`.
- `server/modules/weekly-recap/weekly-recap.controller.ts:287` now persists PATCH updates to DB (notification preferences + display settings `dashboardWidgets.weeklyRecap` + `firstDayOfWeek`).
- `server/modules/weekly-recap/__tests__/weekly-recap.integration.test.ts` now includes settings persistence test coverage.
- Verification:
- `npm run test:server:run -- modules/weekly-recap/__tests__/weekly-recap.integration.test.ts` passed on 2026-02-07.

## HH-BL-001 Household Invitation Email Delivery
- Module: Household
- Priority: P1
- Status: Closed (2026-02-07)
- Closure evidence:
- `server/modules/household/invitations.controller.ts:77` adds invitation email composition and delivery helper.
- `server/modules/household/invitations.controller.ts:181` sends invite email on create.
- `server/modules/household/invitations.controller.ts:382` sends invite email on resend.
- Placeholder logs (`email would be sent`) were removed.
- `server/modules/household/__tests__/invitations.email.test.ts` validates invite, resend, and non-blocking email failure behavior.
- Verification:
- `npm run test:server:run -- modules/household/__tests__/invitations.email.test.ts` passed on 2026-02-07.

## TRX-BL-001 Transaction Repository LOC Compliance
- Module: Transactions
- Priority: P2
- Status: Closed (2026-02-07)
- Closure evidence:
- Delegated compatibility methods were extracted to `server/repositories/TransactionRepository.delegates.ts`.
- `server/repositories/TransactionRepository.ts` now extends the delegates class and is reduced to 477 LOC (<500 target).
- Backward-compatible API remains available through the same `transactionRepository` export.
- Verification:
- Measured count: `(Get-Content server/repositories/TransactionRepository.ts | Measure-Object -Line).Lines` = `477`.

## NOTIF-BL-001 NotificationBell Theme Token Cleanup
- Module: Notifications (UI)
- Priority: P3
- Status: Closed (2026-02-07)
- Closure evidence:
- Hardcoded dark panel classes were removed from `client/src/components/NotificationBell.tsx`.
- Updated tokenized classes:
- `client/src/components/NotificationBell.tsx:172` uses `border-border bg-card`.
- `client/src/components/NotificationBell.tsx:177` uses `border-b border-border`.
- `client/src/components/NotificationBell.tsx:221` uses `divide-border`.
- `client/src/components/NotificationBell.tsx:290` uses `border-t border-border`.

## Remaining Open Items
- None in this backlog file as of 2026-02-07.
