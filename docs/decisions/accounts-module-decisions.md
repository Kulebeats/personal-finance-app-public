# Accounts Module - Technical Decision Recommendations

**Date:** 2026-01-20
**Context:** Resolving open questions from Accounts Module Review Addendum
**Status:** Recommendations for approval

---

## Decision 1: Net Worth Scope - User vs Household

### The Question
Should net worth history be **user-scoped** (respecting private accounts) or **household-scoped** (showing full household view)?

### Current State
- **Summary endpoint:** User-scoped (filters private accounts)
- **History endpoint:** Household-scoped (no privacy filtering)
- **Result:** Privacy leak - users can infer private account balances from history

### Recommendation: **User-scoped with optional household view**

#### Rationale

**1. Privacy by default (Security)**
- Private accounts are explicitly marked for owner-only visibility
- Household-scoped history violates this privacy expectation
- Zambia Data Protection Act (DPA) 2021 requires "privacy by design"

**2. Consistency (UX)**
- Summary is user-scoped → history should match
- Inconsistent scopes confuse users ("where did this money come from?")
- Current mismatch is a bug, not a feature

**3. Compliance (Legal)**
- DPA Section 5: "purpose limitation" - data used only for stated purpose
- If account is private, its balance shouldn't appear in another user's reports
- Audit log should show who viewed what data

**4. Flexibility for power users (Feature)**
- Admins/owners can get household view via explicit toggle
- Default: user-scoped (safe)
- Opt-in: household view with clear indicator

### Implementation Plan

```typescript
// server/services/account/AccountReportingService.ts
interface NetWorthHistoryParams {
  dateRange?: string;
  scope?: "user" | "household";  // NEW: explicit scope parameter
}

async getNetWorthHistory(
  householdId: string,
  userId: string,
  params: NetWorthHistoryParams
): Promise<NetWorthHistoryResponse> {
  // Default to user-scoped
  const scope = params.scope ?? "user";

  // Household scope requires admin permission
  if (scope === "household") {
    const userRole = await this.householdService.getMemberRole(householdId, userId);
    if (userRole !== "admin" && userRole !== "owner") {
      throw new ForbiddenError("Household view requires admin role");
    }
  }

  // Get account IDs based on scope
  const accountIds = scope === "user"
    ? await this.accountRepository.getVisibleAccountIds(householdId, userId)
    : await this.accountRepository.getAllAccountIds(householdId);

  const history = await this.accountRepository.getNetWorthSnapshots(
    householdId,
    params.dateRange,
    { accountIds, excludeArchived: true, excludeFromNetWorth: true }
  );

  return {
    data: history,
    meta: {
      scope,
      currency: household.currency,
      accountCount: accountIds.length,
      note: scope === "household" ? "Includes all household accounts" : undefined,
    },
  };
}
```

**UI Changes:**
```tsx
// client/src/features/accounts/components/NetWorthChart.tsx
const { data: currentUser } = useCurrentUser();
const isAdmin = ["admin", "owner"].includes(currentUser?.role);

// Show scope toggle only for admins
{isAdmin && (
  <Select value={scope} onChange={setScope}>
    <SelectItem value="user">My Net Worth</SelectItem>
    <SelectItem value="household">
      Household Net Worth
      <Badge variant="outline">Admin View</Badge>
    </SelectItem>
  </Select>
)}
```

**Audit logging:**
```typescript
// Log when admin views household scope
if (scope === "household" && userId !== ownerId) {
  await businessAuditService.log({
    action: "VIEW_HOUSEHOLD_NET_WORTH",
    entityType: "account",
    details: { viewedBy: userId, includesPrivateAccounts: true },
  });
}
```

---

## Decision 2: Account Metadata Fields

### The Question
Investment type, credit limit, APR, statement day, property details are collected in UI but not persisted. Should we:
- **Option A:** Add schema support (database columns)
- **Option B:** Remove form fields until supported

### Recommendation: **Hybrid approach - phased rollout**

#### Phase 1 (Immediate): Remove most fields
**Remove these from UI immediately:**
- Property address/value (needs separate `properties` table)
- Investment type (needs investment accounts refactor)

**Reason:** These require significant schema changes and separate features.

#### Phase 2 (This sprint): Add credit card fields
**Add to schema now:**
- `creditLimit` (decimal)
- `apr` (decimal)
- `statementDay` (integer 1-31)

**Reason:**
1. Simple fields, no relations needed
2. High user value for credit card management
3. Enables future features (payment reminders, interest calculations)

#### Phase 3 (Next sprint): Investment metadata
**Design separate table:**
```sql
CREATE TABLE account_metadata (
  account_id UUID PRIMARY KEY REFERENCES accounts(id),
  investment_type VARCHAR(50),  -- "brokerage", "401k", "ira", etc.
  property_address TEXT,
  property_purchase_date DATE,
  property_purchase_price DECIMAL(19, 2),
  -- Extensible for future account types
  metadata JSONB
);
```

### Implementation for Phase 1 & 2

**Schema changes:**
```typescript
// shared/schema.ts
export const accounts = pgTable("accounts", {
  // ... existing fields

  // Credit card specific (Phase 2)
  creditLimit: decimal("credit_limit", { precision: 19, scale: 2 }),
  apr: decimal("apr", { precision: 5, scale: 2 }),
  statementDay: integer("statement_day"),  // 1-31, day of month
});

// Validation
export const insertAccountSchema = createInsertSchema(accounts).extend({
  // Only allow credit card fields for credit_card type
  creditLimit: z.string().optional(),
  apr: z.string().optional(),
  statementDay: z.number().int().min(1).max(31).optional(),
}).refine(
  (data) => {
    if (data.type !== "credit_card") {
      return !data.creditLimit && !data.apr && !data.statementDay;
    }
    return true;
  },
  { message: "Credit card fields only valid for credit_card accounts" }
);
```

**UI changes (Phase 1 - immediate):**
```tsx
// client/src/features/accounts/components/AccountDetailsForm.tsx
export function AccountDetailsForm({ accountType }: Props) {
  return (
    <>
      {/* Always shown */}
      <FormField name="name" label="Account Name" />
      <FormField name="institution" label="Institution" />
      <FormField name="accountNumber" label="Account Number" />

      {/* Credit card specific (Phase 2 - add after schema) */}
      {accountType === "credit_card" && (
        <>
          <FormField name="creditLimit" label="Credit Limit" type="money" />
          <FormField name="apr" label="APR (%)" type="number" step="0.01" />
          <FormField name="statementDay" label="Statement Day" type="number" min={1} max={31} />
        </>
      )}

      {/* REMOVE these until Phase 3 */}
      {/* <FormField name="investmentType" ... /> */}
      {/* <FormField name="propertyAddress" ... /> */}
    </>
  );
}
```

**Migration (Phase 2):**
```sql
-- migrations/add_credit_card_fields.sql
ALTER TABLE accounts
  ADD COLUMN credit_limit DECIMAL(19, 2),
  ADD COLUMN apr DECIMAL(5, 2),
  ADD COLUMN statement_day INTEGER;

-- Add constraint
ALTER TABLE accounts
  ADD CONSTRAINT check_statement_day
  CHECK (statement_day IS NULL OR (statement_day >= 1 AND statement_day <= 31));
```

### Why This Approach?

| Consideration | Rationale |
|---------------|-----------|
| **User confusion** | Users enter data that disappears = bad UX. Remove fields immediately. |
| **Quick wins** | Credit card fields are simple, high value. Ship them fast. |
| **Future-proof** | Extensible metadata table allows new account types without schema migrations. |
| **Data integrity** | Type-specific validation ensures clean data. |

---

## Decision 3: Import Behavior for Unknown Categories

### The Question
When importing transactions with category names not in the database, should we:
- **Option A:** Auto-create categories
- **Option B:** Skip and report errors
- **Option C:** Prompt user to map

### Recommendation: **Option C - User mapping with smart suggestions**

#### Rationale

**Why not Option A (auto-create)?**
- Creates category pollution (duplicates with slight variations)
- "Food" vs "food" vs "Food & Dining" = 3 categories
- User loses control over category taxonomy
- Hard to undo after bulk import

**Why not Option B (skip)?**
- Poor UX - failed imports frustrate users
- Requires manual re-import after fixing CSV
- Doesn't leverage existing categories

**Why Option C (user mapping)?**
- User maintains control over category structure
- One-time mapping, then reusable
- Leverages fuzzy matching to suggest existing categories
- Can create new if truly needed

### Implementation

**Import flow:**
```
1. Parse CSV
2. Extract unique category names
3. Match against existing categories (fuzzy)
4. Prompt user for unmapped categories
5. Apply mapping and import
6. Save mapping for future imports
```

**Backend API:**
```typescript
// POST /api/accounts/:id/import/preview
export async function previewImport(req: Request, res: Response): Promise<void> {
  const { csvContent } = req.body;
  const { householdId, userId } = req.householdContext!;

  // Parse CSV
  const parsed = await accountImportService.parseCsv(csvContent);

  // Find unknown categories
  const uniqueCategories = [...new Set(parsed.map(t => t.category).filter(Boolean))];
  const categoryMatches = await categoryService.matchCategories(
    householdId,
    uniqueCategories
  );

  res.json({
    success: true,
    data: {
      rowCount: parsed.length,
      dateRange: {
        start: min(parsed.map(t => t.date)),
        end: max(parsed.map(t => t.date)),
      },
      categoryMapping: categoryMatches,  // { "Food": { suggested: "id123", confidence: 0.9 } }
      unmappedCategories: categoryMatches
        .filter(m => !m.suggested)
        .map(m => m.original),
    },
  });
}

// POST /api/accounts/:id/import/execute
export async function executeImport(req: Request, res: Response): Promise<void> {
  const { csvContent, categoryMapping, createNewCategories } = req.body;
  // categoryMapping: { "Food & Dining": "existing-category-id" }
  // createNewCategories: ["Subscriptions", "Gifts"]

  // Create new categories if requested
  for (const categoryName of createNewCategories) {
    const newCategory = await categoryService.create(householdId, { name: categoryName });
    categoryMapping[categoryName] = newCategory.id;
  }

  // Import with resolved categories
  const result = await accountImportService.importWithMapping(
    accountId,
    householdId,
    userId,
    csvContent,
    categoryMapping
  );

  // Save mapping for future imports
  await importMappingService.saveMapping(householdId, userId, {
    type: "category",
    mapping: categoryMapping,
  });

  res.json({ success: true, data: result });
}
```

**Category matching service:**
```typescript
// server/services/category/CategoryMatchingService.ts
import Fuse from "fuse.js";  // Fuzzy search library

export class CategoryMatchingService {
  async matchCategories(
    householdId: string,
    categoryNames: string[]
  ): Promise<CategoryMatch[]> {
    const existingCategories = await categoryRepository.findAll(householdId);

    const fuse = new Fuse(existingCategories, {
      keys: ["name"],
      threshold: 0.3,  // 70% similarity required
    });

    return categoryNames.map(name => {
      const results = fuse.search(name);
      const bestMatch = results[0];

      return {
        original: name,
        suggested: bestMatch?.item.id,
        suggestedName: bestMatch?.item.name,
        confidence: bestMatch ? 1 - bestMatch.score : 0,
      };
    });
  }
}
```

**UI Component:**
```tsx
// client/src/features/accounts/components/ImportCategoryMapper.tsx
export function ImportCategoryMapper({ unmapped, existing, onComplete }: Props) {
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [newCategories, setNewCategories] = useState<string[]>([]);

  return (
    <Dialog>
      <DialogTitle>Map Categories</DialogTitle>
      <DialogContent>
        <p>Found {unmapped.length} categories not in your system. Map them:</p>

        {unmapped.map(category => (
          <div key={category.original}>
            <Label>"{category.original}" maps to:</Label>

            <RadioGroup
              value={mapping[category.original] ?? ""}
              onChange={(val) => setMapping({ ...mapping, [category.original]: val })}
            >
              {/* Suggested match */}
              {category.suggested && (
                <RadioItem value={category.suggested}>
                  <strong>{category.suggestedName}</strong>
                  <Badge>{(category.confidence * 100).toFixed()}% match</Badge>
                </RadioItem>
              )}

              {/* Create new */}
              <RadioItem value={`new:${category.original}`}>
                Create new category: <strong>{category.original}</strong>
              </RadioItem>

              {/* Manual selection */}
              <Select
                placeholder="Or choose existing..."
                onChange={(val) => setMapping({ ...mapping, [category.original]: val })}
              >
                {existing.map(cat => (
                  <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                ))}
              </Select>
            </RadioGroup>
          </div>
        ))}

        <Button onClick={() => onComplete(mapping, newCategories)}>
          Continue Import
        </Button>
      </DialogContent>
    </Dialog>
  );
}
```

**Saved mappings (for repeat imports):**
```typescript
// Store user's category mapping preferences
export const importMappings = pgTable("import_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").references(() => households.id),
  userId: uuid("user_id").references(() => users.id),
  mappingType: varchar("mapping_type", { length: 50 }),  // "category", "tag"
  sourceValue: varchar("source_value", { length: 255 }),  // "Food & Dining"
  targetId: uuid("target_id"),  // category_id
  useCount: integer("use_count").default(0),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Next import auto-applies previous mappings
```

### Why This Approach?

| Benefit | Impact |
|---------|--------|
| **User control** | User decides category structure |
| **Smart suggestions** | Fuzzy matching reduces manual work |
| **Reusable** | Saved mappings make repeat imports instant |
| **Clean taxonomy** | Prevents category explosion |
| **Flexible** | Can create new if truly needed |

---

## Decision 4: Filter Controls - View/AssetType

### The Question
UI has `view` (all/assets/liabilities) and `assetType` filter controls, but server ignores them. Should we:
- **Option A:** Implement server-side filtering
- **Option B:** Remove controls until implemented

### Recommendation: **Option A - Implement server-side filtering (simple)**

#### Rationale

**Why implement instead of remove?**
1. **Low complexity** - trivial WHERE clause additions
2. **High user value** - common use case ("show only investments")
3. **UI already exists** - UX designed and built
4. **Feature completeness** - expected in financial apps

**Implementation is simple:**
```typescript
// 30 minutes of work for full feature
```

### Implementation

**Backend changes:**
```typescript
// server/services/account/AccountReportingService.ts
async getNetWorthHistory(
  householdId: string,
  userId: string,
  params: NetWorthHistoryParams
): Promise<NetWorthHistory> {
  const filters: any[] = [
    eq(accounts.householdId, householdId),
    eq(accounts.isArchived, false),
    eq(accounts.excludeFromNetWorth, false),
  ];

  // ADD: View filter (all/assets/liabilities)
  if (params.view === "assets") {
    filters.push(eq(accounts.isAsset, true));
  } else if (params.view === "liabilities") {
    filters.push(eq(accounts.isAsset, false));
  }
  // "all" = no filter

  // ADD: Asset type filter (checking, investment, etc.)
  if (params.assetType) {
    filters.push(eq(accounts.type, params.assetType));
  }

  // Apply visibility
  const visibleAccountIds = await this.accountRepository.getVisibleAccountIds(
    householdId,
    userId
  );
  filters.push(inArray(accounts.id, visibleAccountIds));

  // Get snapshots with filters
  const snapshots = await db
    .select()
    .from(accountBalanceSnapshots)
    .innerJoin(accounts, eq(accountBalanceSnapshots.accountId, accounts.id))
    .where(and(...filters))
    .orderBy(desc(accountBalanceSnapshots.snapshotDate));

  // Aggregate by date
  const aggregated = this.aggregateSnapshotsByDate(snapshots);

  return {
    data: aggregated,
    meta: {
      scope: "user",
      filters: {
        view: params.view ?? "all",
        assetType: params.assetType,
      },
      accountCount: new Set(snapshots.map(s => s.accountId)).size,
    },
  };
}
```

**Validation:**
```typescript
// server/modules/accounts/accounts.validation.ts
export const netWorthHistoryQuerySchema = z.object({
  dateRange: z.enum(["1w", "1m", "3m", "6m", "1y", "all"]).optional(),
  view: z.enum(["all", "assets", "liabilities"]).optional(),
  assetType: z.enum(accountTypeEnum.enumValues).optional(),
});
```

**Tests:**
```typescript
describe("getNetWorthHistory filters", () => {
  it("should filter to assets only", async () => {
    await createAccount({ type: "checking", isAsset: true, balance: 1000 });
    await createAccount({ type: "credit_card", isAsset: false, balance: -500 });

    const history = await service.getNetWorthHistory(householdId, userId, {
      view: "assets",
    });

    expect(history.data.every(d => d.value >= 0)).toBe(true);
  });

  it("should filter to specific account type", async () => {
    await createAccount({ type: "investment", balance: 5000 });
    await createAccount({ type: "checking", balance: 1000 });

    const history = await service.getNetWorthHistory(householdId, userId, {
      assetType: "investment",
    });

    expect(history.meta.accountCount).toBe(1);
  });
});
```

### Why Implement Instead of Remove?

| Factor | Analysis |
|--------|----------|
| **Complexity** | ~30 min implementation (2 filter clauses) |
| **User value** | High - common filtering need |
| **UI exists** | Designed, built, just needs wiring |
| **Expectations** | Users expect this in financial dashboards |
| **Cost of delay** | Users file bugs/feature requests |

**Low hanging fruit - just implement it.**

---

## Summary of Recommendations

| Decision | Recommendation | Priority | Effort |
|----------|----------------|----------|--------|
| **Net Worth Scope** | User-scoped with optional household view for admins | P0 | 4h |
| **Account Metadata** | Phase 1: Remove property/investment fields<br>Phase 2: Add credit card fields<br>Phase 3: Extensible metadata table | P1 | 6h total |
| **Import Categories** | User mapping with fuzzy matching and saved preferences | P1 | 8h |
| **Filter Controls** | Implement server-side filtering (simple) | P1 | 30m |

### Implementation Order

1. **Filters** (30m) - Quick win, unblocks UI
2. **Net worth scope** (4h) - Security/privacy issue
3. **Remove unused metadata fields** (30m) - Prevents user confusion
4. **Category mapping** (8h) - Enables clean imports
5. **Add credit card fields** (6h) - High value feature

**Total effort:** ~19 hours across all decisions

---

## Approval Needed

Please review and approve/modify these recommendations. Once approved, I'll update the TODO document with the specific implementation approach for each decision.

**Questions for clarification:**
1. Do you want household view toggle in UI now, or phase 2?
2. Should we add credit card payment reminders once we have credit card metadata?
3. For category mapping, show top 3 suggestions or just best match?
