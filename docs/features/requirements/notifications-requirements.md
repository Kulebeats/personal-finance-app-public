# Notifications Requirements (Monarch-aligned)

Status: Draft
Version: 0.1
Last updated: 2026-01-02

This document defines requirements for an in-app and email notification system inspired by Monarch Money, adapted for Capital's manual-entry workflow. It incorporates gaps found while reviewing the existing codebase and aligns notification types across UI, seed data, and backend services.

Related:

- `shared/schema.ts` (user_notification_preferences, user_quiet_hours, recurring_transactions, user_sessions)
- `server/services/BudgetService.ts`
- `server/services/GoalService.ts`
- `server/services/RecurringService.ts`
- `server/services/emailService.ts`
- `server/routes/settings.ts` (notification preferences)
- `server/routes/cron.ts`
- `client/src/features/settings/constants/notificationTypes.ts`
- `client/src/components/Layout.tsx`

## Scope

### In scope (v1)

- Notifications table and storage for in-app events
- Notification service and API endpoints
- Bell dropdown UI (list, unread badge, mark read)
- Email notifications via existing SMTP service
- Triggers for budget, goals, transactions, recurring reminders, and security events
- Deduplication to prevent alert spam
- Integration with existing notification preferences

### Out of scope (v1)

- Push and SMS notifications
- Full notification center page (can be added later)
- Unusual spending detection (requires analytics/ML)
- Global time zone and scheduled delivery system (beyond quiet-hours suppress)

## Existing system context

- `user_notification_preferences` already exists and is exposed via `GET/PUT /api/settings/notifications`.
- Settings UI for notification toggles and thresholds already exists.
- `user_quiet_hours` exists in schema but is not yet used by any route.
- Budget alerts are available via `BudgetService.getBudgetAlerts()`.
- Goal progress is calculated in `GoalService.getGoalWithProgress()`; contributions are added via `addContribution()`.
- Recurring transactions include `reminder_days` and `next_due_date`.
- Security data is tracked in `user_sessions` and `user_login_history`.
- SMTP email sending is available via `server/services/emailService.ts`.
- Cron endpoints are already used for snapshots and recurring processing.

## Notification types and copy

The canonical notification type list must match both settings UI and seed data.

| Type | Trigger | Title | Body | Action URL | Notes |
| --- | --- | --- | --- | --- | --- |
| large_transaction | Expense >= user threshold | Large expense recorded | `{amount} at {merchant}` | `/transactions/{id}` | Threshold uses `user_notification_preferences.threshold_amount`. |
| recurring_due | Due in N days | Upcoming: `{name}` | `{name} for {amount} is due on {date}` | `/recurring` | Use `recurring_transactions.reminder_days`. |
| unusual_spending | Deferred | Unusual spending detected | `Spending is higher than normal this week` | `/reports` | Keep preference, but no trigger in v1. |
| budget_warning | Percent >= warning threshold | Budget warning: `{budget}` | `You have used {percent}% of your budget` | `/budget` | Uses per-budget `warning_threshold`. |
| budget_exceeded | Percent >= alert threshold or >= 100% | Budget alert: `{budget}` | `You are at {percent}% of your budget` | `/budget` | Uses per-budget `alert_threshold`; copy changes if over 100%. |
| goal_progress | Milestone reached | Goal progress: `{goal}` | `You reached {percent}% of your goal` | `/goals/{id}` | Milestones: 25/50/75. |
| goal_achieved | 100% reached | Goal achieved | `You completed "{goal}"` | `/goals/{id}` | Only once per goal. |
| new_login | New device/session | New login detected | `Login from {device} ({ip})` | `/settings/security/sessions` | Use `user_sessions` to detect new device. |
| password_changed | Password updated | Password changed | `Your password was updated successfully` | `/settings/security` | Always notify. |

## Data model and migrations

### New table: notifications

Fields (Postgres):

- `id` UUID PK (default `gen_random_uuid()`)
- `user_id` UUID FK -> users.id (required)
- `household_id` UUID FK -> households.id (optional but recommended)
- `type` VARCHAR(50) (required)
- `title` VARCHAR(255) (required)
- `body` TEXT (required)
- `action_url` VARCHAR(255) (nullable)
- `metadata` JSONB (nullable)
- `dedupe_key` VARCHAR(150) (nullable, used for uniqueness)
- `is_read` BOOLEAN default false
- `is_archived` BOOLEAN default false
- `created_at` TIMESTAMP default now

Indexes:

- `idx_notifications_user_unread` on (`user_id`, `is_read`, `created_at` desc)
- `idx_notifications_user_created` on (`user_id`, `created_at` desc)
- `idx_notifications_dedupe` unique on (`user_id`, `dedupe_key`) where `dedupe_key` is not null

### Seed data alignment (required)

Update `server/seed.ts` notification seed types to match the canonical list above. The current seed list is mismatched and must be replaced.

### Shared constants (required)

Create a shared notification type constant (e.g. `shared/notificationTypes.ts`) to avoid divergence between server seed data and the settings UI constants.

## Functional requirements

### FR-N-1: Create in-app notification

- System stores a notification row when a trigger fires and in-app is enabled.
- Notification includes `type`, `title`, `body`, `action_url`, and metadata.

### FR-N-2: List notifications

- API returns notifications for the current user, newest first.
- Supports pagination with `limit` and `offset` (default limit 20).
- Optionally supports `unreadOnly` and `includeArchived` flags.

### FR-N-3: Unread count

- API returns total unread count for the current user.
- Count matches `is_read = false` and `is_archived = false`.

### FR-N-4: Mark read

- Single notification can be marked as read.
- Marking as read does not delete the record.

### FR-N-5: Mark all read

- API supports marking all unread notifications as read.

### FR-N-6: Archive or delete

- API allows archiving a notification (soft-delete).
- Archived notifications are hidden by default.

### FR-N-7: Preferences enforcement

- NotificationService respects `user_notification_preferences` per type.
- If `inAppEnabled` is false, do not create an in-app notification.
- If `emailEnabled` is true, send email (subject/body aligned with type).

### FR-N-8: Deduplication

- Use `dedupe_key` to prevent duplicates for the same event.
- If a dedupe conflict occurs, skip creating the duplicate.

### FR-N-9: Household fan-out

- For household-level events (budget, recurring), create notifications for all household members unless explicitly excluded by role.
- For user-specific events (password change, login), notify only the affected user.

### FR-N-10: Trigger integration points

- See "Notification triggers and dedupe logic" section for exact trigger rules.

## Backend API requirements

New routes in `server/routes/notifications.ts`:

- `GET /api/notifications`
  - Query: `limit`, `offset`, `unreadOnly`, `includeArchived`
- `GET /api/notifications/unread-count`
- `PUT /api/notifications/:id/read`
- `PUT /api/notifications/read-all`
- `DELETE /api/notifications/:id` (archives by default)

Register routes in `server/routes.ts` as `/api/notifications`.

## Notification triggers and dedupe logic

### large_transaction

- Trigger: `TransactionService.createTransaction` after successful creation (not duplicate).
- Applies to `expense` type only (not `income`, `transfer`, or `balance_adjustment`).
- Threshold: `user_notification_preferences.threshold_amount` for `large_transaction`.
- Dedupe key: `large_transaction:{transactionId}`.

### budget_warning / budget_exceeded

- Trigger: after transaction creation or recurring processing, run `getBudgetAlerts()`.
- Use per-budget `warning_threshold` and `alert_threshold`.
- Map `warning` -> `budget_warning`.
- Map `alert` or `exceeded` -> `budget_exceeded` (copy varies if `percentUsed` >= 100).
- Dedupe key: `budget:{budgetId}:{year}-{month}:{level}`.

### goal_progress / goal_achieved

- Trigger: after `GoalService.addContribution` updates `currentAmount`.
- Milestones: 25, 50, 75 for `goal_progress`; 100 for `goal_achieved`.
- Dedupe key: `goal:{goalId}:milestone:{percent}`.

### recurring_due

- Trigger: daily job that checks upcoming recurring transactions.
- Select active, not paused rules with `next_due_date` within `reminder_days`.
- Dedupe key: `recurring:{recurringId}:{nextDueDate}`.

### new_login

- Trigger: successful login when creating a new `user_sessions` record.
- Only notify if device/session is new (no prior trusted session match).
- Dedupe key: `login:{sessionId}`.

### password_changed

- Trigger: `PUT /api/settings/security/password` after successful update.
- Dedupe key: `password_changed:{timestamp or requestId}` (one per change).

## Email delivery

- Use `emailService.sendEmail()`; if SMTP is not configured, log and skip.
- If `user_quiet_hours.enabled` is true, suppress email during quiet hours.
- In-app notifications should still be created immediately.

## Frontend requirements

- Replace the static bell button in `client/src/components/Layout.tsx` with a `NotificationBell` component.
- `NotificationBell` shows:
  - Bell icon
  - Unread count badge (numeric for counts, dot if count > 0 but unknown)
  - Dropdown with recent notifications (default 10)
- `NotificationDropdown` includes:
  - List of notifications (most recent first)
  - Empty state: "No notifications yet"
  - "Mark all as read" action
  - Optional "View all" link (future)
- Clicking a notification:
  - Marks it as read
  - Navigates to `action_url` if present
- Hooks:
  - `useNotifications` (list)
  - `useUnreadCount` (badge)
  - `useMarkAsRead` and `useMarkAllAsRead`

Accessibility:

- Dropdown supports keyboard navigation and close-on-escape.
- Buttons have `aria-labels` for screen readers.

## Implementation notes and improvements

- Align notification type constants across client, server, and seed data.
- Budget thresholds already exist in budgets; avoid duplicating logic in preferences.
- Use `recurring_transactions.reminder_days` for reminder lead time.
- Leverage `user_sessions` / `user_login_history` to detect new logins.
- Add `dedupe_key` to the notifications table to prevent duplicates.
- Consider a retention policy (e.g., purge archived notifications after 180 days).

## Detailed task list

### Decisions and alignment

- [ ] Confirm canonical notification types and update seed + UI constants.
- [ ] Confirm budget threshold mapping (warning/alert/exceeded).
- [ ] Decide quiet-hours behavior (suppress only or queue for later).

### Data model and migrations

- [ ] Add `notifications` table + indexes + dedupe key.
- [ ] Add shared notification type constants.

### Backend API and services

- [ ] Implement `NotificationService` and storage methods.
- [ ] Add `/api/notifications` routes with pagination and unread count.
- [ ] Wire email delivery via `emailService`.

### Trigger integration

- [ ] TransactionService: large transaction notifications.
- [ ] BudgetService: budget warning/exceeded notifications with dedupe.
- [ ] GoalService: milestone notifications with dedupe.
- [ ] Cron job: recurring due reminders.
- [ ] Auth + settings routes: new login and password changed notifications.

### Frontend

- [ ] Build `NotificationBell`, `NotificationDropdown`, `NotificationItem`.
- [ ] Add hooks for list, unread count, and mark-as-read.
- [ ] Integrate bell dropdown into `Layout`.

### Tests and QA

- [ ] Unit tests for `NotificationService` (create/list/dedupe).
- [ ] API tests for notification endpoints.
- [ ] Integration tests for trigger points (budget, goal, transaction).
- [ ] UI tests for dropdown and badge behavior.

## Acceptance criteria

- Notification bell displays accurate unread count and recent notifications.
- Notifications are created for large transactions, budgets, goals, recurring due, logins, and password changes.
- Preferences control in-app and email delivery.
- Deduplication prevents repeated alerts for the same event.
- Settings UI and seed data use the same notification type list.
