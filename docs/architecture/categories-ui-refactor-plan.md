# Categories UI Refactor Plan - Monarch-Style Hierarchy

**Status**: Ready for Implementation
**Priority**: High
**Estimated Effort**: 2-3 days

## Overview

Refactor the Categories Section UI from a flat searchable list to a hierarchical tree structure matching Monarch Money's design:

```
Type (Income/Expenses/Transfers)        [Create group]
├── Group Name                          [Edit]
│   ├── ⬛ Category 1                   [drag handle]
│   ├── 💚 Category 2                   [drag handle]
│   └── [Create Category]
```

## Current State

**Files to modify:**
- `client/src/pages/settings/sections/CategoriesSection/index.tsx`
- `client/src/pages/settings/sections/CategoriesSection/CategoryList.tsx`
- `client/src/pages/settings/sections/CategoriesSection/CategoryItem.tsx`

**Current behavior:**
- Groups listed separately at top
- Categories in flat searchable/filterable list
- Move up/down buttons for reorder
- Stats cards (budget, spent, transaction count)

## Target State (Monarch-aligned)

### Visual Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  ℹ️ Changes you make to your groups and categories here will   │
│     be applied all throughout the app.                         │
└─────────────────────────────────────────────────────────────────┘

Income                                              [Create group]
┌─────────────────────────────────────────────────────────────────┐
│  Income                                                [Edit]   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ ⋮⋮  🟩 Salary - Primary Job                                ││
│  │ ⋮⋮  🟩 Salary - Secondary Job / Contract                   ││
│  │ ⋮⋮  🟩 Business Income                                     ││
│  │ ⋮⋮  🟩 Interest & Dividends                                ││
│  │ ⋮⋮  🟩 Other Income                                        ││
│  └─────────────────────────────────────────────────────────────┘│
│  [+ Create Category]                                            │
└─────────────────────────────────────────────────────────────────┘

Expenses                                            [Create group]
┌─────────────────────────────────────────────────────────────────┐
│  Housing & Utilities                                   [Edit]   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ ⋮⋮  🟦 Rent / Mortgage                                     ││
│  │ ⋮⋮  🟦 Electricity / Power                                 ││
│  │ ⋮⋮  🟦 Water                                               ││
│  └─────────────────────────────────────────────────────────────┘│
│  [+ Create Category]                                            │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│  Food & Groceries                                      [Edit]   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ ⋮⋮  🟢 Groceries (Home Food)                               ││
│  │ ⋮⋮  🟢 Restaurants & Dining Out                            ││
│  └─────────────────────────────────────────────────────────────┘│
│  [+ Create Category]                                            │
└─────────────────────────────────────────────────────────────────┘

Transfers                                           [Create group]
┌─────────────────────────────────────────────────────────────────┐
│  Transfers & Adjustments                               [Edit]   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ ⋮⋮  ⬜ Transfer Between Own Accounts                       ││
│  │ ⋮⋮  ⬜ Credit Card Payment                                 ││
│  └─────────────────────────────────────────────────────────────┘│
│  [+ Create Category]                                            │
└─────────────────────────────────────────────────────────────────┘
```

### Key Features

1. **Hierarchical Display**: Type → Group → Category
2. **Drag-and-Drop**: Reorder categories within a group using @dnd-kit
3. **Inline Create**: "Create Category" button within each group
4. **Group Edit Modal**: Name + Budget mode (by category / by group)
5. **Category Row**: Drag handle + icon + name (click to edit)
6. **Show/Hide Archived**: Toggle to show archived categories (greyed out)

---

## Implementation Tasks

### Phase 1: Install Dependencies & Setup

#### Task 1.1: Install @dnd-kit
```bash
cd client && npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

**Acceptance Criteria:**
- [ ] @dnd-kit packages installed
- [ ] No build errors

---

### Phase 2: Create New Components

#### Task 2.1: Create TypeSection Component
**File:** `client/src/pages/settings/sections/CategoriesSection/TypeSection.tsx`

```tsx
interface TypeSectionProps {
  type: "income" | "expenses" | "transfers";
  groups: CategoryGroup[];
  categories: Category[];
  onCreateGroup: (type: string) => void;
  onEditGroup: (group: CategoryGroup) => void;
  onCreateCategory: (groupId: string) => void;
  onEditCategory: (category: Category) => void;
  onReorderCategories: (groupId: string, orderedIds: string[]) => void;
  showArchived: boolean;
}
```

**Features:**
- Renders type header (Income/Expenses/Transfers) with "Create group" link
- Maps over groups of this type
- Renders GroupSection for each group

**Acceptance Criteria:**
- [ ] Type header displays correctly
- [ ] "Create group" link triggers onCreateGroup
- [ ] Groups filtered by type and sorted by displayOrder

---

#### Task 2.2: Create GroupSection Component
**File:** `client/src/pages/settings/sections/CategoriesSection/GroupSection.tsx`

```tsx
interface GroupSectionProps {
  group: CategoryGroup;
  categories: Category[];
  onEditGroup: () => void;
  onCreateCategory: () => void;
  onEditCategory: (category: Category) => void;
  onReorderCategories: (orderedIds: string[]) => void;
  showArchived: boolean;
}
```

**Features:**
- Group header with name and "Edit" button
- DnD context for categories within group
- SortableContext with category items
- "Create Category" link at bottom

**Acceptance Criteria:**
- [ ] Group header displays name
- [ ] Edit button opens group edit modal
- [ ] Categories can be dragged and reordered
- [ ] "Create Category" triggers onCreateCategory with groupId

---

#### Task 2.3: Create DraggableCategoryItem Component
**File:** `client/src/pages/settings/sections/CategoriesSection/DraggableCategoryItem.tsx`

```tsx
interface DraggableCategoryItemProps {
  category: Category;
  onEdit: () => void;
  isArchived: boolean;
}
```

**Features:**
- Uses @dnd-kit/sortable useSortable hook
- 6-dot drag handle on left
- Color square with icon/emoji or first letter
- Category name (clickable to edit)
- Archived styling (opacity-60)

**Acceptance Criteria:**
- [ ] Drag handle visible and functional
- [ ] Icon/color square displays correctly
- [ ] Click on name opens edit modal
- [ ] Archived categories greyed out

---

### Phase 3: Implement Drag-and-Drop

#### Task 3.1: Setup DnD Context in GroupSection
```tsx
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
```

**Implementation:**
```tsx
const handleDragEnd = (event: DragEndEvent) => {
  const { active, over } = event;
  if (over && active.id !== over.id) {
    const oldIndex = categories.findIndex(c => c.id === active.id);
    const newIndex = categories.findIndex(c => c.id === over.id);
    const newOrder = arrayMove(categories, oldIndex, newIndex);
    onReorderCategories(newOrder.map(c => c.id));
  }
};
```

**Acceptance Criteria:**
- [ ] Categories can be dragged within their group
- [ ] Order persists after drop (API call)
- [ ] Visual feedback during drag (transform, shadow)

---

#### Task 3.2: Implement useSortable in DraggableCategoryItem
```tsx
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
  id: category.id,
});

const style = {
  transform: CSS.Transform.toString(transform),
  transition,
  opacity: isDragging ? 0.5 : 1,
};
```

**Acceptance Criteria:**
- [ ] Smooth drag animation
- [ ] Item follows cursor during drag
- [ ] Drop indicator shows insertion point

---

### Phase 4: Refactor Main Component

#### Task 4.1: Refactor CategoriesSection/index.tsx

**Remove:**
- Old CategoryList component usage
- Stats cards
- Search/filter/sort controls (move to optional secondary view)

**Add:**
- Info banner at top
- Show archived toggle (simple)
- TypeSection for each type (income, expenses, transfers)

**New Structure:**
```tsx
export default function CategoriesSection() {
  const [showArchived, setShowArchived] = useState(false);
  // ... existing hooks and state ...

  // Group categories by type
  const categoriesByType = useMemo(() => {
    const byType = { income: [], expenses: [], transfers: [] };
    // ... grouping logic ...
    return byType;
  }, [categories, groups]);

  return (
    <SettingsCard title="Categories" ...>
      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6">
        <p className="text-sm text-blue-800">
          Changes you make to your groups and categories here will be applied
          all throughout the app. Customize your category structure to fit your needs.
        </p>
      </div>

      {/* Show Archived Toggle */}
      <div className="flex justify-end mb-4">
        <Button variant="ghost" size="sm" onClick={() => setShowArchived(!showArchived)}>
          {showArchived ? 'Hide Archived' : 'Show Archived'}
        </Button>
      </div>

      {/* Type Sections */}
      <TypeSection type="income" ... />
      <TypeSection type="expenses" ... />
      <TypeSection type="transfers" ... />

      {/* Dialogs */}
      <CategoryDialog ... />
      <GroupDialog ... />
    </SettingsCard>
  );
}
```

**Acceptance Criteria:**
- [ ] Hierarchical view renders correctly
- [ ] All types displayed with their groups
- [ ] Categories nested under groups
- [ ] Create/Edit dialogs still work

---

#### Task 4.2: Update Edit Group Dialog
**Match Monarch's "Edit Group" modal:**

```tsx
<Dialog>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Edit Group</DialogTitle>
    </DialogHeader>

    <div className="space-y-4">
      <div>
        <Label>Name</Label>
        <Input value={groupForm.name} onChange={...} />
      </div>

      <div>
        <Label>Budget</Label>
        <Select value={groupForm.budgetMode} onValueChange={...}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="by_category">By category</SelectItem>
            <SelectItem value="by_group">By group</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          {groupForm.budgetMode === 'by_category'
            ? 'Budget by individual categories within this group.'
            : 'Budget for the entire group as a whole.'}
        </p>
      </div>
    </div>

    <DialogFooter className="flex justify-between">
      <Button variant="destructive" onClick={handleDelete}>Delete</Button>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave}>Save</Button>
      </div>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

**Acceptance Criteria:**
- [ ] Modal matches Monarch design
- [ ] Delete button on left
- [ ] Cancel/Save on right
- [ ] Budget mode description updates

---

#### Task 4.3: Update Edit Category Dialog
**Simplify to match Monarch (click category name to edit):**

Fields:
- Name
- Icon (emoji picker or text input)
- Color picker

**Acceptance Criteria:**
- [ ] Simplified dialog
- [ ] Icon/emoji input
- [ ] Color picker

---

### Phase 5: API Integration

#### Task 5.1: Update Reorder API Call
```tsx
const handleReorderCategories = async (groupId: string, orderedIds: string[]) => {
  const orders = orderedIds.map((id, index) => ({
    id,
    displayOrder: index + 1,
  }));
  await reorderCategories.mutateAsync(orders);
};
```

**Acceptance Criteria:**
- [ ] Reorder persists to database
- [ ] Optimistic update for smooth UX
- [ ] Error handling with rollback

---

### Phase 6: Styling & Polish

#### Task 6.1: Drag Handle Styling
```tsx
<div
  className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-foreground"
  {...listeners}
  {...attributes}
>
  <GripVertical className="h-4 w-4" />
</div>
```

#### Task 6.2: Category Row Hover State
```tsx
<div className="flex items-center gap-3 py-2 px-3 rounded hover:bg-muted/50 transition-colors">
  {/* drag handle */}
  {/* icon square */}
  {/* category name */}
</div>
```

#### Task 6.3: Group Section Styling
```tsx
<div className="border rounded-lg mb-4">
  {/* Group header */}
  <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
    <span className="font-medium">{group.name}</span>
    <Button variant="ghost" size="sm">Edit</Button>
  </div>

  {/* Categories list */}
  <div className="p-2">
    {/* DraggableCategoryItem components */}
  </div>

  {/* Create Category link */}
  <div className="px-4 py-2 border-t">
    <Button variant="ghost" size="sm" className="text-primary">
      Create Category
    </Button>
  </div>
</div>
```

**Acceptance Criteria:**
- [ ] Visual design matches Monarch screenshots
- [ ] Smooth hover transitions
- [ ] Clear visual hierarchy

---

### Phase 7: Testing & QA

#### Task 7.1: Manual Testing Checklist
- [ ] Create new group under each type
- [ ] Create new category in each group
- [ ] Edit group name and budget mode
- [ ] Edit category name, icon, color
- [ ] Drag and reorder categories within group
- [ ] Archive category (verify greyed out when showArchived=true)
- [ ] Restore archived category
- [ ] Delete category (only if no transactions)
- [ ] Verify order persists after page refresh

#### Task 7.2: Edge Cases
- [ ] Empty group displays correctly
- [ ] Single category in group
- [ ] Very long category names truncate
- [ ] Many categories in group (scrolling)

---

## File Structure After Refactor

```
client/src/pages/settings/sections/CategoriesSection/
├── index.tsx                    # Main component (refactored)
├── TypeSection.tsx              # NEW: Type header + groups
├── GroupSection.tsx             # NEW: Group with DnD context
├── DraggableCategoryItem.tsx    # NEW: Sortable category row
├── CategoryDialog.tsx           # Extracted from index.tsx
├── GroupDialog.tsx              # Extracted from index.tsx
├── CategoryList.tsx             # DEPRECATED (keep for reference)
└── CategoryItem.tsx             # DEPRECATED (keep for reference)
```

---

## Task Summary

| # | Task | Priority | Estimate |
|---|------|----------|----------|
| 1.1 | Install @dnd-kit | High | 5 min |
| 2.1 | Create TypeSection | High | 30 min |
| 2.2 | Create GroupSection | High | 45 min |
| 2.3 | Create DraggableCategoryItem | High | 30 min |
| 3.1 | Setup DnD Context | High | 30 min |
| 3.2 | Implement useSortable | High | 20 min |
| 4.1 | Refactor CategoriesSection | High | 1 hour |
| 4.2 | Update Edit Group Dialog | Medium | 20 min |
| 4.3 | Update Edit Category Dialog | Medium | 20 min |
| 5.1 | Update Reorder API | High | 15 min |
| 6.1 | Drag Handle Styling | Medium | 10 min |
| 6.2 | Category Row Hover | Medium | 10 min |
| 6.3 | Group Section Styling | Medium | 20 min |
| 7.1 | Manual Testing | High | 30 min |
| 7.2 | Edge Case Testing | Medium | 20 min |

**Total Estimated Time**: ~6 hours

---

## Dependencies

- `@dnd-kit/core` - Core drag and drop
- `@dnd-kit/sortable` - Sortable list preset
- `@dnd-kit/utilities` - CSS transform utilities

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| DnD performance with many categories | Use virtualization if >100 categories per group |
| Mobile touch support | @dnd-kit has built-in touch support |
| Accessibility | @dnd-kit provides keyboard navigation |
| API rate limiting on rapid reorder | Debounce reorder API calls |

---

## Success Criteria

1. UI matches Monarch Money's category settings design
2. Categories can be dragged to reorder within their group
3. New categories can be created inline within groups
4. Groups can be created under each type
5. All existing functionality preserved (edit, archive, delete)
6. Order persists after page refresh
