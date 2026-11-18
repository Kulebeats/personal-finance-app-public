# Architecture Decisions

## Feature Module Pattern

### Overview

The codebase follows a **feature module pattern** for organizing complex UI features. Each feature module is a self-contained directory under `client/src/features/` that encapsulates all components, hooks, types, and utilities related to a specific feature.

### Structure

```
client/src/features/
├── budget/
│   ├── components/       # UI components
│   │   ├── BudgetRow.tsx
│   │   ├── BudgetGroupHeader.tsx
│   │   ├── BudgetSection.tsx
│   │   ├── BudgetSettingsModal.tsx
│   │   ├── BudgetEditModal.tsx
│   │   ├── BudgetDetailModal.tsx
│   │   ├── BudgetForecastTable.tsx
│   │   ├── BudgetSummaryCard.tsx
│   │   ├── BudgetWalkthrough.tsx
│   │   ├── ContributionsSection.tsx
│   │   ├── ForecastEditModal.tsx
│   │   └── MoveMoneyModal.tsx
│   ├── hooks/            # Feature-specific hooks
│   │   └── useBudgetPageData.ts
│   ├── __tests__/        # Unit tests
│   ├── types.ts          # TypeScript interfaces
│   └── index.ts          # Public exports
├── recurring/
│   ├── components/
│   │   ├── RecurringCalendar.tsx
│   │   ├── RecurringList.tsx
│   │   ├── RecurringSummary.tsx
│   │   ├── RecurringItemActions.tsx
│   │   └── RecurringEditModal.tsx
│   ├── __tests__/
│   ├── types.ts
│   └── index.ts
└── transactions/
    └── ...
```

### Benefits

1. **Reduced Page Size**: Pages import from feature modules instead of containing hundreds of lines of inline components
2. **Encapsulation**: All feature-related code lives together
3. **Testability**: Each component can be tested in isolation
4. **Reusability**: Components can be imported across different pages
5. **Clear API**: `index.ts` defines the public interface

### Usage

```typescript
// In a page file (e.g., pages/Budget.tsx)
import {
  BudgetSection,
  BudgetSummaryCard,
  BudgetSettingsModal,
  useBudgetPageData,
  type BudgetCategory,
} from "@/features/budget";
```

### Code Reduction Results

| Page          | Before    | After   | Reduction |
| ------------- | --------- | ------- | --------- |
| Budget.tsx    | 3,190 LOC | 250 LOC | 92%       |
| Recurring.tsx | 749 LOC   | 230 LOC | 69%       |

### Guidelines

1. **One feature per directory** - Don't mix unrelated features
2. **Export via index.ts** - All public exports should go through the barrel file
3. **Keep types in types.ts** - Centralize interfaces and type definitions
4. **Use hooks for state logic** - Complex state management goes in custom hooks
5. **Test components in isolation** - Each component should have unit tests

---

## Server Architecture

See `server/README.md` for backend architecture decisions.

## Testing Strategy

- **Unit Tests**: Test individual components in `__tests__/` directories
- **Integration Tests**: Test full page functionality in `pages/__tests__/`
- **API Tests**: Server-side tests in `server/**/__tests__/`
