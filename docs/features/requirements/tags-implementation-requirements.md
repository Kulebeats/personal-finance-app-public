# Tags Feature Implementation Requirements

## Overview

This document outlines the requirements for implementing a Tags feature in the personal finance application, following the Monarch Money pattern. Tags provide a flexible way to organize transactions alongside categories, with the key difference that transactions can have **multiple tags** (unlike categories which are single-select).

## Table of Contents

1. [Feature Summary](#feature-summary)
2. [New "Organization" Settings Section](#new-organization-settings-section)
3. [Database Schema (Existing)](#database-schema-existing)
4. [API Routes](#api-routes)
5. [Frontend Hooks](#frontend-hooks)
6. [UI Components](#ui-components)
7. [Integration Points](#integration-points)
8. [Default Tags](#default-tags)
9. [Color Palette](#color-palette)
10. [File Structure](#file-structure)
11. [Implementation Phases](#implementation-phases)

---

## Feature Summary

### What Tags Do

- Tags are organizational labels for transactions
- Unlike categories (single-select), transactions can have **multiple tags**
- Tags have a **color** and **name**
- Tags can be **member-specific** (auto-created for household members)
- Tags track **usage count** for analytics

### Use Cases

| Use Case | Example |
|----------|---------|
| Tax tracking | Mark deductible expenses with "Tax" tag |
| Reimbursements | Track expenses to be reimbursed |
| Split expenses | Mark shared expenses between people |
| Business vs Personal | Separate business expenses |
| Subscriptions | Track recurring subscription payments |
| Custom organization | Vacations, gifts, home projects, etc. |

---

## New "Organization" Settings Section

### Rationale

Instead of adding Tags as a separate settings section, consolidate transaction organization tools into a unified **"Organization"** section with tabs:

```
Settings
├── Account
│   ├── Profile
│   ├── Display
│   ├── Notifications
│   └── Security
├── Household
│   ├── General
│   ├── Members
│   ├── Preferences
│   ├── Institutions
│   ├── Organization    ← NEW: Replaces Categories, Tags, Rules
│   │   ├── Categories (tab)
│   │   ├── Tags (tab)
│   │   └── Rules (tab)
│   ├── Merchants
│   ├── Data
│   ├── Billing
│   └── ...
```

### Benefits

1. **Conceptual grouping**: Categories, Tags, and Rules all organize transactions
2. **Reduced sidebar clutter**: One section instead of three
3. **Easier navigation**: Related features together
4. **Consistent with Monarch**: Similar organizational pattern

### URL Structure

```
/settings/organization           → Redirects to /settings/organization/categories
/settings/organization/categories
/settings/organization/tags
/settings/organization/rules
```

### Implementation

Modify `SETTINGS_SECTIONS` to:

```typescript
export const SETTINGS_SECTIONS = {
  // ... existing sections
  ORGANIZATION: "organization",  // NEW: Replaces CATEGORIES, RULES
  MERCHANTS: "merchants",
} as const;

// Sub-sections for Organization
export const ORGANIZATION_TABS = {
  CATEGORIES: "categories",
  TAGS: "tags",
  RULES: "rules",
} as const;
```

---

## Database Schema (Existing)

The database schema is already implemented in `shared/schema.ts`:

### Tags Table (lines 452-465)

```typescript
export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").references(() => households.id, {
    onDelete: "cascade",
  }),
  name: varchar("name", { length: 50 }).notNull(),
  color: varchar("color", { length: 7 }),        // Hex color e.g., "#3B82F6"
  icon: varchar("icon", { length: 50 }),         // Optional icon
  memberSpecific: boolean("member_specific").default(false),
  memberId: uuid("member_id").references(() => users.id),
  usageCount: integer("usage_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
```

### Transaction Tags Junction Table (lines 791-800)

```typescript
export const transactionTags = pgTable("transaction_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id")
    .notNull()
    .references(() => tags.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

### Required Zod Validators

Add to `shared/schema.ts`:

```typescript
// Tag validation schemas
export const insertTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  icon: z.string().max(50).optional(),
  memberSpecific: z.boolean().optional(),
  memberId: z.string().uuid().optional(),
});

export const updateTagSchema = insertTagSchema.partial();

export type InsertTag = z.infer<typeof insertTagSchema>;
export type Tag = typeof tags.$inferSelect;
```

---

## API Routes

### New File: `server/routes/tags.ts`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tags` | List all tags for household |
| GET | `/api/tags/:id` | Get single tag with usage count |
| POST | `/api/tags` | Create new tag |
| PUT | `/api/tags/:id` | Update tag (name, color, icon) |
| DELETE | `/api/tags/:id` | Delete tag (cascade removes from transactions) |
| GET | `/api/tags/:id/transactions` | List transactions with this tag |

### Request/Response Examples

#### GET /api/tags

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Tax",
      "color": "#3B82F6",
      "icon": null,
      "memberSpecific": false,
      "memberId": null,
      "usageCount": 42,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

#### POST /api/tags

```json
// Request
{
  "name": "Vacation",
  "color": "#10B981"
}

// Response
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Vacation",
    "color": "#10B981",
    ...
  }
}
```

### Transaction Tags Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/transactions/:id/tags` | Add tags to transaction |
| DELETE | `/api/transactions/:id/tags/:tagId` | Remove tag from transaction |
| PUT | `/api/transactions/:id/tags` | Replace all tags on transaction |

#### POST /api/transactions/:id/tags

```json
// Request
{
  "tagIds": ["uuid1", "uuid2"]
}

// Response
{
  "success": true,
  "data": {
    "transactionId": "uuid",
    "tags": [
      { "id": "uuid1", "name": "Tax", "color": "#3B82F6" },
      { "id": "uuid2", "name": "Business", "color": "#F97316" }
    ]
  }
}
```

---

## Frontend Hooks

### New File: `client/src/hooks/useTags.ts`

```typescript
// Query keys
export const tagKeys = {
  all: ["tags"] as const,
  list: () => [...tagKeys.all, "list"] as const,
  detail: (id: string) => [...tagKeys.all, "detail", id] as const,
  transactions: (id: string) => [...tagKeys.all, id, "transactions"] as const,
};

// Hooks
export function useTags(): UseQueryResult<Tag[]>;
export function useTag(id: string): UseQueryResult<Tag>;
export function useCreateTag(): UseMutationResult<Tag, Error, CreateTagInput>;
export function useUpdateTag(): UseMutationResult<Tag, Error, { id: string; data: UpdateTagInput }>;
export function useDeleteTag(): UseMutationResult<void, Error, string>;
export function useAddTagsToTransaction(): UseMutationResult<...>;
export function useRemoveTagFromTransaction(): UseMutationResult<...>;
```

### API Client Addition: `client/src/lib/api.ts`

```typescript
// Tag types
export interface Tag {
  id: string;
  householdId: string;
  name: string;
  color?: string;
  icon?: string;
  memberSpecific: boolean;
  memberId?: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTagInput {
  name: string;
  color?: string;
  icon?: string;
}

export interface UpdateTagInput extends Partial<CreateTagInput> {}

// Tags API
export const tagsApi = {
  list: () => apiCall<ApiResponse<Tag[]>>("/tags"),
  get: (id: string) => apiCall<ApiResponse<Tag>>(`/tags/${id}`),
  create: (data: CreateTagInput) => apiCall<ApiResponse<Tag>>("/tags", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: UpdateTagInput) => apiCall<ApiResponse<Tag>>(`/tags/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string) => apiCall<ApiResponse<void>>(`/tags/${id}`, { method: "DELETE" }),
};
```

---

## UI Components

### 1. Tags List Component

**File:** `client/src/pages/settings/sections/OrganizationSection/TagsList.tsx`

```
┌─────────────────────────────────────────────────────────────────┐
│ Tags                                              [New tag]     │
├─────────────────────────────────────────────────────────────────┤
│ ● Tax                    · 42 TRANSACTIONS        [Edit][Delete]│
│ ● Reimburse              · 15 TRANSACTIONS        [Edit][Delete]│
│ ● Split                  · 8 TRANSACTIONS         [Edit][Delete]│
│ ● Business               · 23 TRANSACTIONS        [Edit][Delete]│
│ ● Subscription           · 31 TRANSACTIONS        [Edit][Delete]│
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Colored dot indicator for each tag
- Transaction count display
- Edit and Delete buttons
- "New tag" button in header

### 2. Tag Edit/Create Modal

**File:** `client/src/pages/settings/sections/OrganizationSection/TagModal.tsx`

```
┌─────────────────────────────────────────────────────┐
│ New tag                                         [×] │
├─────────────────────────────────────────────────────┤
│ Color & Name                                        │
│                                                     │
│ [●] [Name your tag..............................]   │
│                                                     │
│ ┌─────────────────────────────────────────────┐     │
│ │ 🔴 🟠 🟡 🟢 🩵 🩵                            │     │
│ │ 🟢 🩵 🔵 🟣 🩷 🟤                            │     │
│ └─────────────────────────────────────────────┘     │
│                                                     │
│                        [Cancel]  [Save]             │
└─────────────────────────────────────────────────────┘
```

**Features:**
- Color picker with 12 preset colors
- Name input field
- Cancel/Save buttons
- Validation (name required, max 50 chars)

### 3. Tag Multi-Select Component

**File:** `client/src/components/tags/TagsMultiSelect.tsx`

For use in transaction forms and filters:

```
┌─────────────────────────────────────────────────────┐
│ Tags                                                │
│ ┌─────────────────────────────────────────────────┐ │
│ │ [Tax ×] [Business ×]                        ▼   │ │
│ └─────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────┐ │
│ │ ☐ Reimburse                                     │ │
│ │ ☐ Split                                         │ │
│ │ ☑ Tax                                           │ │
│ │ ☑ Business                                      │ │
│ │ ☐ Subscription                                  │ │
│ │ ─────────────────────────────────────────────── │ │
│ │ + Create new tag                                │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Features:**
- Multi-select dropdown with checkboxes
- Selected tags shown as badges
- Inline tag creation option
- Color indicators

### 4. Tag Badge Component

**File:** `client/src/components/tags/TagBadge.tsx`

```typescript
interface TagBadgeProps {
  tag: Pick<Tag, "name" | "color">;
  size?: "sm" | "md";
  removable?: boolean;
  onRemove?: () => void;
}
```

Display: `[● Tag Name]` or `[● Tag Name ×]` if removable

---

## Integration Points

### 1. Transaction Creation/Editing

**File:** `client/src/components/transactions/AddTransactionModal.tsx`

Add TagsMultiSelect component:

```typescript
// Form schema addition
tags: z.array(z.string()).optional().default([]),

// In form UI
<FormField
  name="tags"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Tags</FormLabel>
      <TagsMultiSelect
        value={field.value}
        onChange={field.onChange}
        allowCreate
      />
    </FormItem>
  )}
/>
```

### 2. Transaction Filtering

**File:** `client/src/components/transactions/FiltersModal.tsx`

The `tagIds` field already exists in `TransactionFilters`. Add UI:

```typescript
// In filter sections
<FilterSection title="Tags">
  <TagsMultiSelect
    value={filters.tagIds}
    onChange={(ids) => setFilters({ ...filters, tagIds: ids })}
  />
</FilterSection>
```

### 3. Transaction List Display

**File:** `client/src/pages/Transactions.tsx`

Show tag badges on transaction rows:

```typescript
// In transaction row
{transaction.tags?.map(tag => (
  <TagBadge key={tag.id} tag={tag} size="sm" />
))}
```

### 4. Rules Engine

**File:** `server/routes/rules.ts`

The "add_tags" action already exists. Ensure it works:

```typescript
// In rule action processing
if (action.type === "add_tags" && action.tagIds) {
  for (const tagId of action.tagIds) {
    await storage.addTagToTransaction(transactionId, tagId);
  }
}
```

### 5. Reports

**File:** `shared/reports.ts`

Tags are already included in report transaction data (line 170):

```typescript
tags?: Array<{ id: string; name: string }> | null;
```

### 6. CSV Import/Export

Add tag support to transaction import/export:

```typescript
// Export: Include tags column
const tags = transaction.tags?.map(t => t.name).join(", ") || "";

// Import: Parse tags column and create/link tags
if (row.tags) {
  const tagNames = row.tags.split(",").map(t => t.trim());
  for (const name of tagNames) {
    let tag = await storage.getTagByName(householdId, name);
    if (!tag) {
      tag = await storage.createTag({ householdId, name });
    }
    await storage.addTagToTransaction(transaction.id, tag.id);
  }
}
```

---

## Default Tags

Seed these tags for new households:

| Name | Color | Purpose |
|------|-------|---------|
| Tax | `#3B82F6` (Blue) | Tax-deductible expenses |
| Reimburse | `#14B8A6` (Teal) | Expenses to be reimbursed |
| Split | `#22C55E` (Green) | Shared/split expenses |
| Business | `#F97316` (Orange) | Business-related expenses |
| Subscription | `#EAB308` (Yellow) | Recurring subscriptions |

### Member Tags

When a new household member is added, automatically create a tag with their name:

```typescript
// In member creation flow
await storage.createTag({
  householdId,
  name: member.displayName || member.email.split("@")[0],
  color: generateRandomColor(),
  memberSpecific: true,
  memberId: member.id,
});
```

---

## Color Palette

12-color palette matching Monarch (2 rows of 6):

```typescript
export const TAG_COLORS = [
  // Row 1
  "#EF4444", // Red
  "#F97316", // Orange
  "#EAB308", // Yellow
  "#22C55E", // Green
  "#14B8A6", // Teal
  "#06B6D4", // Cyan
  // Row 2
  "#3B82F6", // Blue
  "#6366F1", // Indigo
  "#8B5CF6", // Purple
  "#EC4899", // Pink
  "#F43F5E", // Rose
  "#A3A3A3", // Gray/Brown
] as const;
```

---

## File Structure

### New Files to Create

```
client/src/
├── components/
│   └── tags/
│       ├── index.ts
│       ├── TagBadge.tsx
│       ├── TagsMultiSelect.tsx
│       └── TagColorPicker.tsx
├── hooks/
│   └── useTags.ts
├── lib/
│   └── api.ts (add tagsApi)
└── pages/
    └── settings/
        └── sections/
            └── OrganizationSection/
                ├── index.tsx
                ├── OrganizationTabs.tsx
                ├── CategoriesTab.tsx (move from CategoriesSection)
                ├── TagsTab.tsx
                ├── TagsList.tsx
                ├── TagModal.tsx
                └── RulesTab.tsx (move from RulesSection)

server/
├── routes/
│   └── tags.ts
├── services/
│   └── TagService.ts
└── storage.ts (add tag methods)

shared/
└── schema.ts (add tag validators)
```

### Files to Modify

```
client/src/
├── features/settings/constants/sectionNames.ts (add ORGANIZATION)
├── pages/settings/SettingsLayout.tsx (update routing)
├── components/transactions/AddTransactionModal.tsx (add tags field)
├── components/transactions/FiltersModal.tsx (add tags filter)
├── pages/Transactions.tsx (show tag badges)
└── hooks/index.ts (export useTags)

server/
├── routes.ts (register tags routes)
├── storage.ts (add CRUD methods)
└── scripts/seed.ts (add default tags)
```

---

## Implementation Phases

### Phase 1: Backend Foundation (Tags CRUD)

1. Add Zod validators to `shared/schema.ts`
2. Add storage methods to `server/storage.ts`:
   - `getTags(householdId)`
   - `getTagById(id, householdId)`
   - `updateTag(id, householdId, data)`
   - `deleteTag(id, householdId)`
3. Create `server/routes/tags.ts` with CRUD endpoints
4. Register routes in `server/routes.ts`
5. Add transaction-tag endpoints

### Phase 2: Frontend Hooks & API

1. Add `Tag` types to `client/src/lib/api.ts`
2. Add `tagsApi` methods to `client/src/lib/api.ts`
3. Create `client/src/hooks/useTags.ts` with all hooks
4. Export from `client/src/hooks/index.ts`

### Phase 3: UI Components

1. Create `TagBadge` component
2. Create `TagColorPicker` component
3. Create `TagsMultiSelect` component
4. Create `TagModal` (create/edit)
5. Create `TagsList` component

### Phase 4: Organization Settings Section

1. Update `sectionNames.ts` with ORGANIZATION section
2. Create `OrganizationSection/index.tsx` with tabs
3. Move CategoriesSection content to `CategoriesTab.tsx`
4. Create `TagsTab.tsx`
5. Move RulesSection content to `RulesTab.tsx`
6. Update `SettingsLayout.tsx` routing
7. Update sidebar navigation

### Phase 5: Transaction Integration

1. Add TagsMultiSelect to AddTransactionModal
2. Add tags to transaction update API calls
3. Add tags filter UI in FiltersModal
4. Show tag badges in transaction list
5. Update transaction detail view

### Phase 6: Seeding & Polish

1. Add default tags to seed script
2. Add member tag auto-creation
3. Add usage count tracking
4. Add bulk tag operations (optional)

---

## Testing Requirements

### Unit Tests

- Tag CRUD operations
- Tag validation (name length, color format)
- Transaction-tag relationships

### Integration Tests

- Create tag → appears in list
- Add tag to transaction → shows on transaction
- Delete tag → removed from transactions
- Filter by tag → correct results

### E2E Tests

- Create new tag flow
- Edit existing tag
- Delete tag with confirmation
- Multi-select tags on transaction
- Filter transactions by tags

---

## Success Metrics

1. **Functionality**: All CRUD operations work correctly
2. **Performance**: Tag list loads in < 200ms
3. **UX**: Tag selection feels responsive
4. **Integration**: Tags work seamlessly with filters, rules, reports
5. **Data integrity**: Deleting tag removes from all transactions

---

## Open Questions

1. Should tags support icons in addition to colors?
2. Should there be a tag merge feature (like merchants)?
3. Should tags have a "hidden" or "archived" state?
4. Should bulk tag operations be included in initial release?
5. Should tags appear in budget views?

---

## References

- [Monarch Money Tags Documentation](https://help.monarchmoney.com/hc/en-us/articles/organizing-transactions-with-tags)
- CategoriesSection implementation: `/client/src/pages/settings/sections/CategoriesSection/`
- MerchantsSection implementation: `/client/src/pages/settings/sections/MerchantsSection/`
- Existing schema: `/shared/schema.ts` (lines 449-465, 791-800)
