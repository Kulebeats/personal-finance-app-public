# Merchant Management - Requirements Document

## Document Information
**Version:** 1.0
**Date:** 2025-12-21
**Author:** AI Assistant
**Status:** Draft

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [Monarch Money Feature Analysis](#monarch-money-feature-analysis)
4. [Requirements](#requirements)
5. [Technical Specifications](#technical-specifications)
6. [UI/UX Requirements](#uiux-requirements)
7. [Integration Requirements](#integration-requirements)
8. [Implementation Priorities](#implementation-priorities)

---

## Executive Summary

This document defines comprehensive requirements for merchant management in the Personal Finance Application. The system will support **manual merchant entry only** (no automated connectors), incorporating best practices from Monarch Money while maintaining the existing Zambian market focus.

### Key Objectives
- ✅ Complete merchant CRUD operations with intuitive UI
- 🎨 Custom merchant icons/logos with default fallbacks
- 🔗 Seamless integration with transactions, budgets, and reports
- 🧹 Duplicate detection and merchant merging
- 📊 Merchant analytics and spending insights
- 🎯 Smart categorization and merchant rules

---

## Current State Analysis

### Existing Implementation

#### Database Schema
**Merchants Table** (`shared/schema.ts:334-345`)
```typescript
{
  id: uuid (PK)
  householdId: uuid (FK) → households
  name: varchar(255)
  logoUrl: text (nullable)
  transactionCount: integer (default 0)
  lastTransactionDate: date (nullable)
  createdAt: timestamp
  updatedAt: timestamp
}
```

**Merchant Aliases Table** (`shared/schema.ts:347-354`)
```typescript
{
  id: uuid (PK)
  merchantId: uuid (FK) → merchants (cascade delete)
  aliasName: varchar(255)
  createdAt: timestamp
}
```

#### Backend Capabilities
**Existing API Endpoints** (`server/routes/merchants.ts`)
- ✅ `GET /api/merchants` - List all merchants
- ✅ `POST /api/merchants/seed` - Seed 70+ Zambian merchants
- ✅ `GET /api/merchants/similar/:id` - Find duplicate merchants
- ✅ `GET /api/merchants/:id` - Get merchant details with aliases
- ✅ `PUT /api/merchants/:id` - Update merchant (name, logo)
- ✅ `POST /api/merchants/:id/merge` - Merge merchants

**Repository Methods** (`server/repositories/MerchantRepository.ts`)
- ✅ `findByHousehold()`, `findById()`, `search()`
- ✅ `create()`, `update()`, `delete()`
- ✅ `merge()`, `addAlias()`, `getAliases()`
- ✅ `incrementTransactionCount()`, `updateLastTransactionDate()`

#### Frontend Implementation
**Merchant Management UI** (`client/src/pages/settings/sections/MerchantsSection/index.tsx`)
- ✅ Merchant list with search and sort
- ✅ Logos displayed (8x8px rounded images or Store icon fallback)
- ✅ Transaction count display
- ✅ Merge functionality with dropdown selector
- ⚠️ **Edit dialog not implemented** (button exists but no modal)
- ❌ **No manual add merchant dialog**
- ❌ **No delete functionality**
- ❌ **No category/tag assignment**

**Transaction Integration**
- ✅ Merchant name field in AddTransactionModal (plain text input)
- ✅ Merchant display in transaction list (avatar with first letter)
- ❌ **No autocomplete/dropdown suggestions**
- ❌ **No merchant quick-add from transaction form**

#### Key Gaps
1. **No Create Merchant UI** - Cannot manually add new merchants
2. **No Edit Modal** - Cannot edit merchant details (name, logo, category)
3. **Limited Logos** - Uses Google Favicon API, no custom upload
4. **No Autocomplete** - Transaction form doesn't suggest merchants
5. **No Categories** - Merchants lack category/industry classification
6. **No Analytics** - No merchant spending insights or reports
7. **No Rules Integration** - Limited merchant-based automation

---

## Monarch Money Feature Analysis

Based on research from [Monarch Money documentation](https://help.monarch.com/hc/en-us), here are their merchant features:

### 1. Merchant Management
- **Custom Merchant Creation**: Create merchants manually from transactions
- **Edit Merchant Details**: Click "edit merchant details" from transaction or merchant settings
- **Custom Logos**: Upload custom images/logos for merchants and accounts
- **Merchant Merging**: Merge duplicate merchants in Settings → Merchants
- **Merchant Profiles**: Each merchant has a dedicated profile page

### 2. Merchant Logos & Visual Identity
- **Default Logos**: Automatically shown on transactions
- **Custom Upload**: Upload custom images via edit merchant dialog
- **Account Integration**: Same logo system for financial accounts
- **Consistent Display**: Logos appear in transactions, budgets, and reports

### 3. Merchant Categorization
- **Automatic Categorization**: ML-based category assignment as transactions arrive
- **Manual Override**: Customize categories via transaction rules
- **Smart Cleanup**: "WHOLEFDSMRKT" → "Whole Foods" statement text cleanup
- **Category Learning**: System improves categorization over time

### 4. Transaction Rules for Merchants
**Conditions**:
- Merchant name (contains, exactly matches)
- Amount criteria
- Multiple condition combinations

**Actions**:
- Rename merchant
- Update category
- Add tags
- Hide transaction
- Split transaction (via Retail Sync Extension)

### 5. Recurring Merchant Management
- **One Merchant = One Recurring**: Each merchant limited to one recurring transaction
- **Workaround**: Create merchant variants (e.g., "Netflix - Personal", "Netflix - Family")
- **Manual Add**: Search and add recurring transactions by merchant
- **Due Date Tracking**: Separate recurring profiles per merchant subscription

### 6. Advanced Features
- **Retail Sync Extension**: Amazon order syncing with automatic split by category
- **Merchant Analytics**: Spending insights by merchant (implied from categorization)
- **Duplicate Detection**: Scan and merge duplicate merchants
- **Transaction Search**: Search by merchant name across all transactions

### 7. Integration Points
- **Budget Impact**: Merchant transactions affect category budgets
- **Reports**: Merchants included in spending reports and trends
- **Tags**: Merchants can be filtered/organized with tags
- **Goals**: Merchant spending can be excluded/included in savings goals

**Sources**:
- [Editing Transactions](https://help.monarch.com/hc/en-us/articles/360048393532-Editing-Transactions)
- [Creating Transaction Rules](https://help.monarch.com/hc/en-us/articles/360048393372-Creating-Transaction-Rules)
- [Tracking Recurring Expenses](https://help.monarch.com/hc/en-us/articles/4890751141908-Tracking-Recurring-Expenses-and-Bills)
- [Tips & Tricks](https://help.monarchmoney.com/hc/en-us/articles/28953573066260-Transactions-and-Rules-Tips-Tricks)

---

## Requirements

### Functional Requirements

#### FR-1: Merchant CRUD Operations

**FR-1.1: Create Merchant**
- **Description**: Users can manually create new merchants
- **Trigger**:
  - "Add Merchant" button in Settings → Merchants
  - "Create New" option in transaction form merchant dropdown
- **Input Fields**:
  - Name (required, 1-255 characters)
  - Logo URL (optional, valid URL or file upload)
  - Category/Industry (optional, dropdown selection)
  - Default Category (optional, links to transaction categories)
  - Notes (optional, text area)
- **Validation**:
  - Duplicate check: warn if similar merchant name exists
  - URL validation for logo URL
  - Name must be unique within household
- **Output**:
  - Merchant created with auto-generated ID
  - Available immediately in transaction dropdowns
  - Toast notification: "Merchant added successfully"

**FR-1.2: Read/View Merchant**
- **List View** (Settings → Merchants):
  - Display all merchants with logo, name, transaction count
  - Search by name
  - Sort by: name, transaction count, most recent, category
  - Filter by: category, has transactions, has logo
  - Pagination (50 per page)
- **Detail View** (Click on merchant):
  - Merchant profile modal/page showing:
    - Logo (large, editable)
    - Name
    - Category/Industry
    - Transaction count with "View Transactions" link
    - Last transaction date
    - Total spent (all-time, last 30/90/365 days)
    - Aliases list (if any)
    - Associated categories
    - Edit and Delete buttons

**FR-1.3: Update Merchant**
- **Description**: Edit existing merchant details
- **Trigger**: Edit button on merchant list or detail view
- **Editable Fields**:
  - Name
  - Logo (URL or file upload)
  - Category/Industry
  - Default category
  - Notes
- **Special Actions**:
  - Add Alias: Add alternate names for merchant
  - Change Logo: Upload custom image or select from gallery
  - Assign Category: Link to transaction category for auto-categorization
- **Constraints**:
  - Requires "member" role or higher
  - Cannot rename to existing merchant name (suggest merge instead)
- **Side Effects**:
  - Name change affects all future transactions (not historical)
  - Category change can trigger rule update prompt
  - Alias addition improves future merchant matching

**FR-1.4: Delete Merchant**
- **Description**: Remove merchant from system
- **Trigger**: Delete button in merchant detail view
- **Confirmation Dialog**:
  - "Delete {Merchant Name}?"
  - Warning: "X transactions reference this merchant"
  - Options:
    - [Cancel]
    - [Merge with another merchant]
    - [Delete and keep transactions] (sets merchantId to null)
    - [Delete and remove transactions] (dangerous, requires admin)
- **Constraints**:
  - Requires "admin" role if deleting merchant with transactions
  - Cannot delete merchant with active recurring transactions (must update first)
- **Side Effects**:
  - Cascade deletes merchant aliases
  - Sets transaction.merchantId to null (soft delete)
  - Removes from autocomplete suggestions

#### FR-2: Merchant Logos & Icons

**FR-2.1: Logo Sources**
1. **Custom Upload**:
   - Accept: JPG, PNG, SVG, WEBP (max 2MB)
   - Auto-resize to 512x512px, generate 128x128 thumbnail
   - Store in: `uploads/merchant-logos/{householdId}/{merchantId}.{ext}`
   - Return URL: `/uploads/merchant-logos/{householdId}/{merchantId}.{ext}`

2. **Logo URL**:
   - Validate URL format
   - Support external URLs (Clearbit, Logo.dev, Google Favicons)
   - Default template: `https://logo.clearbit.com/{domain}` or `https://img.logo.dev/{domain}`

3. **Default Icons**:
   - Fallback hierarchy:
     1. Custom uploaded logo
     2. Logo URL (if valid)
     3. Category-based icon (Food → Utensils, Fuel → Fuel, Shopping → ShoppingBag)
     4. Generic Store icon

**FR-2.2: Logo Display**
- **Sizes**:
  - Small (24x24): Transaction list, dropdowns
  - Medium (48x48): Merchant cards, forms
  - Large (128x128): Merchant detail view, edit modal
- **Styling**:
  - Rounded corners (border-radius: 8px for cards, 50% for avatars)
  - Background: white or brand-colored circle
  - Border: 1px solid border-color for definition
- **Performance**:
  - Lazy load logos in lists
  - Cache logos in browser
  - Show placeholder skeleton while loading

**FR-2.3: Logo Management**
- **Bulk Logo Update**: Script to update all merchant logos from Logo.dev API
- **Logo Library**: Predefined logo gallery for common Zambian merchants
- **Remove Logo**: Option to remove custom logo and revert to default
- **Household Preference**: Toggle to show/hide merchant logos globally

#### FR-3: Merchant Autocomplete & Suggestions

**FR-3.1: Transaction Form Autocomplete**
- **Location**: AddTransactionModal → Merchant field
- **Behavior**:
  - Replace plain text input with Combobox component
  - Show dropdown on focus or typing
  - Filter merchants by name (case-insensitive, fuzzy match)
  - Display: Logo + Merchant Name + Transaction Count
  - Sort by: Recent usage (last 30 days) → Total transaction count → Alphabetical
- **Features**:
  - "Create New Merchant" option at bottom of dropdown
  - Recent merchants section (last 10 used)
  - Keyboard navigation (arrow keys, Enter to select)
  - Clear button (X icon)

**FR-3.2: Smart Merchant Matching**
- **Auto-Suggest**: As user types merchant name, suggest matches from:
  - Existing merchants (exact and fuzzy match)
  - Merchant aliases
  - Historical transaction merchant names (not yet merchant records)
- **Duplicate Prevention**:
  - Show warning if typing similar merchant name: "Did you mean: {Existing Merchant}?"
  - Highlight similar merchants with green checkmark for selection
- **Quick Add**:
  - "Add as new merchant" button in dropdown
  - Pre-fills name with typed text
  - Opens create merchant modal with name pre-populated

#### FR-4: Merchant Categorization

**FR-4.1: Industry/Business Category**
- **Purpose**: Group merchants by industry for reporting and organization
- **Categories** (Zambian context):
  ```
  Food & Dining
    - Supermarkets (Pick n Pay, Shoprite, Game)
    - Fast Food (Hungry Lion, Debonairs, KFC)
    - Restaurants
    - Cafes & Bakeries

  Transportation
    - Fuel Stations (Puma Energy, Total, Engen)
    - Public Transport
    - Ride Sharing
    - Vehicle Maintenance

  Utilities
    - Electricity (ZESCO)
    - Water (LWSC, Mulonga, Kafubu)
    - Internet (Liquid Telecom)
    - TV Services (DSTV, GOtv)

  Telecommunications
    - Mobile Providers (MTN, Airtel, Zamtel)
    - Airtime Vendors

  Retail & Shopping
    - Clothing & Fashion
    - Electronics (Game, BTL)
    - Home & Garden
    - Pharmacies (Link, Shoppers)

  Banking & Finance
    - Banks (Zanaco, Stanbic, FNB)
    - Mobile Money (MTN Mobile Money, Airtel Money)
    - Insurance
    - Loans

  Healthcare
    - Hospitals & Clinics
    - Pharmacies
    - Medical Labs

  Education
    - Schools
    - Universities
    - Training Centers

  Entertainment
    - Cinemas (Ster-Kinekor)
    - Events
    - Sports

  Other
  ```

**FR-4.2: Default Transaction Category**
- **Purpose**: Auto-assign transaction category when merchant is selected
- **Behavior**:
  - Merchant can have one default transaction category
  - When merchant is selected in transaction form, category auto-fills
  - User can override category manually
  - Updating merchant default category offers to update past transactions (optional bulk update)

**FR-4.3: Category Analytics**
- **Reports**: Group spending by merchant category
- **Budgets**: Option to budget by merchant category (in addition to transaction category)
- **Insights**: "You spent X% more on Supermarkets this month"

#### FR-5: Merchant Merging & Deduplication

**FR-5.1: Duplicate Detection**
- **Auto-Detection**:
  - Scan for similar merchant names (fuzzy match, Levenshtein distance < 3)
  - Detect common patterns:
    - "KFC" vs "KFC Drive Thru" vs "K.F.C."
    - "Shoprite" vs "Shoprite Longacres" vs "Shoprite Northmead"
  - Show "Potential Duplicates" section in Merchants page

**FR-5.2: Merchant Merging**
- **Current Implementation** (preserve):
  - Source merchant name added as alias to target
  - Transaction counts combined
  - Source merchant deleted
- **Enhancements**:
  - **Merge Preview Modal**:
    - Show side-by-side comparison:
      - Logo (choose which to keep)
      - Name (editable, defaults to target name)
      - Transaction counts (shows combined total)
      - Aliases (merged list)
      - Categories (choose primary)
    - "Review Transactions" link to see affected transactions
  - **Bulk Merge**:
    - Select multiple merchants
    - Merge all into one target merchant
    - Checkbox selection in merchant list
  - **Undo Merge** (optional):
    - Store merge history for 30 days
    - Allow undo with "Restore {Source Merchant}" action

**FR-5.3: Merchant Aliases**
- **Management**:
  - View aliases in merchant detail view
  - Add alias manually
  - Delete alias (requires confirmation)
- **Matching**:
  - Aliases used in autocomplete matching
  - Transaction import uses aliases for merchant recognition
- **Display**:
  - Show "Also known as: {Alias 1}, {Alias 2}" in merchant detail
  - Alias count badge on merchant card

#### FR-6: Merchant Analytics & Insights

**FR-6.1: Merchant Spending Report**
- **Page**: New "Merchants" tab in Reports section
- **Display**:
  - Table view:
    - Merchant | Logo | Category | Total Spent | Transaction Count | Avg per Transaction
  - Chart view:
    - Top 10 merchants pie chart
    - Spending trend by merchant (line chart)
  - Filters:
    - Date range
    - Merchant category
    - Min/max amount
    - Sort options

**FR-6.2: Merchant Detail Analytics**
- **Location**: Merchant detail view or dedicated merchant analytics page
- **Metrics**:
  - Total spent (all-time, MTD, YTD, last 30/90/365 days)
  - Transaction count (with same date breakdowns)
  - Average transaction amount
  - Frequency (transactions per month)
  - Spending trend chart (last 12 months)
  - Category breakdown (if merchant used in multiple categories)
- **Transaction List**:
  - Searchable/filterable list of all transactions for merchant
  - Export to CSV
  - Bulk edit transactions

**FR-6.3: Merchant Insights**
- **Dashboard Widget**: "Top Merchants This Month"
  - Show top 5 merchants by spending
  - Click to view merchant detail
- **Notifications**:
  - "You've spent 50% more at {Merchant} this month" (if exceeds threshold)
  - "New merchant detected: {Merchant}" (first transaction)
- **Trends**:
  - "You shop at {Merchant} every {X} days on average"
  - "Your spending at {Merchant} has increased/decreased {Y}% this quarter"

#### FR-7: Merchant Rules & Automation

**FR-7.1: Merchant-Based Rules**
- **Existing** (preserve):
  - Condition: `merchant_name` (contains, exactly matches)
  - Action: `rename_merchant`
- **New Conditions**:
  - `merchant_category` (is, is not)
  - `merchant_name` with operators: (starts with, ends with, regex)
  - `merchant_transaction_count` (greater than, less than)
- **New Actions**:
  - `set_merchant` - Assign/change merchant
  - `set_merchant_category` - Auto-categorize transaction based on merchant
  - `add_merchant_alias` - Add alias when similar merchant detected
  - `merge_merchant` - Auto-merge with target merchant
  - `create_merchant` - Create new merchant if not exists

**FR-7.2: Smart Merchant Recognition**
- **Transaction Import**:
  - Extract merchant name from transaction description
  - Fuzzy match against existing merchants
  - If match score > 80%, auto-assign merchant
  - If match score 60-80%, suggest merchant (user confirms)
  - If < 60%, create new merchant or leave blank
- **Cleanup Rules**:
  - "SHOPRITE #123 LONGACRES" → "Shoprite Longacres"
  - "POS PURCHASE KFC ARCADES" → "KFC"
  - Remove transaction IDs, reference numbers, dates from merchant names

#### FR-8: Integration with Other Features

**FR-8.1: Transactions Integration**
- **Display**:
  - Show merchant logo (24x24) in transaction list
  - Merchant name as primary identifier
  - Click merchant to filter transactions by that merchant
- **Filters**:
  - Merchant dropdown in FiltersModal
  - Multi-select merchants
  - Search merchants in filter
- **Quick Actions**:
  - "View all transactions for {Merchant}" link
  - Right-click merchant → "Edit Merchant", "View Details", "Merge with..."

**FR-8.2: Budget Integration**
- **Merchant Budgets** (optional):
  - Create budget for specific merchant (e.g., "Shoprite: K2000/month")
  - Show merchant spending vs budget in merchant detail
  - Warning when approaching merchant budget limit
- **Category Budgets**:
  - Merchant transactions count toward category budgets
  - Merchant category affects budget allocation
- **Budget Reports**:
  - Show top merchants by budget category
  - "Groceries budget: 60% spent at Shoprite, 20% at Pick n Pay, 20% at Game"

**FR-8.3: Recurring Transactions**
- **Merchant Assignment**:
  - Recurring transactions have merchant field
  - Auto-fill merchant from template
  - Show merchant logo in recurring list
- **Multiple Subscriptions**:
  - Allow multiple recurring transactions per merchant
  - Distinguish by notes or custom name suffix
  - Example: "MTN Mobile Money - Airtime" vs "MTN Mobile Money - Data"

**FR-8.4: Reports Integration**
- **Merchant Dimension**:
  - All reports support "Group by Merchant" option
  - Merchant filter in report filters
  - Merchant logo in charts/tables
- **Custom Reports**:
  - "Top 10 Merchants by Spending"
  - "Merchant Category Breakdown"
  - "Merchant Spending Trends"

**FR-8.5: Goals Integration**
- **Exclusions**:
  - Exclude specific merchants from goal calculations
  - Example: Exclude ZESCO from "Discretionary Spending" goal
- **Goal-Specific Merchants**:
  - Track merchant spending toward specific goal
  - Example: "Shoprite spending toward Groceries Budget goal"

**FR-8.6: Tags Integration**
- **Merchant Tags**:
  - Tag merchants (e.g., "Favorite", "Subscription", "Avoid")
  - Filter merchants by tag
  - Auto-tag transactions when merchant is tagged
- **Transaction Tags**:
  - Rules can add tags based on merchant
  - Example: Tag all MTN transactions with "Mobile"

---

## Technical Specifications

### Database Changes

#### Schema Updates

**1. Add Category Field to Merchants Table**
```sql
ALTER TABLE merchants
ADD COLUMN category VARCHAR(100),
ADD COLUMN default_category_id UUID REFERENCES categories(id),
ADD COLUMN notes TEXT,
ADD COLUMN is_active BOOLEAN DEFAULT TRUE,
ADD COLUMN icon_type VARCHAR(20) DEFAULT 'logo', -- 'logo', 'icon', 'emoji'
ADD COLUMN custom_icon TEXT; -- For emoji or custom icon identifier

CREATE INDEX idx_merchants_category ON merchants(category);
CREATE INDEX idx_merchants_default_category ON merchants(default_category_id);
CREATE INDEX idx_merchants_household_active ON merchants(household_id, is_active);
```

**2. Create Merchant Logo Uploads Table**
```sql
CREATE TABLE merchant_logo_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  uploaded_by UUID REFERENCES users(id),
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_merchant_logo_uploads_merchant ON merchant_logo_uploads(merchant_id);
```

**3. Create Merchant Merge History Table** (for undo functionality)
```sql
CREATE TABLE merchant_merge_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_merchant_id UUID NOT NULL,
  source_merchant_name VARCHAR(255) NOT NULL,
  target_merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  merged_by UUID REFERENCES users(id),
  merged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  can_undo BOOLEAN DEFAULT TRUE,
  undo_expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days')
);

CREATE INDEX idx_merchant_merge_history_target ON merchant_merge_history(target_merchant_id);
CREATE INDEX idx_merchant_merge_history_can_undo ON merchant_merge_history(can_undo, undo_expires_at);
```

### API Endpoints

#### New Endpoints

```typescript
// Create merchant
POST /api/merchants
Body: { name, logoUrl?, category?, defaultCategoryId?, notes?, customIcon? }
Response: { success, data: { merchant } }

// Delete merchant
DELETE /api/merchants/:id
Query: { action: 'soft' | 'hard' | 'merge', mergeTargetId?: string }
Response: { success, data: { deletedCount, affectedTransactions } }

// Upload merchant logo
POST /api/merchants/:id/logo
Body: FormData with 'logo' file
Response: { success, data: { logoUrl, thumbnailUrl } }

// Delete merchant logo
DELETE /api/merchants/:id/logo
Response: { success, data: { merchant } }

// Get merchant analytics
GET /api/merchants/:id/analytics
Query: { startDate?, endDate?, groupBy?: 'day' | 'month' }
Response: { success, data: { totalSpent, transactionCount, avgTransaction, trend[] } }

// Get merchant transactions
GET /api/merchants/:id/transactions
Query: { limit?, offset?, startDate?, endDate?, categoryId? }
Response: { success, data: { transactions[], pagination } }

// Autocomplete merchant search
GET /api/merchants/autocomplete
Query: { q, limit? }
Response: { success, data: { merchants[], suggestions[] } }

// Get potential duplicates
GET /api/merchants/duplicates
Response: { success, data: { groups: [{ merchants[], similarity }] } }

// Undo merchant merge
POST /api/merchants/merge/:historyId/undo
Response: { success, data: { restoredMerchant, target } }
```

### Backend Services

#### MerchantService.ts (New)
```typescript
class MerchantService {
  // Create merchant with validation and duplicate check
  async createMerchant(data: CreateMerchantInput, householdId: string): Promise<Merchant>

  // Find similar merchants using fuzzy matching
  async findSimilarMerchants(name: string, householdId: string): Promise<Merchant[]>

  // Upload and process merchant logo
  async uploadLogo(merchantId: string, file: File, userId: string): Promise<LogoUpload>

  // Get merchant analytics
  async getAnalytics(merchantId: string, dateRange: DateRange): Promise<MerchantAnalytics>

  // Detect duplicate merchants
  async detectDuplicates(householdId: string): Promise<MerchantGroup[]>

  // Merge merchants with history tracking
  async mergeWithHistory(sourceId: string, targetId: string, userId: string): Promise<MergeResult>

  // Undo merchant merge
  async undoMerge(historyId: string): Promise<Merchant>

  // Smart merchant name cleanup
  cleanMerchantName(rawName: string): string
}
```

#### LogoService.ts (New)
```typescript
class LogoService {
  // Upload and resize logo
  async uploadLogo(file: File, merchantId: string): Promise<{ url, thumbnailUrl }>

  // Generate thumbnail
  async generateThumbnail(sourceUrl: string, size: number): Promise<string>

  // Fetch logo from external API
  async fetchLogoFromAPI(domain: string, provider: 'clearbit' | 'logodev'): Promise<string>

  // Delete logo files
  async deleteLogo(logoPath: string): Promise<void>

  // Get default icon for category
  getDefaultIcon(category: string): string
}
```

### Frontend Components

#### New Components

**1. AddMerchantModal**
- Location: `client/src/components/merchants/AddMerchantModal.tsx`
- Props: `{ open, onOpenChange, onSuccess? }`
- Features:
  - Form with name, logo (upload/URL), category, default category, notes
  - Logo preview with upload button
  - Category dropdown with search
  - Duplicate warning if similar merchant exists
  - Submit creates merchant and closes modal

**2. EditMerchantModal**
- Location: `client/src/components/merchants/EditMerchantModal.tsx`
- Props: `{ merchant, open, onOpenChange, onSuccess? }`
- Features:
  - Pre-filled form with merchant data
  - Logo management (upload, change URL, remove)
  - Alias management section
  - Transaction count display (read-only)
  - Delete merchant button (with confirmation)

**3. MerchantCombobox**
- Location: `client/src/components/merchants/MerchantCombobox.tsx`
- Props: `{ value, onChange, placeholder?, onCreate? }`
- Features:
  - Searchable dropdown with merchant logos
  - Recent merchants section
  - "Create New Merchant" option
  - Keyboard navigation
  - Fuzzy search with highlighting

**4. MerchantDetailView**
- Location: `client/src/components/merchants/MerchantDetailView.tsx`
- Props: `{ merchantId }`
- Features:
  - Large logo display
  - Merchant info (name, category, transaction count)
  - Analytics cards (total spent, avg transaction, frequency)
  - Spending trend chart
  - Transaction list with filters
  - Edit and Delete buttons

**5. MerchantAnalyticsWidget**
- Location: `client/src/components/merchants/MerchantAnalyticsWidget.tsx`
- Props: `{ merchantId, dateRange? }`
- Features:
  - Total spent card
  - Transaction count card
  - Average transaction card
  - Spending trend mini-chart

**6. DuplicateMerchantsPanel**
- Location: `client/src/components/merchants/DuplicateMerchantsPanel.tsx`
- Features:
  - List of duplicate merchant groups
  - Similarity percentage display
  - Bulk select and merge
  - Ignore duplicate option

#### Updated Components

**1. AddTransactionModal** (Modify)
- Replace merchant name `<Input>` with `<MerchantCombobox>`
- Add `onCreate` handler to create merchant inline
- Auto-fill category when merchant selected (if merchant has default category)

**2. FiltersModal** (Enhance)
- Populate merchant section with actual merchant data
- Multi-select merchant filter
- Show merchant logos in filter items

**3. TransactionListItem** (Enhance)
- Show merchant logo (24x24) instead of first-letter avatar
- Click merchant name → filter by merchant or open merchant detail

### Hooks & State Management

```typescript
// client/src/hooks/useMerchants.ts
export function useMerchants(filters?: MerchantFilters)
export function useMerchant(merchantId: string)
export function useCreateMerchant()
export function useUpdateMerchant()
export function useDeleteMerchant()
export function useMerchantAutocomplete(query: string)
export function useMerchantAnalytics(merchantId: string, dateRange: DateRange)
export function useDuplicateMerchants()
export function useMergeMerchants()
export function useUndoMerge()
export function useUploadMerchantLogo()
```

---

## UI/UX Requirements

### Design Principles
1. **Consistency**: Match existing design system (Radix UI, Tailwind, Lucide icons)
2. **Clarity**: Clear merchant identification with logos/icons
3. **Efficiency**: Quick merchant selection with autocomplete
4. **Feedback**: Immediate visual feedback for actions (toast, loading states)
5. **Error Prevention**: Duplicate warnings, confirmation dialogs for destructive actions

### Visual Design

#### Color Palette
- **Merchant Primary**: Rose (rose-500) - matches existing accent
- **Category Colors**: Map to existing category group colors
- **Logo Background**: White or category color (light shade)
- **Fallback Icon**: Rose-100 background, rose-500 icon

#### Typography
- **Merchant Name**: font-medium, text-sm (lists), text-lg (detail view)
- **Transaction Count**: text-xs, text-muted-foreground
- **Category**: text-xs, uppercase, tracking-wide

#### Spacing
- **Logo Sizes**: 24px (list), 48px (cards), 128px (detail/modal)
- **Card Padding**: p-3 (list items), p-4 (modals)
- **Gap**: gap-2 (tight), gap-3 (default), gap-4 (spacious)

### Interaction Patterns

#### Merchant Selection Flow
1. User clicks merchant field in transaction form
2. Dropdown opens with:
   - Recent merchants (last 10)
   - Divider
   - All merchants (filtered by search)
   - Divider
   - "Create New Merchant" option
3. User types to filter
4. User selects merchant or creates new
5. If merchant has default category, auto-fill category field
6. If creating new, show inline form or open modal

#### Merchant Editing Flow
1. User navigates to Settings → Merchants
2. User searches/sorts to find merchant
3. User hovers merchant card → Edit button appears
4. User clicks Edit → EditMerchantModal opens
5. User modifies fields (logo upload, name change, etc.)
6. User clicks Save → Changes applied, toast notification
7. Modal closes, merchant list refreshes

#### Merchant Merging Flow
1. User identifies duplicate merchants (manually or via suggestions)
2. User clicks Merge button on source merchant
3. Merge dialog shows with dropdown to select target merchant
4. User selects target → Preview modal shows comparison
5. User reviews changes, chooses logo/name to keep
6. User confirms → Merge executes, success toast shows
7. Merchant list refreshes, merged merchant now shows combined data

### Responsive Design
- **Mobile** (< 640px):
  - Stack merchant cards vertically
  - Show abbreviated transaction count
  - Collapse edit buttons into menu (MoreHorizontal icon)
- **Tablet** (640-1024px):
  - 2-column merchant grid
  - Show full merchant info
- **Desktop** (> 1024px):
  - 3-column merchant grid or full list view
  - Show all actions inline

---

## Integration Requirements

### Transaction System Integration

**Requirements**:
- ✅ Merchant field in transaction schema (existing: `merchantId`)
- ✅ Merchant autocomplete in AddTransactionModal
- ✅ Merchant logo display in transaction lists
- ✅ Merchant filter in transaction filters
- ✅ "View transactions for merchant" link in merchant detail
- ✅ Auto-assign category when merchant selected (if merchant has default category)

**Implementation**:
- Modify `AddTransactionModal` to use `MerchantCombobox`
- Update transaction list components to show merchant logos
- Enhance `FiltersModal` merchant section
- Add merchant click handler to filter transactions

### Budget System Integration

**Requirements**:
- ✅ Merchant transactions count toward category budgets
- ⚠️ Optional: Merchant-specific budgets (future enhancement)
- ✅ Budget reports show spending by merchant
- ✅ Budget alerts include merchant info ("80% of Groceries budget spent at Shoprite")

**Implementation**:
- No database changes needed (transactions already linked to merchants and categories)
- Update budget reports to include merchant dimension
- Add merchant breakdown to budget detail view

### Rules Engine Integration

**Requirements**:
- ✅ Merchant name condition (existing)
- ✅ Merchant category condition (new)
- ✅ Rename merchant action (existing)
- ✅ Set merchant action (new)
- ✅ Set category based on merchant (new)

**Implementation**:
- Extend `RuleService` with new condition types
- Add new action types for merchant operations
- Update `RulesSection` UI with merchant-related rule options

### Reports & Analytics Integration

**Requirements**:
- ✅ New "Merchants" tab in Reports section
- ✅ Top merchants by spending report
- ✅ Merchant category breakdown report
- ✅ Merchant spending trends chart
- ✅ "Group by Merchant" option in all reports
- ✅ Export merchant report to CSV

**Implementation**:
- Create `MerchantReportsPage` component
- Add merchant aggregation queries to report service
- Update existing report components to support merchant grouping

### Recurring Transactions Integration

**Requirements**:
- ✅ Merchant field in recurring transaction schema (existing)
- ✅ Multiple recurring transactions per merchant (update documentation)
- ✅ Merchant logo in recurring transaction list
- ✅ Auto-fill merchant when creating recurring from transaction

**Implementation**:
- Update `RecurringPage` to show merchant logos
- Modify recurring transaction form to include merchant combobox
- Update documentation to clarify multiple subscriptions per merchant

### Goals Integration

**Requirements**:
- ✅ Exclude merchant from goal calculations (checkbox in merchant edit)
- ✅ Include merchant in specific goal (link merchant to goal)
- ✅ Goal progress by merchant (show which merchants contribute to goal)

**Implementation**:
- Add `excludeFromGoals` boolean to merchants table
- Add `goalMerchants` junction table for merchant-goal links
- Update goal calculation logic to respect merchant exclusions

---

## Implementation Priorities

### Phase 1: Foundation (High Priority)
**Goal**: Core merchant CRUD with improved UI

**Tasks**:
1. ✅ Database migration for new merchant fields (category, notes, defaultCategoryId)
2. ✅ Create `AddMerchantModal` component
3. ✅ Create `EditMerchantModal` component
4. ✅ Implement POST `/api/merchants` endpoint
5. ✅ Implement DELETE `/api/merchants/:id` endpoint
6. ✅ Update `MerchantsSection` to include Add and Edit functionality
7. ✅ Add merchant category dropdown with predefined categories

**Acceptance Criteria**:
- Users can manually create new merchants
- Users can edit existing merchants (name, logo URL, category, notes)
- Users can delete merchants (with confirmation and transaction handling)
- Merchant list shows category badges
- All CRUD operations have proper error handling and toast notifications

**Estimated Effort**: 3-5 days

---

### Phase 2: Merchant Autocomplete (High Priority)
**Goal**: Improve transaction entry with merchant suggestions

**Tasks**:
1. ✅ Create `MerchantCombobox` component with search and filter
2. ✅ Implement GET `/api/merchants/autocomplete` endpoint
3. ✅ Replace merchant input in `AddTransactionModal` with combobox
4. ✅ Add "Create New Merchant" option in combobox dropdown
5. ✅ Show merchant logo in dropdown items
6. ✅ Implement recent merchants section (last 10 used)
7. ✅ Auto-fill category when merchant selected (if defaultCategoryId set)

**Acceptance Criteria**:
- Transaction form has searchable merchant dropdown
- Typing filters merchants in real-time
- Recent merchants shown at top
- Selecting merchant auto-fills category (if configured)
- Can create new merchant inline without leaving transaction form

**Estimated Effort**: 2-3 days

---

### Phase 3: Merchant Logos (Medium Priority)
**Goal**: Custom logo upload and improved visual display

**Tasks**:
1. ✅ Create `merchant_logo_uploads` table migration
2. ✅ Implement `LogoService` with upload, resize, thumbnail generation
3. ✅ Add POST `/api/merchants/:id/logo` endpoint (multer + sharp)
4. ✅ Add logo upload UI to `EditMerchantModal`
5. ✅ Update merchant display components to show uploaded logos
6. ✅ Implement logo fallback hierarchy (upload → URL → category icon → Store icon)
7. ✅ Add DELETE `/api/merchants/:id/logo` endpoint

**Acceptance Criteria**:
- Users can upload custom merchant logos (JPG, PNG, SVG, WEBP)
- Logos auto-resize to 512x512 with 128x128 thumbnail
- Uploaded logos display throughout app (transactions, lists, reports)
- Fallback icons show when no logo available (category-based or generic)
- Logos stored securely in `uploads/merchant-logos/{householdId}/`

**Estimated Effort**: 3-4 days

---

### Phase 4: Merchant Analytics (Medium Priority)
**Goal**: Spending insights by merchant

**Tasks**:
1. ✅ Create `MerchantDetailView` component
2. ✅ Implement GET `/api/merchants/:id/analytics` endpoint
3. ✅ Implement GET `/api/merchants/:id/transactions` endpoint
4. ✅ Create spending trend chart component
5. ✅ Add analytics cards (total spent, avg transaction, frequency)
6. ✅ Create transaction list with filters in merchant detail view
7. ✅ Add "View Merchant Details" link from transaction list

**Acceptance Criteria**:
- Clicking merchant name opens detail view
- Detail view shows total spent, transaction count, average
- Spending trend chart displays last 12 months
- Transaction list shows all transactions for merchant with filters
- Export merchant transactions to CSV

**Estimated Effort**: 4-5 days

---

### Phase 5: Duplicate Detection & Enhanced Merging (Medium Priority)
**Goal**: Better duplicate handling with preview and undo

**Tasks**:
1. ✅ Implement fuzzy matching algorithm (Levenshtein distance)
2. ✅ Add GET `/api/merchants/duplicates` endpoint
3. ✅ Create `DuplicateMerchantsPanel` component
4. ✅ Enhance merge flow with preview modal showing comparison
5. ✅ Create `merchant_merge_history` table migration
6. ✅ Implement merge with history tracking
7. ✅ Add POST `/api/merchants/merge/:historyId/undo` endpoint
8. ✅ Add "Undo Merge" option in merchant detail view (if within 30 days)

**Acceptance Criteria**:
- Potential duplicates automatically detected and shown
- Merge preview shows side-by-side comparison of merchants
- User can choose which logo/name to keep in merge
- Merge history stored for 30 days with undo option
- Undo restores source merchant and reverts transaction updates

**Estimated Effort**: 4-5 days

---

### Phase 6: Merchant Reports (Low Priority)
**Goal**: Dedicated merchant reporting and insights

**Tasks**:
1. ✅ Create "Merchants" tab in Reports section
2. ✅ Implement merchant spending report (table + chart)
3. ✅ Add merchant category breakdown report
4. ✅ Add spending trend by merchant chart
5. ✅ Implement "Group by Merchant" option in existing reports
6. ✅ Create dashboard widget "Top Merchants This Month"
7. ✅ Add merchant filter to all reports

**Acceptance Criteria**:
- New Merchants tab in Reports shows top merchants by spending
- Reports support grouping by merchant
- Merchant category breakdown available
- Dashboard widget shows top 5 merchants for current month
- All reports filterable by merchant

**Estimated Effort**: 3-4 days

---

### Phase 7: Enhanced Rules & Automation (Low Priority)
**Goal**: Advanced merchant-based rules

**Tasks**:
1. ✅ Add merchant category condition to rules engine
2. ✅ Add `set_merchant` action to rules
3. ✅ Add `set_category_from_merchant` action
4. ✅ Implement smart merchant name cleanup (remove IDs, dates, etc.)
5. ✅ Add auto-suggest merchant during transaction import
6. ✅ Create merchant recognition from transaction descriptions

**Acceptance Criteria**:
- Rules can match on merchant category
- Rules can auto-assign merchant to transactions
- Rules can set category based on merchant's default category
- Transaction import suggests merchants from description
- Merchant names auto-cleaned to remove noise

**Estimated Effort**: 3-4 days

---

### Phase 8: Polish & Optimization (Ongoing)
**Goal**: Performance, UX improvements, edge cases

**Tasks**:
1. ✅ Add bulk operations (bulk delete, bulk merge, bulk categorize)
2. ✅ Implement merchant logo lazy loading and caching
3. ✅ Add keyboard shortcuts for merchant management
4. ✅ Optimize merchant autocomplete query performance (indexing)
5. ✅ Add merchant import/export (CSV)
6. ✅ Create merchant onboarding flow for new users (seed Zambian merchants)
7. ✅ Add merchant search across all sections (global search)

**Acceptance Criteria**:
- Merchant list loads quickly with 1000+ merchants
- Autocomplete responds in < 100ms
- Bulk operations available for common tasks
- CSV import/export working
- New users guided to seed merchants or create first merchant

**Estimated Effort**: Ongoing

---

## Success Metrics

### Key Performance Indicators (KPIs)

1. **Merchant Adoption**:
   - Target: 80%+ of transactions have merchant assigned
   - Measure: % transactions with non-null merchantId

2. **Autocomplete Usage**:
   - Target: 70%+ of transactions use autocomplete to select merchant
   - Measure: % transactions created via combobox vs manual entry

3. **Duplicate Reduction**:
   - Target: < 5% duplicate merchants after 3 months
   - Measure: Duplicate detection rate decreasing over time

4. **Logo Coverage**:
   - Target: 60%+ of merchants have logos (uploaded or URL)
   - Measure: % merchants with non-null logoUrl or upload

5. **Merchant Management Engagement**:
   - Target: 50%+ of users visit Merchants section monthly
   - Measure: Unique users accessing /settings/merchants per month

6. **Rule Automation**:
   - Target: 40%+ of transactions auto-categorized by merchant rules
   - Measure: % transactions with category set via merchant-based rule

---

## Appendices

### A. Wireframes

#### Merchant List View
```
┌─────────────────────────────────────────────────────────────┐
│ Merchants                                    [+ Add Merchant]│
├─────────────────────────────────────────────────────────────┤
│ [🔍 Search merchants...]        [Sort: By Transactions ▼]   │
├─────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────┐   │
│ │ [🏪] Shoprite                          [Edit] [Merge] │   │
│ │      Supermarkets • 45 transactions                   │   │
│ └──────────────────────────────────────────────────────┘   │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ [⚡] ZESCO                             [Edit] [Merge] │   │
│ │      Utilities • 12 transactions                      │   │
│ └──────────────────────────────────────────────────────┘   │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ [📱] MTN Mobile Money                  [Edit] [Merge] │   │
│ │      Telecommunications • 38 transactions             │   │
│ └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

#### Add Merchant Modal
```
┌─────────────────────────────────────────────┐
│ Add Merchant                            [X] │
├─────────────────────────────────────────────┤
│                                             │
│ Merchant Name *                             │
│ [_________________________________]         │
│                                             │
│ Logo                                        │
│ ┌──────────┐                                │
│ │  [🏪]    │ [Upload Image] [Paste URL]    │
│ └──────────┘                                │
│                                             │
│ Category                                    │
│ [Select category... ▼]                     │
│                                             │
│ Default Transaction Category (Optional)     │
│ [Select category... ▼]                     │
│                                             │
│ Notes                                       │
│ [_________________________________]         │
│                                             │
│              [Cancel]  [Add Merchant]       │
└─────────────────────────────────────────────┘
```

#### Merchant Combobox in Transaction Form
```
┌─────────────────────────────────────────────┐
│ Merchant                                    │
│ [Shoprite___________________ ▼]            │
│ ┌─────────────────────────────────────────┐ │
│ │ Recent                                  │ │
│ │ ┌────────────────────────────────────┐ │ │
│ │ │ [🏪] Shoprite  •  45 transactions  │ │ │
│ │ │ [⚡] ZESCO     •  12 transactions  │ │ │
│ │ └────────────────────────────────────┘ │ │
│ │ ─────────────────────────────────────── │ │
│ │ All Merchants                           │ │
│ │ ┌────────────────────────────────────┐ │ │
│ │ │ [📱] MTN Mobile Money              │ │ │
│ │ │ [🍔] Hungry Lion                   │ │ │
│ │ │ [⛽] Puma Energy                    │ │ │
│ │ └────────────────────────────────────┘ │ │
│ │ ─────────────────────────────────────── │ │
│ │ [+ Create "Shoprite"]                   │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### B. Category Icon Mapping

| Category | Icon (Lucide) | Color |
|----------|---------------|-------|
| Food & Dining - Supermarkets | ShoppingCart | rose-500 |
| Food & Dining - Fast Food | Utensils | orange-500 |
| Food & Dining - Restaurants | UtensilsCrossed | orange-600 |
| Food & Dining - Cafes | Coffee | amber-600 |
| Transportation - Fuel | Fuel | blue-600 |
| Transportation - Public | Bus | blue-500 |
| Transportation - Ride Sharing | Car | blue-400 |
| Utilities - Electricity | Zap | yellow-500 |
| Utilities - Water | Droplet | cyan-500 |
| Utilities - Internet | Wifi | purple-500 |
| Utilities - TV | Tv | indigo-500 |
| Telecommunications - Mobile | Smartphone | violet-500 |
| Retail & Shopping - Clothing | Shirt | pink-500 |
| Retail & Shopping - Electronics | MonitorSmartphone | slate-600 |
| Retail & Shopping - Pharmacy | Pill | red-500 |
| Banking & Finance | Building2 | green-600 |
| Healthcare | Heart | red-600 |
| Education | GraduationCap | blue-700 |
| Entertainment | Film | fuchsia-500 |
| Other | Store | gray-500 |

### C. Validation Rules

**Merchant Name**:
- Required: Yes
- Min length: 1
- Max length: 255
- Pattern: Allow letters, numbers, spaces, hyphens, apostrophes, periods
- Unique: Within household (case-insensitive)

**Logo URL**:
- Required: No
- Pattern: Valid URL (http:// or https://)
- Max length: 2048

**Logo Upload**:
- File types: JPG, JPEG, PNG, SVG, WEBP
- Max size: 2MB
- Dimensions: Auto-resize to 512x512, generate 128x128 thumbnail

**Category**:
- Required: No
- Values: Predefined list from Category enum
- Default: null (uncategorized)

**Default Category ID**:
- Required: No
- Must reference existing category in household

**Notes**:
- Required: No
- Max length: 1000

### D. Error Messages

```typescript
const errorMessages = {
  MERCHANT_NAME_REQUIRED: "Merchant name is required",
  MERCHANT_NAME_TOO_LONG: "Merchant name must be 255 characters or less",
  MERCHANT_NAME_DUPLICATE: "A merchant with this name already exists. Did you mean: {existingMerchant}?",
  LOGO_URL_INVALID: "Logo URL must be a valid http:// or https:// URL",
  LOGO_FILE_TOO_LARGE: "Logo file must be 2MB or smaller",
  LOGO_FILE_INVALID_TYPE: "Logo must be JPG, PNG, SVG, or WEBP format",
  CATEGORY_INVALID: "Invalid category selected",
  DEFAULT_CATEGORY_NOT_FOUND: "Selected default category not found",
  MERCHANT_NOT_FOUND: "Merchant not found",
  MERCHANT_DELETE_WITH_TRANSACTIONS: "Cannot delete merchant with {count} transactions. Please merge with another merchant or remove transactions first.",
  MERGE_SAME_MERCHANT: "Cannot merge merchant with itself",
  MERGE_TARGET_NOT_FOUND: "Target merchant not found",
  MERGE_UNDO_EXPIRED: "Merge undo period has expired (30 days)",
};
```

---

## Conclusion

This requirements document outlines a comprehensive merchant management system inspired by Monarch Money's best practices while tailored for the Zambian market. The phased implementation approach prioritizes core functionality (CRUD, autocomplete, logos) before advanced features (analytics, reporting, automation).

**Next Steps**:
1. Review and approve requirements
2. Refine priorities based on user feedback
3. Begin Phase 1 implementation (Foundation)
4. Iterate based on testing and user adoption metrics

**Document Maintenance**:
- This document should be updated as requirements evolve
- Track implementation progress against phases
- Gather user feedback after each phase completion
- Update KPIs quarterly based on actual usage data
