# Recurring Transactions - Implementation Plan

## Current State Analysis

### What's Already Implemented

**Database Schema** (`shared/schema.ts`):
- `recurringTransactions` table with basic fields
- `recurringFrequencyEnum`: daily, weekly, biweekly, monthly, quarterly, yearly
- Links to accounts, categories, merchants
- Basic scheduling (startDate, endDate, nextDueDate, dayOfMonth, dayOfWeek)
- reminderDays field, isActive/isPaused flags

**Backend** (`server/`):
- `RecurringRepository` - CRUD, findDue, findUpcoming, calculateNextDate
- `RecurringService` - Validation, pause/resume, skip, processRecurring
- `routes/recurring.ts` - Full REST API (GET, POST, PUT, DELETE, /pause, /resume, /skip, /process)

**Frontend**: Nothing implemented yet

---

## Gap Analysis vs. Requirements Document

| Feature | Requirements | Current State | Gap |
|---------|-------------|---------------|-----|
| Transaction Linking | Link recurring to actual transactions | No linking table | **Missing** |
| Auto-Detection | Pattern recognition algorithm | Not implemented | **Missing** |
| Calendar View | Visual calendar of due dates | Not implemented | **Missing** |
| List View | Grouped list with filters | Not implemented | **Missing** |
| Variable Amounts | Support ±tolerance for utilities | Fixed amounts only | **Missing** |
| Custom Frequency | Every X days/weeks/months | Preset frequencies only | **Missing** |
| Occurrence Tracking | Count, missed, last occurred | Not tracked | **Missing** |
| Detection Confidence | AI/algorithm confidence score | Not implemented | **Missing** |
| Notification Channels | Email, push, in-app per item | Only reminderDays | **Partial** |
| Auto-Linking | Match new transactions automatically | Not implemented | **Missing** |
| Subscription Dashboard | Dedicated subscription view | Not implemented | **Missing** |
| History/Audit | Track changes to recurring items | Not implemented | **Missing** |
| Dashboard Widget | Upcoming bills widget | Not implemented | **Missing** |

---

## Improved Requirements (Addressing Document Gaps)

### 1. Error Code Integration
```typescript
// Align with existing error patterns
type RecurringErrorCode =
  | "RECURRING_NOT_FOUND"
  | "RECURRING_VALIDATION_ERROR"
  | "RECURRING_DETECTION_FAILED"
  | "RECURRING_LINK_EXISTS"
  | "RECURRING_PATTERN_CONFLICT";
```

### 2. Timezone Handling
- All date calculations should respect user's timezone from `userDisplaySettings.timezone`
- Store dates as ISO strings, convert for display
- "Next due date" calculations should account for daylight saving transitions

### 3. Account/Category Deletion Handling
- When linked account is deleted: Mark recurring as `ended` with reason
- When linked category is deleted: Set categoryId to null, flag for review
- When linked merchant is deleted: Keep recurring, clear merchantId

### 4. Multi-Currency Support
- Recurring transactions inherit currency from linked account
- Display in household default currency with conversion where needed

### 5. Testing Strategy
- Unit tests: RecurringService, pattern detection algorithm
- Integration tests: Full CRUD flow, auto-detection flow
- Property-based tests: Date calculation edge cases (leap years, month ends)

---

## Implementation Plan

### Phase 1: Schema Enhancement & Core Backend

**1.1 Database Schema Updates**

Add to `shared/schema.ts`:

```typescript
// Enhanced recurring_transactions table additions
export const recurringTransactions = pgTable("recurring_transactions", {
  // ... existing fields ...

  // Amount handling
  amountType: varchar("amount_type", { length: 20 }).default("fixed"), // fixed | variable
  amountTolerance: integer("amount_tolerance").default(0), // 0-50%

  // Custom frequency support
  intervalValue: integer("interval_value").default(1),
  intervalUnit: varchar("interval_unit", { length: 10 }), // days | weeks | months | years

  // Tracking
  totalOccurrences: integer("total_occurrences").default(0),
  missedCount: integer("missed_count").default(0),
  lastOccurredDate: date("last_occurred_date"),

  // Detection
  detectionMethod: varchar("detection_method", { length: 20 }).default("manual"), // manual | automatic
  detectionConfidence: integer("detection_confidence"), // 0-100

  // Notification channels
  reminderEmail: boolean("reminder_email").default(true),
  reminderPush: boolean("reminder_push").default(false),
  reminderInApp: boolean("reminder_in_app").default(true),

  // Auto-linking
  autoLinkEnabled: boolean("auto_link_enabled").default(true),
  autoMarkReviewed: boolean("auto_mark_reviewed").default(false),

  // Subscription-specific
  isSubscription: boolean("is_subscription").default(false),
  trialEndDate: date("trial_end_date"),
});

// New: Link table
export const recurringTransactionLinks = pgTable("recurring_transaction_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  recurringTransactionId: uuid("recurring_transaction_id")
    .notNull()
    .references(() => recurringTransactions.id, { onDelete: "cascade" }),
  matchedAt: timestamp("matched_at").defaultNow(),
  matchMethod: varchar("match_method", { length: 20 }).default("automatic"),
  matchConfidence: integer("match_confidence"),
});

// New: History table
export const recurringTransactionHistory = pgTable("recurring_transaction_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  recurringTransactionId: uuid("recurring_transaction_id")
    .notNull()
    .references(() => recurringTransactions.id, { onDelete: "cascade" }),
  eventType: varchar("event_type", { length: 50 }).notNull(),
  eventData: jsonb("event_data"),
  createdAt: timestamp("created_at").defaultNow(),
  createdBy: uuid("created_by").references(() => users.id),
});
```

**1.2 Migration Script**

Create `drizzle/migrations/XXXX_recurring_enhancements.sql`:

```sql
-- Add new columns to recurring_transactions
ALTER TABLE recurring_transactions
ADD COLUMN IF NOT EXISTS amount_type VARCHAR(20) DEFAULT 'fixed',
ADD COLUMN IF NOT EXISTS amount_tolerance INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS interval_value INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS interval_unit VARCHAR(10),
ADD COLUMN IF NOT EXISTS total_occurrences INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS missed_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_occurred_date DATE,
ADD COLUMN IF NOT EXISTS detection_method VARCHAR(20) DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS detection_confidence INTEGER,
ADD COLUMN IF NOT EXISTS reminder_email BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS reminder_push BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS reminder_in_app BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS auto_link_enabled BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS auto_mark_reviewed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_subscription BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS trial_end_date DATE;

-- Create link table
CREATE TABLE IF NOT EXISTS recurring_transaction_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  recurring_transaction_id UUID NOT NULL REFERENCES recurring_transactions(id) ON DELETE CASCADE,
  matched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  match_method VARCHAR(20) DEFAULT 'automatic',
  match_confidence INTEGER,
  UNIQUE(transaction_id, recurring_transaction_id)
);

CREATE INDEX idx_rtl_transaction ON recurring_transaction_links(transaction_id);
CREATE INDEX idx_rtl_recurring ON recurring_transaction_links(recurring_transaction_id);

-- Create history table
CREATE TABLE IF NOT EXISTS recurring_transaction_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_transaction_id UUID NOT NULL REFERENCES recurring_transactions(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  event_data JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_rth_recurring ON recurring_transaction_history(recurring_transaction_id);
```

**1.3 Validation Schemas**

Update `server/validation/recurringSchemas.ts`:

```typescript
import { z } from "zod";

export const createRecurringSchema = z.object({
  name: z.string().min(1).max(255),
  accountId: z.string().uuid(),
  amount: z.number().positive(),
  amountType: z.enum(["fixed", "variable"]).default("fixed"),
  amountTolerance: z.number().min(0).max(50).default(0),
  type: z.enum(["income", "expense", "transfer"]),
  categoryId: z.string().uuid().optional().nullable(),
  merchantId: z.string().uuid().optional().nullable(),
  frequency: z.enum(["daily", "weekly", "biweekly", "monthly", "quarterly", "yearly", "custom"]),
  intervalValue: z.number().min(1).max(365).optional(),
  intervalUnit: z.enum(["days", "weeks", "months", "years"]).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dayOfMonth: z.number().min(1).max(31).optional().nullable(),
  dayOfWeek: z.number().min(0).max(6).optional().nullable(),
  reminderDays: z.number().min(0).max(30).default(3),
  reminderEmail: z.boolean().default(true),
  reminderPush: z.boolean().default(false),
  reminderInApp: z.boolean().default(true),
  autoLinkEnabled: z.boolean().default(true),
  autoMarkReviewed: z.boolean().default(false),
  isSubscription: z.boolean().default(false),
  trialEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export const updateRecurringSchema = createRecurringSchema.partial();

export const linkTransactionSchema = z.object({
  transactionId: z.string().uuid(),
  matchConfidence: z.number().min(0).max(100).optional(),
});

export const scanForRecurringSchema = z.object({
  lookbackMonths: z.number().min(1).max(24).default(12),
  minOccurrences: z.number().min(2).max(12).default(3),
  amountTolerance: z.number().min(0).max(50).default(5),
});
```

---

### Phase 2: Pattern Detection Service

**2.1 Create DetectionService**

`server/services/RecurringDetectionService.ts`:

```typescript
interface DetectedPattern {
  merchantId: string | null;
  merchantName: string;
  averageAmount: number;
  frequency: string;
  confidence: number;
  occurrences: number;
  transactions: string[];
  suggestedNextDate: string;
  amountVariance: number;
}

export class RecurringDetectionService {
  /**
   * Scan transactions for recurring patterns
   */
  async detectPatterns(
    householdId: string,
    options: {
      lookbackMonths?: number;
      minOccurrences?: number;
      amountTolerance?: number;
    }
  ): Promise<DetectedPattern[]>;

  /**
   * Check if a new transaction matches any recurring rule
   */
  async matchTransaction(
    transaction: Transaction,
    householdId: string
  ): Promise<{ recurringId: string; confidence: number } | null>;

  /**
   * Calculate pattern confidence score
   */
  private calculateConfidence(
    transactions: Transaction[],
    intervalDays: number[]
  ): number;

  /**
   * Detect interval pattern from dates
   */
  private detectInterval(
    dates: string[]
  ): { frequency: string; intervalDays: number; variance: number } | null;
}
```

**2.2 Detection Algorithm**

```typescript
async detectPatterns(householdId: string, options = {}) {
  const {
    lookbackMonths = 12,
    minOccurrences = 3,
    amountTolerance = 5
  } = options;

  // 1. Get transactions from lookback period
  const startDate = subMonths(new Date(), lookbackMonths);
  const transactions = await transactionRepository.findByDateRange(
    householdId,
    startDate,
    new Date()
  );

  // 2. Group by merchant (normalized name)
  const merchantGroups = this.groupByMerchant(transactions);

  // 3. Analyze each group for patterns
  const patterns: DetectedPattern[] = [];

  for (const [merchantKey, txns] of merchantGroups) {
    if (txns.length < minOccurrences) continue;

    // Check amount similarity
    const amounts = txns.map(t => Math.abs(parseFloat(t.amount)));
    const avgAmount = average(amounts);
    const maxVariance = Math.max(...amounts.map(a =>
      Math.abs(a - avgAmount) / avgAmount * 100
    ));

    if (maxVariance > amountTolerance && maxVariance > 20) continue;

    // Check date intervals
    const sortedDates = txns
      .map(t => new Date(t.date))
      .sort((a, b) => a.getTime() - b.getTime());

    const intervals = this.calculateIntervals(sortedDates);
    const pattern = this.detectInterval(intervals);

    if (pattern) {
      patterns.push({
        merchantId: txns[0].merchantId,
        merchantName: merchantKey,
        averageAmount: avgAmount,
        frequency: pattern.frequency,
        confidence: this.calculateConfidence(txns, intervals),
        occurrences: txns.length,
        transactions: txns.map(t => t.id),
        suggestedNextDate: this.calculateNextDate(sortedDates[sortedDates.length - 1], pattern),
        amountVariance: maxVariance
      });
    }
  }

  return patterns.sort((a, b) => b.confidence - a.confidence);
}
```

---

### Phase 3: New API Endpoints

**3.1 Additional Routes**

Add to `server/routes/recurring.ts`:

```typescript
// GET /api/recurring/calendar
// Returns recurring items for calendar display
router.get("/calendar", asyncHandler(async (req, res) => {
  const { householdId } = req.householdContext!;
  const { startDate, endDate } = calendarQuerySchema.parse(req.query);

  const items = await recurringService.getCalendarItems(
    householdId,
    startDate,
    endDate
  );

  res.json({ success: true, data: items });
}));

// GET /api/recurring/summary
// Returns monthly totals and stats
router.get("/summary", asyncHandler(async (req, res) => {
  const { householdId } = req.householdContext!;

  const summary = await recurringService.getSummary(householdId);

  res.json({ success: true, data: summary });
}));

// POST /api/recurring/detect
// Scan for new recurring patterns
router.post("/detect", requireRole("member"), asyncHandler(async (req, res) => {
  const { householdId } = req.householdContext!;
  const options = scanForRecurringSchema.parse(req.body);

  const patterns = await recurringDetectionService.detectPatterns(
    householdId,
    options
  );

  res.json({ success: true, data: patterns });
}));

// POST /api/recurring/:id/confirm
// Confirm a detected pattern
router.post("/:id/confirm", requireRole("member"), asyncHandler(async (req, res) => {
  const { householdId } = req.householdContext!;
  const { id } = req.params;

  const rule = await recurringService.confirmDetection(id, householdId);

  res.json({ success: true, data: rule });
}));

// POST /api/recurring/:id/link
// Link a transaction to recurring
router.post("/:id/link", requireRole("member"), asyncHandler(async (req, res) => {
  const { householdId } = req.householdContext!;
  const { id } = req.params;
  const { transactionId } = linkTransactionSchema.parse(req.body);

  const link = await recurringService.linkTransaction(
    id,
    transactionId,
    householdId
  );

  res.json({ success: true, data: link });
}));

// GET /api/recurring/:id/history
// Get linked transactions
router.get("/:id/history", asyncHandler(async (req, res) => {
  const { householdId } = req.householdContext!;
  const { id } = req.params;

  const history = await recurringService.getLinkedTransactions(id, householdId);

  res.json({ success: true, data: history });
}));

// POST /api/recurring/:id/end
// Mark recurring as ended
router.post("/:id/end", requireRole("member"), asyncHandler(async (req, res) => {
  const { householdId } = req.householdContext!;
  const { id } = req.params;

  const rule = await recurringService.endRecurring(id, householdId);

  res.json({ success: true, data: rule });
}));
```

---

### Phase 4: Frontend Components

**4.1 Directory Structure**

```
client/src/
├── pages/
│   └── Recurring.tsx              # Main recurring page
├── components/
│   └── recurring/
│       ├── RecurringCalendar.tsx  # Calendar view
│       ├── RecurringList.tsx      # List view
│       ├── RecurringCard.tsx      # Individual item card
│       ├── RecurringModal.tsx     # Create/edit modal
│       ├── RecurringDetection.tsx # Detected patterns UI
│       ├── RecurringFilters.tsx   # Filter controls
│       └── SubscriptionDashboard.tsx
├── hooks/
│   └── useRecurring.ts            # React Query hooks
└── features/
    └── recurring/
        ├── types.ts               # TypeScript types
        ├── schemas.ts             # Zod validation
        └── api.ts                 # API client functions
```

**4.2 React Query Hooks**

`client/src/hooks/useRecurring.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export const recurringKeys = {
  all: ["recurring"] as const,
  lists: () => [...recurringKeys.all, "list"] as const,
  list: (filters: RecurringFilters) => [...recurringKeys.lists(), filters] as const,
  details: () => [...recurringKeys.all, "detail"] as const,
  detail: (id: string) => [...recurringKeys.details(), id] as const,
  calendar: (month: string) => [...recurringKeys.all, "calendar", month] as const,
  summary: () => [...recurringKeys.all, "summary"] as const,
  upcoming: (days: number) => [...recurringKeys.all, "upcoming", days] as const,
};

export function useRecurringList(filters?: RecurringFilters) {
  return useQuery({
    queryKey: recurringKeys.list(filters ?? {}),
    queryFn: () => fetchRecurringList(filters),
  });
}

export function useRecurringSummary() {
  return useQuery({
    queryKey: recurringKeys.summary(),
    queryFn: fetchRecurringSummary,
  });
}

export function useUpcomingBills(days = 14) {
  return useQuery({
    queryKey: recurringKeys.upcoming(days),
    queryFn: () => fetchUpcomingBills(days),
  });
}

export function useCreateRecurring() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createRecurring,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recurringKeys.all });
    },
  });
}

export function useDetectPatterns() {
  return useMutation({
    mutationFn: detectPatterns,
  });
}
```

**4.3 Main Page Component**

`client/src/pages/Recurring.tsx`:

```typescript
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RecurringCalendar } from "@/components/recurring/RecurringCalendar";
import { RecurringList } from "@/components/recurring/RecurringList";
import { RecurringModal } from "@/components/recurring/RecurringModal";
import { useRecurringList, useRecurringSummary } from "@/hooks/useRecurring";

export default function RecurringPage() {
  const [view, setView] = useState<"calendar" | "list">("list");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: recurring, isLoading } = useRecurringList();
  const { data: summary } = useRecurringSummary();

  return (
    <div className="container py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Recurring Transactions</h1>
          {summary && (
            <p className="text-muted-foreground">
              {summary.activeCount} active -
              ${summary.monthlyExpenses.toFixed(2)}/mo expenses,
              ${summary.monthlyIncome.toFixed(2)}/mo income
            </p>
          )}
        </div>
        <Button onClick={() => setIsModalOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Recurring
        </Button>
      </div>

      <Tabs value={view} onValueChange={setView}>
        <TabsList>
          <TabsTrigger value="list">List View</TabsTrigger>
          <TabsTrigger value="calendar">Calendar View</TabsTrigger>
        </TabsList>

        <TabsContent value="list">
          <RecurringList
            items={recurring ?? []}
            onEdit={setEditingId}
            isLoading={isLoading}
          />
        </TabsContent>

        <TabsContent value="calendar">
          <RecurringCalendar items={recurring ?? []} />
        </TabsContent>
      </Tabs>

      <RecurringModal
        open={isModalOpen || !!editingId}
        onClose={() => { setIsModalOpen(false); setEditingId(null); }}
        editingId={editingId}
      />
    </div>
  );
}
```

---

### Phase 5: Dashboard Integration

**5.1 Dashboard Widget**

`client/src/components/recurring/UpcomingBillsWidget.tsx`:

```typescript
export function UpcomingBillsWidget() {
  const { data: upcoming, isLoading } = useUpcomingBills(7);

  if (isLoading) return <WidgetSkeleton />;

  const grouped = groupByDueDate(upcoming ?? []);
  const total = upcoming?.reduce((sum, r) =>
    sum + parseFloat(r.amount), 0
  ) ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5" />
          Upcoming Bills
        </CardTitle>
      </CardHeader>
      <CardContent>
        {Object.entries(grouped).map(([date, items]) => (
          <div key={date} className="mb-4">
            <p className="text-sm text-muted-foreground mb-2">
              {formatRelativeDate(date)}
            </p>
            {items.map(item => (
              <div key={item.id} className="flex justify-between py-1">
                <span>{item.name}</span>
                <span className={item.type === "expense" ? "text-red-500" : "text-green-500"}>
                  {item.type === "expense" ? "-" : "+"}${item.amount}
                </span>
              </div>
            ))}
          </div>
        ))}
        <Separator className="my-4" />
        <div className="flex justify-between font-medium">
          <span>Total Due</span>
          <span>${total.toFixed(2)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
```

---

### Phase 6: Transaction Integration

**6.1 Transaction List Enhancement**

Update `client/src/components/transactions/TransactionRow.tsx`:

```typescript
// Add recurring indicator
{transaction.isRecurring && (
  <Badge variant="outline" className="ml-2">
    <RefreshCw className="h-3 w-3 mr-1" />
    Recurring
  </Badge>
)}

// Add context menu option
<ContextMenuItem onClick={() => handleMakeRecurring(transaction)}>
  <RefreshCw className="h-4 w-4 mr-2" />
  Make Recurring
</ContextMenuItem>
```

**6.2 Auto-Linking on Import**

Update import service to check for matches:

```typescript
// In import processing
for (const transaction of importedTransactions) {
  const match = await recurringDetectionService.matchTransaction(
    transaction,
    householdId
  );

  if (match && match.confidence > 80) {
    await recurringService.linkTransaction(
      match.recurringId,
      transaction.id,
      householdId,
      { matchMethod: "automatic", matchConfidence: match.confidence }
    );
  }
}
```

---

### Phase 7: Notifications (Future Enhancement)

**7.1 Notification Service Integration**

```typescript
// Scheduled job (daily at 8 AM)
async function sendRecurringReminders() {
  const today = new Date();

  for (const household of await getAllHouseholds()) {
    const upcoming = await recurringRepository.findUpcoming(
      household.id,
      7 // Look ahead 7 days
    );

    for (const rule of upcoming) {
      const daysUntilDue = differenceInDays(
        new Date(rule.nextDueDate),
        today
      );

      if (daysUntilDue === rule.reminderDays) {
        await sendNotification({
          type: "recurring_reminder",
          householdId: household.id,
          data: {
            name: rule.name,
            amount: rule.amount,
            dueDate: rule.nextDueDate,
          },
          channels: {
            email: rule.reminderEmail,
            push: rule.reminderPush,
            inApp: rule.reminderInApp,
          },
        });
      }
    }
  }
}
```

---

## Testing Strategy

### Unit Tests

```typescript
// server/services/__tests__/RecurringService.test.ts
describe("RecurringService", () => {
  describe("processRecurring", () => {
    it("creates transactions for due items");
    it("updates nextDueDate after processing");
    it("handles errors gracefully");
    it("respects endDate");
  });
});

// server/services/__tests__/RecurringDetectionService.test.ts
describe("RecurringDetectionService", () => {
  describe("detectPatterns", () => {
    it("detects monthly patterns");
    it("detects weekly patterns");
    it("handles variable amounts within tolerance");
    it("ignores patterns with too few occurrences");
    it("calculates confidence correctly");
  });
});
```

### Property-Based Tests

```typescript
// Date calculation edge cases
describe("calculateNextDate", () => {
  it("handles month-end dates correctly", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }), // month
        fc.integer({ min: 28, max: 31 }), // day
        (month, day) => {
          const result = calculateNextDate(`2024-${month}-${day}`, "monthly");
          expect(new Date(result).getDate()).toBeLessThanOrEqual(31);
        }
      )
    );
  });

  it("handles leap years", () => {
    const result = calculateNextDate("2024-01-29", "monthly");
    expect(result).toBe("2024-02-29"); // Leap year
  });
});
```

### Integration Tests

```typescript
describe("Recurring API", () => {
  it("full CRUD lifecycle");
  it("detection and confirmation flow");
  it("transaction linking");
  it("pause/resume/end states");
});
```

---

## Prioritized Task List

### Priority 1: Core Enhancements (Backend) ✅ COMPLETE
- [x] Add schema columns for new fields
- [x] Create migration script
- [x] Update Zod validation schemas
- [x] Add transaction linking repository methods
- [x] Update RecurringService with new operations
- [x] Add calendar and summary endpoints
- [x] Write unit tests for service layer

### Priority 2: Detection System ✅ COMPLETE
- [x] Create RecurringDetectionService
- [x] Implement pattern detection algorithm
- [x] Add detection API endpoints
- [x] Implement transaction matching
- [x] Add auto-linking on import
- [x] Write tests for detection logic

### Priority 3: Frontend - Core ✅ COMPLETE
- [x] Create useRecurring hooks
- [x] Build RecurringList component
- [x] Build RecurringCard component
- [x] Build RecurringModal (create/edit)
- [x] Create Recurring page
- [x] Add to navigation

### Priority 4: Frontend - Views ✅ COMPLETE
- [x] Build RecurringCalendar component
- [x] Build RecurringFilters
- [x] Build SubscriptionDashboard
- [x] Add dashboard widget
- [x] Transaction list recurring indicator

### Priority 5: Detection UI ✅ COMPLETE
- [x] Build RecurringDetection component
- [x] Detection confirmation flow
- [x] Manual linking UI

### Priority 6: Notifications (Future) ⏳ PARTIAL
- [x] Notification service integration
- [ ] Email templates
- [ ] Push notification setup
- [ ] Scheduled reminder job

**Completion Notes (2026-01-29):**
✅ ALL COMPLETE - Recurring module fully implemented at `server/modules/recurring/` with:
- recurring.controller.ts, recurring.lifecycle.controller.ts, recurring.pattern.controller.ts
- recurring.service.ts, recurring.validation.ts, recurring.helpers.ts
- Comprehensive test suite in `__tests__/` including integration and concurrency tests
Frontend feature module at `client/src/features/recurring/`
All priority 1-5 tasks complete.

---

## File Changes Summary

### New Files
- `drizzle/migrations/XXXX_recurring_enhancements.sql`
- `server/services/RecurringDetectionService.ts`
- `server/services/__tests__/RecurringDetectionService.test.ts`
- `client/src/pages/Recurring.tsx`
- `client/src/components/recurring/RecurringCalendar.tsx`
- `client/src/components/recurring/RecurringList.tsx`
- `client/src/components/recurring/RecurringCard.tsx`
- `client/src/components/recurring/RecurringModal.tsx`
- `client/src/components/recurring/RecurringDetection.tsx`
- `client/src/components/recurring/RecurringFilters.tsx`
- `client/src/components/recurring/SubscriptionDashboard.tsx`
- `client/src/components/recurring/UpcomingBillsWidget.tsx`
- `client/src/hooks/useRecurring.ts`
- `client/src/features/recurring/types.ts`
- `client/src/features/recurring/schemas.ts`
- `client/src/features/recurring/api.ts`

### Modified Files
- `shared/schema.ts` - Add new tables and fields
- `server/routes/recurring.ts` - Add new endpoints
- `server/services/RecurringService.ts` - Add new methods
- `server/repositories/RecurringRepository.ts` - Add new queries
- `server/validation/recurringSchemas.ts` - Update validation
- `client/src/App.tsx` - Add route
- `client/src/components/Layout.tsx` - Add navigation
- `client/src/components/transactions/TransactionRow.tsx` - Add recurring indicator
