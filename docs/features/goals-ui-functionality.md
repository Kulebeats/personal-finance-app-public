# Goals UI And Functionality Assessment

This document assesses the Goals UI and related functionality based on the provided screenshots. It compares the expected behavior to the current codebase and notes coverage gaps.

**Last Updated:** January 2026

## Screenshot 1: Goals list (Save up) with right sidebar

Expected UI and functionality

- Two-column layout with a main goals list and a right sidebar.
- Header actions: Share beta feedback, Goal accounts, Add goals.
- Save up / Pay down tabs.
- Goals list rows with image, status badge, target date, and right-aligned amount.
- Right sidebar "Available for goals" summary with per-account breakdown.
- Global actions: Create goal transfer, Edit goal accounts.

Coverage in code

- Save up / Pay down tabs: Implemented in `client/src/pages/Goals.tsx`.
- Goals list with status and progress: Implemented with row-based layout matching screenshot (`client/src/pages/Goals.tsx`, `client/src/components/goals/GoalStatusBadge.tsx`).
- Add goals: Implemented as full-page multi-step wizard flow (`client/src/components/goals/GoalCreationWizard.tsx`).
- Right sidebar layout: Implemented with Available funds and actions (`client/src/pages/Goals.tsx`).
- Available for goals: Implemented as "Available funds" card in the sidebar (`client/src/components/goals/AvailableFundsDashboard.tsx`, `client/src/pages/Goals.tsx`).
- Goal accounts action: Implemented with account-first modal view grouped by type (Cash, Brokerage) (`client/src/components/goals/GoalAccountsModal.tsx`).
- Create goal transfer: Implemented with account/goal source, date field, and budget toggle (`client/src/components/goals/GoalTransferModal.tsx`).

## Screenshot 2: Edit goal accounts modal

Expected UI and functionality

- Modal listing accounts grouped by type (Cash, Brokerage).
- Per-account toggle to include in goals.
- Option to use entire balance with auto adjustments.
- Linked goal dropdown.
- "Include auto adjustments in budget" toggle.

Coverage in code

- Account assignment support (full/partial balance, auto-update): Implemented (`client/src/components/goals/GoalAccountsModal.tsx`, `server/services/GoalAccountAssignmentService.ts`).
- Global account-level management UI: Implemented with accounts grouped by type (Cash, Brokerage) (`client/src/components/goals/GoalAccountsModal.tsx`).
- Per-account toggle: Implemented.
- "Use entire account balance and future activity" checkbox: Implemented.
- Linked goal dropdown: Implemented.
- Budget adjustment toggle for assignments: Implemented ("Include auto adjustments in budget").

## Screenshot 3: Create goal transfer modal

Expected UI and functionality

- Transfer "From" account or goal, "To" goal.
- Amount and date fields.
- "Include in budget" toggle.

Coverage in code

- Transfer between goals (same type and currency): Implemented in `client/src/components/goals/GoalTransferModal.tsx` and `/api/goals/transfer`.
- Transfer from account to goal: Implemented ("Select account or goal" dropdown).
- Date field: Implemented with calendar picker.
- Budget inclusion toggle: Implemented with explanatory text.

## Screenshot 4: New savings goal - Select goals to add

Expected UI and functionality

- Full-page flow with step navigation (Select, Targets, Contribution, Budget).
- Select multiple goal templates (cards), shows "already added" counts.

Coverage in code

- Goal creation: Implemented as full-page multi-step flow with stepper navigation (`client/src/components/goals/GoalCreationWizard.tsx`).
- Multi-select templates: Implemented with 2-column grid layout (Emergency fund, Down payment, Car, Vacation, Wedding, Education, Retirement, Savings).
- "Already added" state: Implemented showing counts like "1 goal already added", "3 goals already added".
- Step navigation: Implemented (Select → Targets → Contribution → Budget).

## Screenshot 5: Targets step with image customization

Expected UI and functionality

- Left column list of selected goals.
- Right column goal detail editor with large photo preview and "Customize photo" action.
- Target amount and target date.
- Spending reduces goal progress toggle.

Coverage in code

- Goal details (name, target amount, target date, spending toggle): Implemented in `client/src/components/goals/SaveUpGoalForm.tsx`.
- Large photo preview with "Customize photo" CTA: Implemented.
- Multi-goal left list: Implemented showing all selected goals with status ("No targets set").
- Target date conditional on target amount: Implemented (shows "Target amount required" when disabled).
- "Spending reduces goal progress" toggle: Implemented with explanatory text.

## Screenshot 6: Unsplash image selection modal

Expected UI and functionality

- Searchable image library (Unsplash) with grid selection and save/cancel.

Coverage in code

- Image upload + saved library + URL input: Implemented in `client/src/components/goals/GoalImagePicker.tsx`.
- External search (Unsplash) integration: Implemented with search field, grid layout, and photographer credits.

## Screenshot 7: Contribution step

Expected UI and functionality

- Step to add funds already saved, with account selection.
- Guidance text and visual feedback.

Coverage in code

- Creation-time contribution step: Implemented with account selector dropdown.
- "Get a head start" guidance: Implemented with arrow graphic and explanatory text.
- Goals summary panel: Implemented on right side showing all goals with amounts.
- Skip option: Implemented alongside Continue button.

## Screenshot 8: Budget step

Expected UI and functionality

- Monthly planned contributions per goal, prefilled by target/target date.
- Editable inputs and summary total.

Coverage in code

- Creation-time budget step: Implemented.
- Monthly planned contributions header with total: Implemented.
- Per-goal editable contribution inputs: Implemented.
- Validation warnings: Implemented (shows "No target date or target amount" in orange when missing).
- Goals summary panel: Implemented on right side.
- Skip option: Implemented alongside Continue button.

## Summary Of Gaps

All P0 and P1 gaps have been addressed. The following minor items remain:

P2 (polish and enhancements)

- Consider adding summary totals above the list for Save up and Pay down sections.
- Minor styling refinements to match exact spacing and visual polish from reference screenshots.

## Completed Features (Previously Gaps)

The following features have been fully implemented:

P0 (core UX) - COMPLETED

- Global "Goal accounts" management surface with account-first view, grouped by type.
- "Create goal transfer" with account source, transfer date, and budget toggle.

P1 (goal creation flow) - COMPLETED

- Multi-step full-page flow (Select, Targets, Contribution, Budget).
- Template selection grid with "already added" state.
- Contribution step in creation flow.
- Budget step in creation flow.
- Unsplash integration for image selection.

P2 (visual alignment) - COMPLETED

- Goals list converted to row layout with right-aligned amounts.
- Right sidebar with available-for-goals summary and action buttons.

## UI Direction (Non AI, Modern)

- Layout: Two-column, main list + right sidebar for actions and available funds.
- Typography: Tight hierarchy (section title, list item name, muted metadata).
- Surfaces: Light background, subtle borders, soft shadows, rounded corners.
- Controls: Compact buttons (outline for secondary, filled for primary).
- Images: Square thumbnails with consistent sizing and light border.
- Spacing: Generous vertical rhythm, minimal visual noise, avoid heavy gradients.

## Current Implementation Status

The Goals feature is now at full parity with the reference design:

- `client/src/pages/Goals.tsx` - Main goals page with two-column layout
- `client/src/components/goals/GoalCreationWizard.tsx` - Full-page multi-step creation flow
- `client/src/components/goals/GoalAccountsModal.tsx` - Account-first goal accounts management
- `client/src/components/goals/GoalTransferModal.tsx` - Transfer modal with account/goal source, date, budget toggle
- `client/src/components/goals/GoalImagePicker.tsx` - Image picker with Unsplash integration
- `client/src/components/goals/AvailableFundsDashboard.tsx` - Available funds sidebar component

### Management & Workflows

- **Deletion**: Triggered via Goal Detail modal. Requires confirmation. Removes associated data but preserves historical transactions (unlinked).
- **Archiving**: Soft deletion. Hides goal from main list but retains it in filters. Can be restored.
- **Activity**: `GoalActivityList` component tracks modifications, transfers, and status changes for auditability.
