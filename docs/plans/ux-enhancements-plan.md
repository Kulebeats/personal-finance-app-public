**UX Enhancements Implementation Plan**
Last updated: 2026-02-06

**Scope**
This plan covers the full set of requested UX improvements (items 1–9) with technical specifications and a detailed to-do list. It prioritizes accessibility (WCAG 2.1 AA), performance, and consistent patterns across modules.

**Guiding Constraints**
WCAG 2.1 AA compliance is required.
Avoid new dependencies unless necessary.
Prefer reuse of existing components and hooks.
All new server endpoints must enforce household isolation, role checks, and audit logging.

**Phase Summary**
Phase 1: High priority quick wins
Includes: Empty states with CTA, Lazy-load heavy report sections, Chart accessibility toggle

Phase 2: Medium priority UX polish
Includes: Split details parity, Progress feedback on long actions, Undo for destructive actions

Phase 3: Lower priority enhancements
Includes: Saved filters & presets, Responsive action bars, Command palette / global search

---

**1) Empty States With CTA (High Priority)**
Technical specification
Component base: `client/src/components/ui/empty.tsx`
New wrapper: `client/src/components/ui/empty-state.tsx`
Props: `icon`, `title`, `description`, `primaryAction`, `secondaryAction`, `testId`
Behavior: Primary CTA wired to module-specific action, secondary CTA optional
Accessibility: icon `aria-hidden`, CTA labels explicit, focus rings visible
Targets: Transactions, Reports, Budgets, Goals, Receipts, Accounts

Detailed to-do list
1. Create `client/src/components/ui/empty-state.tsx` using the existing empty primitives.
2. Replace ad-hoc empty states in `client/src/pages/Receipts.tsx`.
3. Replace empty state in `client/src/features/transactions/components/TransactionList.tsx`.
4. Replace empty state in `client/src/features/budget/components/BudgetSection.tsx`.
5. Replace empty state in `client/src/pages/Goals.tsx`.
6. Replace empty state in `client/src/pages/Accounts.tsx`.
7. Replace empty state in `client/src/pages/Reports.tsx` and any report widgets.
8. Add unit tests where empty state rendering is logic-heavy.

Acceptance criteria
Empty state appears when data is empty and not loading.
Primary CTA executes the expected action in each module.
All empty states meet focus and screen reader requirements.

---

**2) Lazy-Load Heavy Report Sections (High Priority)**
Technical specification
Use `React.lazy` and `Suspense` at widget-level for heavy reports.
Add skeleton fallbacks per widget using `client/src/components/ui/skeleton.tsx`.
Prefer dynamic imports inside report widgets for chart libraries.
Optionally defer mounting widgets using `IntersectionObserver` for below-the-fold.
Targets: `client/src/pages/Reports.tsx` and widgets in `client/src/components/reports`.

Detailed to-do list
1. Inventory heavy report widgets and chart components in `client/src/components/reports`.
2. Add `React.lazy` imports for each heavy widget in `client/src/pages/Reports.tsx`.
3. Wrap each widget with `Suspense` and a widget-level skeleton fallback.
4. Move chart library imports inside widget modules if they are currently hoisted.
5. Add optional `useInView` mounting for below-the-fold widgets.
6. Validate bundle split via build analysis and confirm no render regressions.

Acceptance criteria
Initial report page bundle size decreases.
Above-the-fold report widgets render immediately with skeletons for others.
No hydration or suspense errors.

---

**3) Chart Accessibility Toggle (High Priority)**
Technical specification
Provide a toggle to render chart data as an accessible table.
Toggle: `View as table` button with `aria-expanded` and `aria-controls`.
Table structure: `table`, `caption`, `thead`, `tbody`, proper header cells.
Data mapping uses existing chart datasets and formatting utilities.
Targets: chart-heavy components in `client/src/components/reports` and `client/src/components/dashboard`.

Detailed to-do list
1. Create `ChartA11yToggle` component in `client/src/components/reports/shared`.
2. Create `ChartDataTable` component in the same folder.
3. Implement a mapping utility to convert chart datasets to rows and columns.
4. Integrate toggle into each report chart widget.
5. Add keyboard and screen reader checks for toggle and table.
6. Add tests to validate table output for at least 2 widgets.

Acceptance criteria
Every chart has a table alternative.
Toggle is keyboard accessible and announced properly.
Table is readable and uses correct headers and captions.

---

**4) Split Details Parity (Medium Priority)**
Technical specification
Ensure split transaction details are consistent between list view, detail modal, and split modal.
Create a shared `SplitDetails` component for rendering split rows.
Targets: `client/src/pages/Transactions/TransactionsModals.tsx`, `client/src/features/transactions/components/TransactionDetailModal.tsx`, `client/src/components/dashboard/TransactionDetailModal.tsx`.

Detailed to-do list
1. Identify current split rendering differences in the three locations.
2. Build `SplitDetails` in `client/src/features/transactions/components`.
3. Replace split rendering in all transaction views with the shared component.
4. Add tests for split display in detail modal.

Acceptance criteria
Split details look identical across all views.
No regression to split editing or saving flows.

---

**5) Progress Feedback on Long Actions (Medium Priority)**
Technical specification
Use polling with `react-query` `refetchInterval` for exports status.
Show export progress states: queued, generating, completed, failed.
Display progress indicator and last updated timestamp.
Targets: reports exports UI in `client/src/pages/Reports.tsx` and related hooks.

Detailed to-do list
1. Confirm export endpoints and status fields used by Reports.
2. Add a polling hook `useExportStatus` using `refetchInterval`.
3. Surface progress in Reports export history panel.
4. Add toasts on completion and failure using the shared toast API.
5. Add `aria-live="polite"` for status updates.

Acceptance criteria
Users see progress feedback during exports.
Completed exports are surfaced with a download CTA.
Failures show clear error messaging and retry.

---

**6) Undo for Destructive Actions (Medium Priority)**
Technical specification
Preferred pattern: delayed delete with undo window on client.
Delay actual delete API call for 5–10 seconds, show toast with Undo action.
If Undo clicked, cancel delete and restore item in UI.
Targets: transactions, budgets, goals, receipts, accounts.

Detailed to-do list
1. Create `useUndoableDelete` hook in `client/src/hooks`.
2. Implement undo pattern for transactions bulk delete.
3. Implement undo pattern for budgets, goals, receipts, accounts.
4. Add analytics or logs for undo usage if analytics exists.
5. Ensure server deletes are only called after timeout expires.

Acceptance criteria
Undo window available for all destructive actions.
Undo cancels server delete and restores UI state.
No stale cache or double-delete bugs.

---

**7) Saved Filters & Presets (Lower Priority)**
Technical specification
New table: `filter_presets` with `id`, `householdId`, `userId`, `module`, `name`, `filters`, `createdAt`.
New endpoints: list, create, update, delete presets per module.
Security: `householdGuard`, `requireRole("member")`, audit logging on create/update/delete.
UI: `Save preset` action in filter bar, manage presets modal.

Detailed to-do list
1. Add migration for `filter_presets`.
2. Add repository, service, controller, and routes for presets.
3. Add validation schemas for presets.
4. Add UI for save and manage presets in filter bars.
5. Add tests for presets API and UI integration.

Acceptance criteria
Users can save, apply, rename, and delete presets.
Presets are scoped to household and user.
No preset data leaks across households.

---

**8) Responsive Action Bars for Forms (Lower Priority)**
Technical specification
Add sticky bottom action bars on mobile for primary actions.
Use `position: sticky` or `fixed` with safe-area padding.
Targets: transactions, budgets, goals, accounts forms.

Detailed to-do list
1. Identify forms with primary actions that appear off-screen on mobile.
2. Add responsive action bar component.
3. Update form layouts to include sticky action bar at `sm` and below.
4. Verify no overlap with system safe area.

Acceptance criteria
Primary actions remain visible on mobile.
No layout overlap or inaccessible buttons.

---

**9) Command Palette / Global Search (Lower Priority)**
Technical specification
Leverage existing `client/src/components/CommandPalette.tsx`.
Add searchable sources: accounts, transactions, merchants, reports, actions.
Add search provider with debounced input and ranking.
Include keyboard shortcuts and access control.

Detailed to-do list
1. Audit current command palette component and provider.
2. Define search sources and result schemas.
3. Implement search indexing and ranking.
4. Add actions and navigation entries.
5. Add tests for keyboard and search behavior.

Acceptance criteria
Cmd/Ctrl+K opens palette and returns results quickly.
Results are relevant and ranked.
No access to restricted actions.

---

**Testing and QA**
Run client tests for affected modules.
Add at least one accessibility test for chart table toggle.
Validate keyboard navigation for empty states and command palette.
Validate performance improvements using Lighthouse or bundle stats.

**Open Questions**
Which modules should get undo first if we need to stage rollout?
Do we want to support soft delete server-side for more reliable undo?
Do we have analytics instrumentation to track export progress and undo usage?
