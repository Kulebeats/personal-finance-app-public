# Investment Analysis & Tracking Requirements v2.0
## Enhanced for Zambian Market Context

## 1. Overview

A robust investment tracking feature modeled after Monarch Money, specifically tailored for the Zambian market. This system enables users to track net worth, portfolio performance, and asset allocation across Zambian and international investments, with **first-class multi-currency support**.

---

## 2. Core Features (Monarch-Inspired)

### 2.1 Comprehensive Holdings View
- Detailed list of all securities/assets with:
  - Current value (in ZMW or USD)
  - Quantity held
  - Current price
  - Daily/weekly/monthly change
  - Cost basis & unrealized gain/loss
  - **FX impact** (for USD/ZAR holdings)

### 2.2 Asset Allocation
- Visual breakdown by:
  - **Asset Class**: Stocks, Bonds, Cash, Forex, Real Estate, Alternative
  - **Geography**: Local (LuSE) vs Offshore (NYSE, JSE)
  - **Currency**: ZMW vs USD vs ZAR exposure
  - **Liquidity**: Liquid vs Illiquid assets

### 2.3 Performance Tracking
- Time-weighted returns with customizable periods (1W, 1M, 3M, 6M, YTD, 1Y, 5Y, All)
- Benchmark comparisons:
  - **LuSE All Share Index** (primary)
  - **BoZ 91-day T-Bill Rate** (risk-free)
  - **ZMW Inflation Rate** (real returns)
  - **USD/ZMW FX Rate** (currency impact)
  - S&P 500 (offshore comparison)

### 2.4 Transaction History
- Investment activities: Buy, Sell, Dividend, Interest, Fees, Transfers
- **Automatic WHT calculations** (15% on dividends)
- FX conversion tracking

---

## 3. Zambian Context Requirements

### 3.1 Multi-Currency Support (CRITICAL)

**Primary Requirement**: Full support for multi-currency portfolios

#### Currency Support
- **ZMW** (Zambian Kwacha) - primary display currency
- **USD** (US Dollar) - common for savings & offshore investments
- **ZAR** (South African Rand) - for JSE stocks
- **GBP** (British Pound) - optional for UK expats

#### Features
- **Separate currency accounts** per investment account
- **Real-time FX rates** from Bank of Zambia API
- **Historical FX tracking** for accurate performance attribution
- **FX gain/loss reporting** (separate from investment returns)
- **Toggle display currency** (view entire portfolio in ZMW or USD)

#### Example Holdings Table
```
Security          | Qty | Price    | Value (USD) | Value (ZMW) | FX Rate | Gain/Loss | FX Impact
------------------|-----|----------|-------------|-------------|---------|-----------|----------
Apple (AAPL)      | 10  | $150.00  | $1,500      | K41,250     | 27.50   | +$200     | -K3,000
CEC (LuSE)        | 500 | K12.50   | $227        | K6,250      | 27.50   | +K1,250   | N/A
GRZ 10Y Bond      | 50  | K1,000   | $1,818      | K50,000     | 27.50   | +K2,500   | N/A
```

### 3.2 Asset Classes

#### 3.2.1 Local Zambian Investments

**LuSE Stocks**
- Listed companies: CEC, SCZ, ZAMEFA, SHOPRITE, LAFARGE, PUMA ENERGY
- Symbol format: `SYMBOL.LuSE` (e.g., `CEC.LuSE`)
- Currency: ZMW
- Manual price updates (LuSE has no real-time feed)

**GRZ Bonds (Government Bonds)**
- Government of Republic of Zambia long-term debt securities
- **Available Tenors**: 2yr, 3yr, 5yr, 7yr, 10yr, 15yr
- **Currency**: ZMW
- **Minimum Investment**: K5,000 (primary market), varies on secondary
- **Coupon Payments**: Semi-annual (every 6 months)
- **Current Yields** (as of Dec 2025):
  - 10-Year: ~17.85% p.a.
  - Rates determined at weekly Tuesday auctions
- **Features Required**:
  - Coupon payment schedule tracking with reminders
  - Accrued interest calculation between payment dates
  - Yield-to-maturity (YTM) calculator
  - Clean price vs dirty price display
  - Secondary market price tracking
  - CSD account linking (Bank of Zambia Central Securities Depository)
  - Bond-backed loan eligibility indicator

**Treasury Bills (T-Bills)**
- Short-term government discount instruments
- **Available Maturities**: 91, 182, 273, 364 days
- **Currency**: ZMW
- **Minimum Investment**: K5,000 (primary market)
- **Pricing**: Sold at discount to face value (zero-coupon)
- **Current Yields** (as of Nov 2025):
  - 91-Day: ~11.50% p.a.
- **15% Withholding Tax** applies at Bank of Zambia
- **Features Required**:
  - Discount rate to yield conversion calculator
  - Purchase price calculator: `Price = Face Value × (1 - (Rate × Days/360))`
  - Effective yield calculator: `Yield = ((FV - Price) / Price) × (360/Days)`
  - Maturity date countdown with notifications
  - Auto-rollover tracking for reinvestments
  - Net proceeds after WHT calculation

**Unit Trusts**
- Fund families: Madison, Prudential, ABC Asset Management, Investrust
- Types: Money Market, Balanced, Equity, Bond
- Monthly NAV updates
- Management fee tracking (typically 1-2% annually)

**Fixed/Term Deposits**
- Bank-specific savings products
- Banks: Zanaco, Stanbic, FNB, Standard Chartered, Absa, Atlas Mara
- Auto-interest accrual
- Maturity date tracking

**Mobile Money Savings**
- Airtel Money Na Sova (8-12% p.a.)
- MTN Kongola
- Zamtel Kwacha Pafupi
- Daily interest accrual

#### 3.2.2 International Investments

**Offshore Stocks**
- Exchanges: NYSE, NASDAQ, JSE (Johannesburg)
- Accessed via: Pangaea Securities, Stockbrokers Zambia
- Currency: USD (US stocks), ZAR (JSE)
- Auto price updates: Yahoo Finance API

**Forex Trading Accounts**
- Brokers: HotForex, XM, Exness, AFEX Zambia
- Currency pairs: EUR/USD, GBP/USD, USD/ZMW
- Real-time P&L tracking
- Leverage disclosure

#### 3.2.3 Alternative Investments

**SACCO/Cooperative Shares**
- Employee cooperatives
- Village banking schemes
- Manual valuation (typically book value)

**Pension Funds (NAPSA & Private Schemes)** - ENHANCED
- **NAPSA (National Pension Scheme Authority)**:
  - Mandatory for all formal sector employees
  - Contribution: 5% employee + 5% employer = 10% of gross salary
  - Track both mandatory and voluntary contributions
  - Import NAPSA annual statements (PDF parsing)
  - Project retirement value based on contribution rate + assumed growth
  - Show employer vs employee contribution split
  - Estimate pension at retirement age (55/60)
- **Private Pension Schemes**:
  - Madison Life pension products
  - Professional Insurance Corporation
  - Voluntary top-ups tracking
- **Features Required**:
  - Contribution history timeline
  - Projected retirement value calculator
  - Statement import (PDF/CSV)
  - Employer contribution matching tracker
  - Retirement readiness score

**Real Estate** (Phase 2)
- Rental properties
- Land holdings
- Valuation updates (manual/annual)

**Agricultural Investments** (Phase 2)
- Livestock
- Crop shares
- Farm partnerships

**Peer-to-Peer Lending** (Phase 2)
- Microfinance investments
- Returns tracking

### 3.3 Institutions

#### Banks
- Zanaco
- Stanbic Bank Zambia
- FNB Zambia
- Standard Chartered Zambia
- Absa Bank Zambia
- Atlas Mara Bank
- Investrust Bank

#### Brokers & Asset Managers
- Pangaea Securities (LuSE + offshore)
- Stockbrokers Zambia (SBZ)
- AFEX Zambia (forex)
- Madison Asset Management
- Prudential Zambia
- ABC Asset Management

#### Pension Providers
- NAPSA
- Madison Life
- Professional Insurance Corporation

#### Mobile Money
- Airtel Money
- MTN Mobile Money
- Zamtel

---

## 4. Technical Requirements

### 4.1 Enhanced Data Model

#### New Tables

**`securities`**
```sql
CREATE TABLE securities (
  id UUID PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,  -- e.g., "CEC.LuSE", "AAPL", "GRZ-10Y"
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL,     -- STOCK, BOND, FOREX, UNIT_TRUST, TERM_DEPOSIT, etc.
  currency VARCHAR(3) NOT NULL,  -- ZMW, USD, ZAR
  exchange VARCHAR(50),          -- LuSE, NYSE, JSE, OTC
  is_offshore BOOLEAN DEFAULT false,
  cusip_isin VARCHAR(20),        -- For international securities
  current_price DECIMAL(15,4),
  last_updated TIMESTAMP,
  withholding_tax_rate DECIMAL(5,2) DEFAULT 15.00,  -- Zambian WHT
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(symbol, exchange)
);
```

**`holdings`**
```sql
CREATE TABLE holdings (
  id UUID PRIMARY KEY,
  household_id UUID REFERENCES households(id),
  account_id UUID REFERENCES accounts(id),
  security_id UUID REFERENCES securities(id),
  quantity DECIMAL(18,8) NOT NULL,
  cost_basis DECIMAL(15,2),      -- Total cost in original currency
  cost_basis_zmw DECIMAL(15,2),  -- Converted to ZMW at acquisition FX rate
  acquired_date DATE,
  acquisition_fx_rate DECIMAL(10,4),  -- FX rate at purchase
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**`security_prices`**
```sql
CREATE TABLE security_prices (
  id UUID PRIMARY KEY,
  security_id UUID REFERENCES securities(id),
  date DATE NOT NULL,
  price DECIMAL(15,4) NOT NULL,
  source VARCHAR(50),  -- 'manual', 'yahoo_finance', 'boz'
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(security_id, date)
);
```

**`investment_transactions`**
```sql
CREATE TABLE investment_transactions (
  id UUID PRIMARY KEY,
  household_id UUID REFERENCES households(id),
  account_id UUID REFERENCES accounts(id),
  holding_id UUID REFERENCES holdings(id),
  security_id UUID REFERENCES securities(id),
  type VARCHAR(50) NOT NULL,  -- BUY, SELL, DIVIDEND, INTEREST, FEE, SPLIT, etc.
  quantity DECIMAL(18,8),
  price DECIMAL(15,4),
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  fx_rate DECIMAL(10,4),      -- Conversion rate to ZMW
  amount_zmw DECIMAL(15,2),   -- Amount in ZMW
  fees DECIMAL(15,2) DEFAULT 0,
  withholding_tax DECIMAL(15,2) DEFAULT 0,
  transaction_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**`fx_rates`**
```sql
CREATE TABLE fx_rates (
  id UUID PRIMARY KEY,
  from_currency VARCHAR(3) NOT NULL,
  to_currency VARCHAR(3) NOT NULL,
  rate DECIMAL(10,4) NOT NULL,
  date DATE NOT NULL,
  source VARCHAR(50) NOT NULL,  -- 'boz', 'xe.com', 'manual'
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(from_currency, to_currency, date)
);
```

**`currency_accounts`**
```sql
CREATE TABLE currency_accounts (
  id UUID PRIMARY KEY,
  account_id UUID REFERENCES accounts(id),
  currency VARCHAR(3) NOT NULL,
  opening_balance DECIMAL(15,2) DEFAULT 0,
  current_balance DECIMAL(15,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(account_id, currency)
);
```

**`portfolio_benchmarks`**
```sql
CREATE TABLE portfolio_benchmarks (
  id UUID PRIMARY KEY,
  code VARCHAR(50) NOT NULL,  -- 'LUSE_ASI', 'BOZ_TBILL_91D', 'INFLATION_ZMW'
  name VARCHAR(255) NOT NULL,
  description TEXT,
  currency VARCHAR(3),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**`benchmark_values`**
```sql
CREATE TABLE benchmark_values (
  id UUID PRIMARY KEY,
  benchmark_id UUID REFERENCES portfolio_benchmarks(id),
  date DATE NOT NULL,
  value DECIMAL(15,4) NOT NULL,
  source VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(benchmark_id, date)
);
```

#### GRZ Government Securities Tables (NEW)

**Holding-creation cash semantics:** Creating a GRZ bond or T-bill holding is record-only and never moves account cash. Coupon payments and T-bill maturity processing are the only GRZ flows that post income through the shared household ledger.

**`grz_bonds`** - Tracks individual GRZ bond holdings
```sql
CREATE TABLE grz_bonds (
  id UUID PRIMARY KEY,
  household_id UUID REFERENCES households(id),
  account_id UUID REFERENCES accounts(id),

  -- Bond Identification
  isin VARCHAR(20),                    -- e.g., "ZM1000005091"
  bond_name VARCHAR(100) NOT NULL,     -- e.g., "GRZ Bond 13% 27-Dec-2031"
  tenor_years INTEGER NOT NULL,        -- 2, 3, 5, 7, 10, or 15

  -- Purchase Details
  face_value DECIMAL(15,2) NOT NULL,   -- Nominal/par value
  purchase_price DECIMAL(15,2) NOT NULL, -- Price paid (may differ from face)
  purchase_date DATE NOT NULL,
  purchase_yield DECIMAL(6,4),         -- Yield at time of purchase
  acquisition_type VARCHAR(20) DEFAULT 'PRIMARY', -- PRIMARY, SECONDARY

  -- Coupon Details
  coupon_rate DECIMAL(6,4) NOT NULL,   -- Annual coupon rate (e.g., 0.1785 for 17.85%)
  coupon_frequency INTEGER DEFAULT 2,   -- Payments per year (2 = semi-annual)
  first_coupon_date DATE,              -- Date of first coupon payment

  -- Maturity
  maturity_date DATE NOT NULL,

  -- CSD Integration
  csd_account_number VARCHAR(50),      -- Bank of Zambia CSD account
  csd_reference VARCHAR(50),           -- Reference from CSD system

  -- Status
  status VARCHAR(20) DEFAULT 'ACTIVE', -- ACTIVE, MATURED, SOLD
  sold_date DATE,
  sold_price DECIMAL(15,2),
  sold_yield DECIMAL(6,4),

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**`grz_bond_payments`** - Tracks scheduled and received coupon payments
```sql
CREATE TABLE grz_bond_payments (
  id UUID PRIMARY KEY,
  bond_id UUID REFERENCES grz_bonds(id),

  payment_date DATE NOT NULL,          -- Scheduled payment date
  payment_type VARCHAR(20) NOT NULL,   -- COUPON, MATURITY, PARTIAL_REDEMPTION

  -- Amounts
  gross_amount DECIMAL(15,2) NOT NULL, -- Amount before tax
  withholding_tax DECIMAL(15,2) DEFAULT 0, -- 15% WHT on interest
  net_amount DECIMAL(15,2) NOT NULL,   -- Amount after tax

  -- Status
  status VARCHAR(20) DEFAULT 'SCHEDULED', -- SCHEDULED, PAID, MISSED
  actual_payment_date DATE,            -- When actually received

  -- Transaction Links (CRITICAL for income tracking)
  investment_transaction_id UUID REFERENCES investment_transactions(id),  -- Links to investment module
  income_transaction_id UUID REFERENCES transactions(id),  -- Links to main household income

  created_at TIMESTAMP DEFAULT NOW()
);
```

**Coupon-to-Income Integration Behavior:**
When a coupon payment status changes to `PAID`:
1. **Auto-create `investment_transactions` record** with type `INTEREST`
2. **Auto-create `transactions` record** in main household ledger:
   - Category: "Investment Income" or "Bond Interest"
   - Amount: `net_amount` (after WHT)
   - Linked account: Settlement bank account from CSD
3. **Update both foreign keys** in `grz_bond_payments`
4. **Trigger notification** if user has coupon alerts enabled

This ensures bond income appears in:
- Investment performance reports (via `investment_transactions`)
- Household budget/income tracking (via `transactions`)
- Tax reports (WHT already deducted at source)

**`grz_tbills`** - Tracks Treasury Bill holdings
```sql
CREATE TABLE grz_tbills (
  id UUID PRIMARY KEY,
  household_id UUID REFERENCES households(id),
  account_id UUID REFERENCES accounts(id),

  -- T-Bill Identification
  isin VARCHAR(20),
  tbill_name VARCHAR(100) NOT NULL,    -- e.g., "91-Day T-Bill 15-Mar-2026"
  tenor_days INTEGER NOT NULL,          -- 91, 182, 273, or 364

  -- Purchase Details (Discount Basis)
  face_value DECIMAL(15,2) NOT NULL,   -- Par value at maturity
  purchase_price DECIMAL(15,2) NOT NULL, -- Discounted price paid
  discount_rate DECIMAL(6,4) NOT NULL, -- Discount rate at purchase
  effective_yield DECIMAL(6,4),        -- Calculated yield
  purchase_date DATE NOT NULL,

  -- Maturity
  maturity_date DATE NOT NULL,

  -- Tax
  withholding_tax DECIMAL(15,2),       -- 15% WHT (deducted at BoZ)
  net_proceeds DECIMAL(15,2),          -- Expected net at maturity

  -- CSD Integration
  csd_account_number VARCHAR(50),
  csd_reference VARCHAR(50),

  -- Status
  status VARCHAR(20) DEFAULT 'ACTIVE', -- ACTIVE, MATURED, SOLD, ROLLED_OVER
  matured_date DATE,
  rollover_to_id UUID,                 -- Reference to new T-Bill if rolled over

  -- Transaction Links (CRITICAL for income tracking)
  maturity_investment_tx_id UUID REFERENCES investment_transactions(id),  -- Links to investment module
  maturity_income_tx_id UUID REFERENCES transactions(id),  -- Links to main household income

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**T-Bill Maturity-to-Income Integration Behavior:**
When a T-Bill status changes to `MATURED`:
1. **Auto-create `investment_transactions` record** with type `MATURITY`
   - Amount: `net_proceeds` (face value minus WHT on interest)
   - Interest earned: `face_value - purchase_price`
2. **Auto-create `transactions` record** in main household ledger:
   - Category: "Investment Income" or "T-Bill Interest"
   - Amount: Interest portion only (`face_value - purchase_price - withholding_tax`)
   - Note: Principal return is NOT income, only the interest (discount) portion
   - Linked account: Settlement bank account from CSD
3. **Update both foreign keys** in `grz_tbills`
4. **Handle rollover scenario**:
   - If `rollover_to_id` is set, only record interest as income
   - Principal automatically reinvested into new T-Bill
5. **Trigger notification** if user has maturity alerts enabled

This ensures T-Bill proceeds appear in:
- Investment performance reports (via `investment_transactions`)
- Household budget/income tracking (interest only via `transactions`)
- Tax reports (WHT already deducted at source by BoZ)

**`grz_auction_results`** - Historical auction data for reference
```sql
CREATE TABLE grz_auction_results (
  id UUID PRIMARY KEY,
  auction_date DATE NOT NULL,
  security_type VARCHAR(20) NOT NULL,  -- BOND, TBILL
  tenor VARCHAR(20) NOT NULL,          -- '91D', '182D', '2Y', '10Y', etc.

  -- Auction Results
  amount_offered DECIMAL(15,2),        -- Amount on offer
  amount_accepted DECIMAL(15,2),       -- Amount accepted
  weighted_avg_yield DECIMAL(6,4),     -- Weighted average yield
  highest_yield DECIMAL(6,4),
  lowest_yield DECIMAL(6,4),

  -- For T-Bills
  weighted_avg_discount DECIMAL(6,4),

  source VARCHAR(50) DEFAULT 'BOZ',    -- Bank of Zambia
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(auction_date, security_type, tenor)
);
```

**`csd_accounts`** - User's CSD account details
```sql
CREATE TABLE csd_accounts (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),

  csd_account_number VARCHAR(50) NOT NULL,
  account_holder_name VARCHAR(255),
  settlement_bank VARCHAR(100),        -- e.g., "Zanaco", "Stanbic"
  settlement_account VARCHAR(50),      -- Bank account for payments

  -- Verification
  is_verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMP,

  -- Portal Access (optional)
  portal_username VARCHAR(100),        -- investorportal.boz.zm username
  last_sync_at TIMESTAMP,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### Pension & Retirement Tables (NEW)

**`pension_holdings`** - NAPSA and private pension accounts
```sql
CREATE TABLE pension_holdings (
  id UUID PRIMARY KEY,
  household_id UUID REFERENCES households(id),
  user_id UUID REFERENCES users(id),

  -- Pension Type
  pension_type VARCHAR(50) NOT NULL,   -- NAPSA, MADISON_LIFE, PROFESSIONAL_INS, OTHER
  account_number VARCHAR(50),          -- NAPSA number or policy number
  provider_name VARCHAR(100),

  -- Employment Context
  employer_name VARCHAR(255),
  employment_start_date DATE,
  gross_monthly_salary DECIMAL(15,2),  -- For contribution calculations

  -- Contribution Rates
  employee_rate DECIMAL(5,4) DEFAULT 0.05,   -- 5% for NAPSA
  employer_rate DECIMAL(5,4) DEFAULT 0.05,   -- 5% for NAPSA

  -- Current Value
  current_balance DECIMAL(15,2),
  last_statement_date DATE,
  last_statement_balance DECIMAL(15,2),

  -- Retirement Projection
  retirement_age INTEGER DEFAULT 55,
  expected_monthly_pension DECIMAL(15,2),  -- Calculated projection

  -- Status
  status VARCHAR(20) DEFAULT 'ACTIVE',  -- ACTIVE, DORMANT, WITHDRAWN

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**`pension_contributions`** - Individual contribution records
```sql
CREATE TABLE pension_contributions (
  id UUID PRIMARY KEY,
  pension_id UUID REFERENCES pension_holdings(id),

  contribution_date DATE NOT NULL,
  period_month INTEGER,                -- 1-12
  period_year INTEGER,

  -- Amounts
  employee_amount DECIMAL(15,2) NOT NULL,
  employer_amount DECIMAL(15,2) NOT NULL,
  voluntary_amount DECIMAL(15,2) DEFAULT 0,
  total_amount DECIMAL(15,2) NOT NULL,

  -- Source
  source VARCHAR(50),                  -- PAYROLL, MANUAL, STATEMENT_IMPORT

  created_at TIMESTAMP DEFAULT NOW()
);
```

#### Recurring Investment Tables (NEW)

**`recurring_investments`** - SIPs, auto-rollovers, standing orders
```sql
CREATE TABLE recurring_investments (
  id UUID PRIMARY KEY,
  household_id UUID REFERENCES households(id),
  account_id UUID REFERENCES accounts(id),

  -- Investment Target
  investment_type VARCHAR(50) NOT NULL,  -- UNIT_TRUST_SIP, TBILL_ROLLOVER, TERM_DEPOSIT, SAVINGS
  security_id UUID REFERENCES securities(id),  -- For unit trusts
  target_description VARCHAR(255),       -- e.g., "Madison Money Market Fund"

  -- Schedule
  frequency VARCHAR(20) NOT NULL,        -- MONTHLY, QUARTERLY, ON_MATURITY
  day_of_month INTEGER,                  -- 1-28 for monthly
  next_execution_date DATE,

  -- Amount
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'ZMW',

  -- Auto-rollover specific (for T-Bills)
  rollover_tenor_days INTEGER,           -- 91, 182, 273, 364
  rollover_at_maturity BOOLEAN DEFAULT false,

  -- Status
  status VARCHAR(20) DEFAULT 'ACTIVE',   -- ACTIVE, PAUSED, COMPLETED, CANCELLED
  start_date DATE NOT NULL,
  end_date DATE,                         -- NULL for indefinite
  executions_count INTEGER DEFAULT 0,

  -- Notifications
  notify_before_days INTEGER DEFAULT 3,
  notify_on_execution BOOLEAN DEFAULT true,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**`recurring_execution_log`** - History of recurring investment executions
```sql
CREATE TABLE recurring_execution_log (
  id UUID PRIMARY KEY,
  recurring_id UUID REFERENCES recurring_investments(id),

  execution_date DATE NOT NULL,
  scheduled_date DATE NOT NULL,

  -- Result
  status VARCHAR(20) NOT NULL,           -- SUCCESS, FAILED, SKIPPED
  amount_executed DECIMAL(15,2),
  transaction_id UUID,                   -- Link to investment_transactions
  failure_reason TEXT,

  created_at TIMESTAMP DEFAULT NOW()
);
```

#### Investment Goals & Projections (NEW)

**`investment_goals`** - User savings/investment goals
```sql
CREATE TABLE investment_goals (
  id UUID PRIMARY KEY,
  household_id UUID REFERENCES households(id),

  -- Goal Details
  name VARCHAR(100) NOT NULL,            -- e.g., "Retirement Fund", "House Deposit"
  target_amount DECIMAL(15,2) NOT NULL,
  target_date DATE,
  currency VARCHAR(3) DEFAULT 'ZMW',

  -- Current Progress
  current_amount DECIMAL(15,2) DEFAULT 0,
  linked_account_ids UUID[],             -- Accounts contributing to this goal

  -- Projection Parameters
  monthly_contribution DECIMAL(15,2),
  expected_return_rate DECIMAL(6,4),     -- e.g., 0.12 for 12% p.a.
  inflation_rate DECIMAL(6,4) DEFAULT 0.08,  -- Zambia ~8%

  -- Calculated Fields (updated periodically)
  projected_value DECIMAL(15,2),
  months_to_goal INTEGER,
  on_track BOOLEAN,

  -- Status
  status VARCHAR(20) DEFAULT 'ACTIVE',   -- ACTIVE, ACHIEVED, ABANDONED
  priority INTEGER DEFAULT 1,            -- 1 = highest

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 4.2 API Endpoints

#### Holdings Management
```
GET    /api/investments/holdings              # List all holdings
GET    /api/investments/holdings/:id          # Get holding details
POST   /api/investments/holdings              # Add new holding
PUT    /api/investments/holdings/:id          # Update holding
DELETE /api/investments/holdings/:id          # Remove holding
```

#### Securities
```
GET    /api/investments/securities            # Search securities
GET    /api/investments/securities/:id        # Get security details
POST   /api/investments/securities            # Create custom security
PUT    /api/investments/securities/:id/price  # Update price
GET    /api/investments/securities/:id/prices # Price history
```

#### Transactions
```
GET    /api/investments/transactions          # List transactions
POST   /api/investments/transactions          # Record transaction
PUT    /api/investments/transactions/:id      # Edit transaction
DELETE /api/investments/transactions/:id      # Delete transaction
POST   /api/investments/transactions/import   # Bulk import (CSV)
```

#### Portfolio Analytics
```
GET    /api/investments/portfolio/summary     # Overview stats
GET    /api/investments/portfolio/performance # Time-series performance
GET    /api/investments/portfolio/allocation  # Asset allocation breakdown
GET    /api/investments/portfolio/benchmarks  # Benchmark comparisons
```

#### FX Rates
```
GET    /api/investments/fx-rates              # Current rates
GET    /api/investments/fx-rates/history      # Historical rates
POST   /api/investments/fx-rates              # Manual rate entry
GET    /api/investments/fx-rates/update       # Fetch from BoZ API
```

#### Tax Reporting
```
GET    /api/investments/tax/summary           # Annual tax summary
GET    /api/investments/tax/dividends         # Dividend income report
GET    /api/investments/tax/capital-gains     # Capital gains report
GET    /api/investments/tax/zra-export        # ZRA-compliant CSV
```

#### GRZ Government Securities (NEW)
```
# Bond Management
GET    /api/investments/grz/bonds                    # List user's GRZ bonds
POST   /api/investments/grz/bonds                    # Add bond holding
GET    /api/investments/grz/bonds/:id                # Bond details with payment schedule
PUT    /api/investments/grz/bonds/:id                # Update bond (e.g., sold on secondary)
DELETE /api/investments/grz/bonds/:id                # Remove bond holding

# Treasury Bills
GET    /api/investments/grz/tbills                   # List user's T-Bills
POST   /api/investments/grz/tbills                   # Add T-Bill holding
GET    /api/investments/grz/tbills/:id               # T-Bill details
GET    /api/investments/grz/tbills/calculator        # Discount/yield calculator

# Coupon & Payment Tracking
GET    /api/investments/grz/payments/upcoming        # Next 90 days of payments
GET    /api/investments/grz/payments/history         # Historical coupon payments
GET    /api/investments/grz/payments/:bondId/schedule # Full payment schedule for bond

# Auction Information
GET    /api/investments/grz/auctions/calendar        # Upcoming auction dates
GET    /api/investments/grz/auctions/results         # Recent auction results & yields
GET    /api/investments/grz/yields/current           # Current yield curve

# CSD Account Integration
GET    /api/investments/grz/csd/status               # CSD account link status
POST   /api/investments/grz/csd/link                 # Link CSD account (manual)
GET    /api/investments/grz/csd/holdings             # Fetch holdings from CSD (future)

# Calculators
POST   /api/investments/grz/calculate/bond-price     # Calculate bond price from yield
POST   /api/investments/grz/calculate/ytm            # Calculate yield-to-maturity
POST   /api/investments/grz/calculate/accrued        # Calculate accrued interest
POST   /api/investments/grz/calculate/tbill-yield    # T-Bill discount to yield
```

#### Pension & NAPSA (NEW)
```
# Pension Holdings
GET    /api/investments/pension                      # List all pension accounts
POST   /api/investments/pension                      # Add pension account (NAPSA/private)
GET    /api/investments/pension/:id                  # Get pension details
PUT    /api/investments/pension/:id                  # Update pension info
DELETE /api/investments/pension/:id                  # Remove pension account

# Contributions
GET    /api/investments/pension/:id/contributions    # List contributions
POST   /api/investments/pension/:id/contributions    # Add contribution record
POST   /api/investments/pension/:id/import           # Import NAPSA statement (PDF/CSV)

# Projections
GET    /api/investments/pension/:id/projection       # Retirement projection
POST   /api/investments/pension/calculate-retirement # Calculate retirement value
```

#### Recurring Investments (NEW)
```
# Recurring Investment Plans
GET    /api/investments/recurring                    # List all recurring investments
POST   /api/investments/recurring                    # Create recurring investment (SIP/rollover)
GET    /api/investments/recurring/:id                # Get recurring investment details
PUT    /api/investments/recurring/:id                # Update (pause/resume/modify)
DELETE /api/investments/recurring/:id                # Cancel recurring investment

# Execution History
GET    /api/investments/recurring/:id/history        # Execution log
POST   /api/investments/recurring/:id/execute        # Manual execution trigger

# T-Bill Rollover Specific
POST   /api/investments/recurring/tbill-rollover     # Setup T-Bill auto-rollover
GET    /api/investments/recurring/upcoming-maturities # T-Bills/bonds maturing soon
```

#### Investment Goals & Projections (NEW)
```
# Goals Management
GET    /api/investments/goals                        # List all investment goals
POST   /api/investments/goals                        # Create new goal
GET    /api/investments/goals/:id                    # Get goal details with progress
PUT    /api/investments/goals/:id                    # Update goal
DELETE /api/investments/goals/:id                    # Remove goal

# Calculators
POST   /api/investments/goals/calculate-future-value # Compound growth calculator
POST   /api/investments/goals/calculate-monthly-needed # Required monthly contribution
POST   /api/investments/goals/compare-scenarios      # Compare investment scenarios

# What-If Analysis
POST   /api/investments/goals/what-if                # Project with different parameters
GET    /api/investments/goals/:id/scenarios          # Saved scenarios for a goal
```

#### FX Attribution (NEW)
```
# FX Impact Analysis
GET    /api/investments/fx/attribution               # Portfolio FX impact breakdown
GET    /api/investments/fx/attribution/:holdingId    # Single holding FX impact
GET    /api/investments/fx/historical                # Historical FX impact over time
GET    /api/investments/fx/exposure                  # Currency exposure summary
```

#### Investment Notifications (NEW)
```
# Notification Preferences
GET    /api/investments/notifications/preferences    # Get notification settings
PUT    /api/investments/notifications/preferences    # Update notification settings

# Notification Types Supported:
# - MATURITY_REMINDER (T-Bill/Bond maturity in X days)
# - COUPON_PAYMENT (Upcoming coupon payment)
# - AUCTION_RESULTS (GRZ auction results published)
# - PRICE_ALERT (Security crosses threshold)
# - NAV_UPDATE (Unit trust NAV updated)
# - GOAL_MILESTONE (Goal progress milestone reached)
# - RECURRING_EXECUTION (Recurring investment executed)
# - STALE_PRICE (Price not updated in X days)
```

### 4.3 External Integrations

#### Price Feeds
- **Yahoo Finance API**: US stocks, ETFs
- **Bank of Zambia API**: Official FX rates
- **Manual Entry**: LuSE stocks, bonds, unit trusts

#### Bank of Zambia Integration (NEW)
- **Investor Portal**: https://investorportal.boz.zm
  - CSD account verification
  - Holdings sync (future, if API available)
- **Auction Calendar**: https://www.boz.zm/grz-securities-issuance-calendar.htm
  - Quarterly issuance calendars (Q1-Q4)
  - Weekly auction schedules (Tuesdays)
- **Auction Results**: https://www.boz.zm/bonds.htm
  - Weighted average yields
  - Amounts offered/accepted
- **Bond Interest Rates**: https://www.boz.zm/bonds-interest-rates.htm
  - Historical yield data
  - Current rate reference

#### Secondary Market Data
- **Zanaco Trading Portal**: Secondary market prices
- **LuSE Bond Listings**: Listed bond prices
- **SEC Zambia**: https://www.seczambia.org.zm/bonds-secondary-market/

#### Future Integrations
- **Pangaea Securities API**: Auto-sync holdings
- **SBZ API**: Transaction import
- **BoZ Investor Portal API**: Direct CSD sync (when available)

---

## 5. User Interface Requirements

### 5.1 Dashboard Widget

**Investment Summary Card** on main dashboard:
```
┌─────────────────────────────────────┐
│ 💼 INVESTMENTS                      │
│                                     │
│ Total Value         K487,250.00     │
│ (USD equivalent)    ($17,718)       │
│                                     │
│ Today's Change     +K2,340 (+0.48%) │
│ Total Gain/Loss    +K87,250 (+21.8%)│
│                                     │
│ [View Details →]                    │
└─────────────────────────────────────┘
```

### 5.2 Holdings Page Layout

Based on Monarch Money UI:

```
┌─────────────────────────────────────────────────────────────────┐
│ Investments > Holdings                                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────┐│
│  │ Your Portfolio│  │ LuSE All Share│ │ ZMW Inflation │ │USD/ ││
│  │ PAST 3 MONTHS │  │ PAST 3 MONTHS │ │ PAST 3 MONTHS │ │ZMW  ││
│  │   +12.5%      │  │   +2.12%      │ │   +1.92%      │ │-0.3%││
│  │ TODAY         │  │ TODAY         │  │ TODAY         │ │TODAY││
│  │   +0.45%      │  │   +0.10%      │ │   +0.00%      │ │-0.1%││
│  └──────────────┘  └──────────────┘  └──────────────┘  └─────┘│
│                                                                  │
│  [1W] [1M] [3M] [6M] [YTD] [1Y] [5Y]    Currency: [ZMW ▼]      │
│                                          Account: [All ▼]        │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                Performance Chart                           │ │
│  │  4%                                                        │ │
│  │  2%  ━━━━ Your Portfolio (orange)                         │ │
│  │  0%  ━━━━ LuSE All Share (blue)                           │ │
│  │ -2%                                                        │ │
│  │ -4%                                                        │ │
│  │      Oct   Nov   Dec   Jan                                │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Holdings                                     [+ Add Holding]    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Security        │ Qty    │ Price   │ Value    │ Gain/Loss │ │
│  ├────────────────────────────────────────────────────────────│ │
│  │ CEC.LuSE        │ 500    │ K12.50  │ K6,250   │ +K1,250   │ │
│  │ AAPL (USD)      │ 10     │ $150.00 │ K41,250  │ +K3,500   │ │
│  │ GRZ 10Y Bond    │ 50     │ K1,000  │ K50,000  │ +K2,500   │ │
│  │ Madison MMF     │ 1,250  │ K10.00  │ K12,500  │ +K500     │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Empty State:                                                    │
│  "Holdings not found"                                            │
│  "Search for an investment and enter the quantity you own        │
│   to track the value."                                           │
│  [Add holding]                                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.3 Add Holding Modal

```
┌─────────────────────────────────────┐
│ Add Investment Holding              │
├─────────────────────────────────────┤
│                                     │
│ Security *                          │
│ [Search: CEC, AAPL, GRZ Bond...   ]│
│                                     │
│ ┌─ Search Results ─────────────┐   │
│ │ CEC - Copperbelt Energy      │   │
│ │ (LuSE, ZMW)                  │   │
│ │                              │   │
│ │ Apple Inc (AAPL)             │   │
│ │ (NASDAQ, USD)                │   │
│ │                              │   │
│ │ + Create custom security     │   │
│ └──────────────────────────────┘   │
│                                     │
│ Account *                           │
│ [Stanbic USD Investment  ▼]        │
│                                     │
│ Quantity *                          │
│ [10                          ]     │
│                                     │
│ Purchase Price                      │
│ [$145.00              ] USD        │
│                                     │
│ Purchase Date                       │
│ [2025-06-15           ] 📅         │
│                                     │
│ Total Cost: $1,450.00               │
│ (K39,855 @ K27.50/USD)              │
│                                     │
│              [Cancel]  [Add Holding]│
└─────────────────────────────────────┘
```

### 5.4 Allocation Page

```
┌─────────────────────────────────────────────────────────────────┐
│ Investments > Allocation                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  By Asset Class                    By Currency                  │
│  ┌────────────────────┐            ┌────────────────────┐       │
│  │   🥧 Pie Chart     │            │   🥧 Pie Chart     │       │
│  │                    │            │                    │       │
│  │   Stocks    45%    │            │   ZMW      35%    │       │
│  │   Bonds     35%    │            │   USD      60%    │       │
│  │   Cash      20%    │            │   ZAR       5%    │       │
│  │                    │            │                    │       │
│  └────────────────────┘            └────────────────────┘       │
│                                                                  │
│  By Geography                      By Liquidity                 │
│  ┌────────────────────┐            ┌────────────────────┐       │
│  │   Local     40%    │            │   Liquid    75%    │       │
│  │   Offshore  60%    │            │   Illiquid  25%    │       │
│  └────────────────────┘            └────────────────────┘       │
│                                                                  │
│  Detailed Breakdown                                              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Asset Class      │ Value      │ % of Total │ Change (1M) │ │
│  ├────────────────────────────────────────────────────────────│ │
│  │ 📈 Stocks        │ K219,262   │    45%     │   +5.2%     │ │
│  │   - LuSE         │ K78,500    │    16%     │   +1.8%     │ │
│  │   - US Stocks    │ K123,750   │    25%     │   +7.1%     │ │
│  │   - JSE          │ K17,012    │     4%     │   +3.5%     │ │
│  │                  │            │            │             │ │
│  │ 💼 Fixed Income  │ K170,450   │    35%     │   +0.3%     │ │
│  │   - GRZ Bonds    │ K50,000    │    10%     │   +0.2%     │ │
│  │   - T-Bills      │ K45,000    │     9%     │   +0.1%     │ │
│  │   - Term Deposit │ K50,000    │    10%     │   +0.4%     │ │
│  │   - Unit Trusts  │ K25,450    │     6%     │   +0.3%     │ │
│  │                  │            │            │             │ │
│  │ 💰 Cash & MM     │ K97,538    │    20%     │   +0.1%     │ │
│  │   - Money Market │ K40,000    │     8%     │   +0.2%     │ │
│  │   - MoMo Savings │ K25,538    │     5%     │   +0.3%     │ │
│  │   - Cash         │ K32,000    │     7%     │   +0.0%     │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.5 Transaction Recording

```
┌─────────────────────────────────────┐
│ Record Investment Transaction       │
├─────────────────────────────────────┤
│                                     │
│ Transaction Type *                  │
│ [Buy ▼]                             │
│  - Buy                              │
│  - Sell                             │
│  - Dividend (Cash)                  │
│  - Dividend (Reinvested)            │
│  - Interest                         │
│  - Fee                              │
│  - Transfer In                      │
│  - Transfer Out                     │
│                                     │
│ Security *                          │
│ [CEC - Copperbelt Energy      ]    │
│                                     │
│ Account *                           │
│ [Stanbic ZMW Investment ▼]         │
│                                     │
│ Date *                              │
│ [2026-01-05           ] 📅         │
│                                     │
│ Quantity *                          │
│ [100                  ]            │
│                                     │
│ Price per Share *                   │
│ [K12.50               ] ZMW        │
│                                     │
│ Fees & Commissions                  │
│ [K50.00               ]            │
│  (0.4% typical for LuSE)           │
│                                     │
│ Total Amount: K1,300.00             │
│                                     │
│ Notes                               │
│ [                                 ]│
│                                     │
│              [Cancel] [Save        │
└─────────────────────────────────────┘
```

### 5.6 Price Update Interface

```
┌─────────────────────────────────────────────────────────────────┐
│ Update Security Prices                                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [Refresh Auto-Updated] (updates USD stocks)                     │
│                                                                  │
│  Manual Price Updates Required:                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Security        │ Last Price│ Last Update │ New Price     │ │
│  ├────────────────────────────────────────────────────────────│ │
│  │ CEC.LuSE        │ K12.50    │ 3 days ago  │ [K12.75  ] ⚠ │ │
│  │ SCZ.LuSE        │ K8.00     │ 7 days ago  │ [K8.20   ] ⚠ │ │
│  │ Madison MMF     │ K10.00    │ 30 days ago │ [K10.02  ] ⚠ │ │
│  │ GRZ Bond 10Y    │ K98.50    │ 15 days ago │ [K98.75  ]   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ⚠ = Price is stale (>7 days for stocks, >30 days for bonds)    │
│                                                                  │
│  Or Upload CSV:                                                  │
│  [Choose File] prices_2026-01-05.csv                            │
│                                                                  │
│  CSV Format: symbol, date, price                                 │
│  Example: CEC.LuSE, 2026-01-05, 12.75                           │
│                                                                  │
│                              [Cancel]  [Update All Prices]      │
└─────────────────────────────────────────────────────────────────┘
```

### 5.7 GRZ Government Securities Dashboard (NEW)

```
┌─────────────────────────────────────────────────────────────────┐
│ Investments > GRZ Securities                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Summary                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ Total Value  │  │ Annual Income│  │ Avg Yield    │           │
│  │ K175,000     │  │ K28,437      │  │ 16.25%       │           │
│  │              │  │ (after WHT)  │  │              │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│                                                                  │
│  [Bonds] [T-Bills] [Auctions] [Calculators]                     │
│  ━━━━━━━                                                         │
│                                                                  │
│  Your GRZ Bonds                              [+ Add Bond]        │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Bond          │ Face Value│ Coupon │ Maturity   │ Status   │ │
│  ├────────────────────────────────────────────────────────────│ │
│  │ GRZ 17.85%    │ K50,000   │ 17.85% │ 27-Dec-2031│ Active   │ │
│  │ 10Y 2031      │           │        │ (6yr rem)  │          │ │
│  │               │           │        │            │          │ │
│  │ GRZ 16.5%     │ K75,000   │ 16.50% │ 15-Jun-2029│ Active   │ │
│  │ 5Y 2029       │           │        │ (3yr rem)  │          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Upcoming Payments (Next 90 Days)                                │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Date       │ Bond           │ Type   │ Gross    │ Net      │ │
│  ├────────────────────────────────────────────────────────────│ │
│  │ 15-Jan-26  │ GRZ 17.85% 10Y │ Coupon │ K4,462   │ K3,793   │ │
│  │ 15-Mar-26  │ GRZ 16.5% 5Y   │ Coupon │ K6,187   │ K5,259   │ │
│  │ 22-Mar-26  │ 91D T-Bill     │ Mature │ K50,000  │ K48,275  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.8 Add GRZ Bond Modal (NEW)

```
┌─────────────────────────────────────┐
│ Add GRZ Bond                        │
├─────────────────────────────────────┤
│                                     │
│ Acquisition Type *                  │
│ ○ Primary Market (BoZ Auction)      │
│ ● Secondary Market (Bank/LuSE)      │
│                                     │
│ Bond Details                        │
│ ┌─────────────────────────────────┐ │
│ │ Tenor *        [10 Years    ▼] │ │
│ │ Coupon Rate *  [17.85      ] % │ │
│ │ Maturity Date  [2031-12-27  📅]│ │
│ │ ISIN (optional)[ZM1000005091 ] │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Investment Details                  │
│ ┌─────────────────────────────────┐ │
│ │ Face Value *   [K50,000      ] │ │
│ │ Purchase Price [K49,250      ] │ │
│ │ Purchase Date  [2026-01-05  📅]│ │
│ │ Purchase Yield [18.15      ] % │ │
│ └─────────────────────────────────┘ │
│                                     │
│ CSD Account (optional)              │
│ [Select CSD Account           ▼]   │
│ [+ Link new CSD account]            │
│                                     │
│ First Coupon Date                   │
│ [2026-06-27              ] 📅      │
│                                     │
│ ─────────────────────────────────── │
│ Payment Schedule Preview:           │
│ • 27-Jun-2026: K4,462 (K3,793 net)  │
│ • 27-Dec-2026: K4,462 (K3,793 net)  │
│ • ... (18 more payments)            │
│ • 27-Dec-2031: K54,462 (maturity)   │
│                                     │
│ Total Expected Income: K89,250      │
│ After 15% WHT: K75,862              │
│                                     │
│              [Cancel]  [Add Bond]   │
└─────────────────────────────────────┘
```

### 5.9 Add Treasury Bill Modal (NEW)

```
┌─────────────────────────────────────┐
│ Add Treasury Bill                   │
├─────────────────────────────────────┤
│                                     │
│ T-Bill Details                      │
│ ┌─────────────────────────────────┐ │
│ │ Tenor *        [91 Days     ▼] │ │
│ │                 91 Days         │ │
│ │                 182 Days        │ │
│ │                 273 Days        │ │
│ │                 364 Days        │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Investment Details                  │
│ ┌─────────────────────────────────┐ │
│ │ Face Value *   [K50,000      ] │ │
│ │ Discount Rate  [11.50      ] % │ │
│ │ Purchase Date  [2026-01-05  📅]│ │
│ └─────────────────────────────────┘ │
│                                     │
│ ─────────── Calculated ──────────── │
│                                     │
│ Purchase Price:    K48,562.50       │
│ (Face Value × (1 - Rate × Days/360))│
│                                     │
│ Maturity Date:     06-Apr-2026      │
│                                     │
│ Gross Return:      K1,437.50        │
│ Effective Yield:   11.85% p.a.      │
│                                     │
│ WHT (15%):         -K215.63         │
│ Net Proceeds:      K49,784.37       │
│ Net Return:        K1,221.87        │
│ Net Yield:         10.07% p.a.      │
│                                     │
│              [Cancel]  [Add T-Bill] │
└─────────────────────────────────────┘
```

### 5.10 GRZ Yield Curve & Auction Results (NEW)

```
┌─────────────────────────────────────────────────────────────────┐
│ GRZ Securities > Auctions & Yields                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Current Yield Curve (as of 05-Jan-2026)                        │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 20% │                                          ●            │ │
│  │     │                              ●     ●                  │ │
│  │ 18% │                    ●    ●                             │ │
│  │     │              ●                                        │ │
│  │ 16% │        ●                                              │ │
│  │     │                                                       │ │
│  │ 14% │   ●                                                   │ │
│  │     │                                                       │ │
│  │ 12% │ ●                                                     │ │
│  │     └───────────────────────────────────────────────────   │ │
│  │       91D 182D 364D  2Y   3Y   5Y   7Y   10Y  15Y           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Current Rates                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Tenor    │ Yield/Discount │ Change (1M) │ Last Auction    │ │
│  ├────────────────────────────────────────────────────────────│ │
│  │ 91-Day   │ 11.50%         │ -0.25%      │ 02-Jan-2026     │ │
│  │ 182-Day  │ 12.25%         │ -0.15%      │ 02-Jan-2026     │ │
│  │ 273-Day  │ 13.00%         │ -0.10%      │ 02-Jan-2026     │ │
│  │ 364-Day  │ 14.00%         │ -0.20%      │ 02-Jan-2026     │ │
│  │ 2-Year   │ 15.50%         │ -0.50%      │ 31-Dec-2025     │ │
│  │ 3-Year   │ 16.25%         │ -0.40%      │ 31-Dec-2025     │ │
│  │ 5-Year   │ 17.00%         │ -0.35%      │ 31-Dec-2025     │ │
│  │ 7-Year   │ 17.50%         │ -0.30%      │ 31-Dec-2025     │ │
│  │ 10-Year  │ 17.85%         │ -0.25%      │ 31-Dec-2025     │ │
│  │ 15-Year  │ 18.25%         │ -0.20%      │ 31-Dec-2025     │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Upcoming Auctions                                               │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Date       │ Security      │ Amount (K)  │ Deadline       │ │
│  ├────────────────────────────────────────────────────────────│ │
│  │ 07-Jan-26  │ T-Bills       │ 2,200M      │ 06-Jan 10:00   │ │
│  │ 07-Jan-26  │ 5Y, 10Y Bonds │ 1,800M      │ 06-Jan 10:00   │ │
│  │ 14-Jan-26  │ T-Bills       │ 2,200M      │ 13-Jan 10:00   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Source: Bank of Zambia (boz.zm) │ [Refresh] │ [View Calendar] │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.11 Bond Calculators (NEW)

```
┌─────────────────────────────────────────────────────────────────┐
│ GRZ Securities > Calculators                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [Bond Price] [Yield to Maturity] [T-Bill Yield] [Accrued Int]  │
│  ━━━━━━━━━━━━                                                    │
│                                                                  │
│  Bond Price Calculator                                           │
│  Calculate the price of a bond given its yield                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                                                             │ │
│  │  Face Value        [K100,000            ]                  │ │
│  │  Coupon Rate       [17.85              ] % p.a.            │ │
│  │  Years to Maturity [10                 ]                   │ │
│  │  Required Yield    [18.50              ] % p.a.            │ │
│  │  Coupon Frequency  [Semi-Annual (2)   ▼]                   │ │
│  │                                                             │ │
│  │                    [Calculate]                              │ │
│  │                                                             │ │
│  │  ─────────────── Results ───────────────                   │ │
│  │                                                             │ │
│  │  Clean Price:      K96,547.23                              │ │
│  │  Accrued Interest: K2,231.25 (25 days)                     │ │
│  │  Dirty Price:      K98,778.48                              │ │
│  │                                                             │ │
│  │  Discount to Par:  -3.45%                                  │ │
│  │  Current Yield:    18.49%                                  │ │
│  │                                                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Accrued Interest Calculator                                     │
│  Calculate interest accrued between coupon dates                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                                                             │ │
│  │  Face Value        [K50,000             ]                  │ │
│  │  Coupon Rate       [17.85              ] % p.a.            │ │
│  │  Last Coupon Date  [2025-12-27       📅]                   │ │
│  │  Settlement Date   [2026-01-21       📅]                   │ │
│  │  Day Count         [Actual/365       ▼]                    │ │
│  │                                                             │ │
│  │                    [Calculate]                              │ │
│  │                                                             │ │
│  │  Days Accrued:     25 days                                 │ │
│  │  Accrued Interest: K611.30                                 │ │
│  │  Formula: 50,000 × 17.85% × (25/365)                       │ │
│  │                                                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.12 Bond Ladder Visualization (NEW)

```
┌─────────────────────────────────────────────────────────────────┐
│ Investments > Fixed Income Ladder                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Maturity Schedule - Cash Flow Visualization                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                                                             │ │
│  │  2026                                                       │ │
│  │  ┌─────┬─────┬─────┬─────┐                                 │ │
│  │  │ Q1  │ Q2  │ Q3  │ Q4  │                                 │ │
│  │  │K50k │K75k │ --- │K100k│                                 │ │
│  │  │T-Bill│Bond │     │Bond │                                 │ │
│  │  └─────┴─────┴─────┴─────┘                                 │ │
│  │                                                             │ │
│  │  2027                                                       │ │
│  │  ┌─────┬─────┬─────┬─────┐                                 │ │
│  │  │ Q1  │ Q2  │ Q3  │ Q4  │                                 │ │
│  │  │K25k │ --- │K50k │ --- │                                 │ │
│  │  │T-Bill│     │Bond │     │                                 │ │
│  │  └─────┴─────┴─────┴─────┘                                 │ │
│  │                                                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Upcoming Maturities                                             │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Date       │ Security       │ Amount   │ Action            │ │
│  ├────────────────────────────────────────────────────────────│ │
│  │ 15-Mar-26  │ 91D T-Bill     │ K50,000  │ [Rollover] [Cash] │ │
│  │ 27-Jun-26  │ GRZ 5Y Bond    │ K75,000  │ [Reinvest] [Cash] │ │
│  │ 30-Sep-26  │ Term Deposit   │ K100,000 │ [Renew] [Withdraw]│ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Gap Analysis: No maturities in Q3 2026 - consider adding       │
│                a 273-day T-Bill to fill the gap.                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.13 FX Attribution Panel (NEW)

```
┌─────────────────────────────────────────────────────────────────┐
│ Investments > Performance > FX Attribution                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Period: [Last 12 Months ▼]                                     │
│                                                                  │
│  Portfolio Return Breakdown                                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                                                             │ │
│  │  Total Return (ZMW):        +K47,250 (+12.5%)              │ │
│  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━           │ │
│  │                                                             │ │
│  │  Breakdown:                                                 │ │
│  │  ├─ Investment Return:      +K62,500 (+16.5%)    📈        │ │
│  │  │  (Gains from securities appreciation)                    │ │
│  │  │                                                          │ │
│  │  └─ FX Impact:              -K15,250 (-4.0%)     💱        │ │
│  │     (ZMW strengthened against USD)                          │ │
│  │                                                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  FX Impact by Holding                                            │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Holding      │ Currency│ Inv Return│ FX Impact │ Net (ZMW)│ │
│  ├────────────────────────────────────────────────────────────│ │
│  │ Apple (AAPL) │ USD     │ +$200     │ -K3,000   │ +K2,500  │ │
│  │              │         │ (+13.3%)  │ (-8.0%)   │ (+5.1%)  │ │
│  │              │         │           │           │          │ │
│  │ JSE ETF      │ ZAR     │ +R1,500   │ -K500     │ +K2,200  │ │
│  │              │         │ (+10.0%)  │ (-2.5%)   │ (+7.3%)  │ │
│  │              │         │           │           │          │ │
│  │ CEC.LuSE     │ ZMW     │ +K1,250   │ N/A       │ +K1,250  │ │
│  │              │         │ (+20.0%)  │           │ (+20.0%) │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Currency Exposure                                               │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  ZMW ████████████████████████████████████  65% (K253,500) │ │
│  │  USD ██████████████████████               30% (K117,000)  │ │
│  │  ZAR █████                                 5%  (K19,500)  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.14 Goal Projection Calculator (NEW)

```
┌─────────────────────────────────────────────────────────────────┐
│ Investments > Goals > Retirement Fund                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Goal: Retirement Fund         Target: K2,000,000 by 2045       │
│  Progress: ████████░░░░░░░░░░░░░░░░░░  32% (K640,000)           │
│  Status: ✅ On Track                                             │
│                                                                  │
│  "What If" Calculator                                            │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                                                             │ │
│  │  Monthly Contribution  [K5,000            ]                │ │
│  │  Expected Return       [12.0             ] % p.a.          │ │
│  │  Years to Goal         [19               ]                 │ │
│  │  Inflation Rate        [8.0              ] % p.a.          │ │
│  │                                                             │ │
│  │                    [Calculate]                              │ │
│  │                                                             │ │
│  │  ─────────────── Projection ───────────────                │ │
│  │                                                             │ │
│  │  Future Value:         K3,247,892                          │ │
│  │  Real Value (today's): K1,012,459                          │ │
│  │                                                             │ │
│  │  Monthly needed for K2M target: K3,850                     │ │
│  │  You're contributing K1,150 MORE than needed! 🎉            │ │
│  │                                                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Compare Scenarios                                               │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Scenario        │ Monthly │ Return │ Final Value │ Target? │ │
│  ├────────────────────────────────────────────────────────────│ │
│  │ Conservative    │ K5,000  │ 10%    │ K2,547,000  │ ✅ Yes  │ │
│  │ (T-Bills only)  │         │        │             │         │ │
│  │                 │         │        │             │         │ │
│  │ Balanced        │ K5,000  │ 12%    │ K3,247,892  │ ✅ Yes  │ │
│  │ (Current mix)   │         │        │             │         │ │
│  │                 │         │        │             │         │ │
│  │ Aggressive      │ K5,000  │ 15%    │ K4,582,000  │ ✅ Yes  │ │
│  │ (More equities) │         │        │             │         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.15 NAPSA & Pension Tracker (NEW)

```
┌─────────────────────────────────────────────────────────────────┐
│ Investments > Pension > NAPSA                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  NAPSA Account: 12345678                                         │
│  Employer: ABC Mining Corporation                                │
│                                                                  │
│  Summary                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ Total Balance│  │ This Year    │  │ Projected    │           │
│  │ K245,000     │  │ K24,000      │  │ K1.8M        │           │
│  │              │  │ (10 months)  │  │ (at age 55)  │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│                                                                  │
│  Monthly Contribution Breakdown                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                                                             │ │
│  │  Gross Salary:      K20,000                                │ │
│  │                                                             │ │
│  │  Employee (5%):     K1,000  ██████████                     │ │
│  │  Employer (5%):     K1,000  ██████████                     │ │
│  │  ─────────────────────────────────                         │ │
│  │  Total Monthly:     K2,000                                 │ │
│  │                                                             │ │
│  │  Voluntary Top-up:  K500 (optional)                        │ │
│  │                                                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Contribution History                                            │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Month    │ Employee │ Employer │ Voluntary │ Total        │ │
│  ├────────────────────────────────────────────────────────────│ │
│  │ Dec 2025 │ K1,000   │ K1,000   │ K500      │ K2,500       │ │
│  │ Nov 2025 │ K1,000   │ K1,000   │ K500      │ K2,500       │ │
│  │ Oct 2025 │ K1,000   │ K1,000   │ K0        │ K2,000       │ │
│  │ ...      │ ...      │ ...      │ ...       │ ...          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  [Import NAPSA Statement]  [Add Contribution]  [View Projection]│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.16 Recurring Investment Setup (NEW)

```
┌─────────────────────────────────────────────────────────────────┐
│ Investments > Recurring > Setup                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Create Recurring Investment                                     │
│                                                                  │
│  Investment Type *                                               │
│  ○ Unit Trust SIP (Systematic Investment Plan)                  │
│  ● T-Bill Auto-Rollover                                         │
│  ○ Term Deposit Renewal                                         │
│  ○ Regular Savings Transfer                                     │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  T-Bill Rollover Settings                                        │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                                                             │ │
│  │  Current T-Bill:    91-Day T-Bill (matures 15-Mar-2026)    │ │
│  │  Face Value:        K50,000                                │ │
│  │                                                             │ │
│  │  On Maturity:                                               │ │
│  │  ● Rollover to same tenor (91 days)                        │ │
│  │  ○ Rollover to different tenor [182 Days ▼]                │ │
│  │  ○ Transfer to account [Zanaco Savings ▼]                  │ │
│  │                                                             │ │
│  │  Rollover Amount:                                           │ │
│  │  ● Full proceeds (face value + net interest)               │ │
│  │  ○ Fixed amount [K50,000        ]                          │ │
│  │  ○ Face value only (withdraw interest)                     │ │
│  │                                                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Notifications                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  ☑ Notify me 7 days before maturity                        │ │
│  │  ☑ Notify me when rollover is executed                     │ │
│  │  ☑ Notify me of new yield rate                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│                              [Cancel]  [Setup Auto-Rollover]    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.17 Offline Mode & Low-Connectivity Support (NEW)

Given Zambia's intermittent internet connectivity, the investment module must support offline usage.

#### Offline Capabilities

**Data Caching**
- Cache all portfolio data locally using IndexedDB
- Store last 30 days of FX rates for offline valuation
- Cache security prices with timestamp for staleness indicator
- Store user preferences and settings locally

**Offline Actions**
- View portfolio holdings and allocation (cached values)
- View transaction history
- Add manual transactions (queued for sync)
- View maturity schedules and coupon calendars
- Access saved reports and statements

**Sync Strategy**
- Background sync when connectivity restored
- Conflict resolution for offline-created transactions
- Priority sync for critical data (prices, FX rates)
- User notification of pending sync items

#### UI Indicators

```
┌─────────────────────────────────────────────────────────────────┐
│ ⚠️ OFFLINE MODE                                    [Last sync: 2h ago]│
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Your Portfolio                                                  │
│                                                                  │
│  Total Value:     K847,250 ⏱️ (as of 2 hours ago)               │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                                                             │ │
│  │  Holdings are displayed using cached data.                 │ │
│  │  Prices and FX rates may be outdated.                      │ │
│  │                                                             │ │
│  │  Pending changes (will sync when online):                  │ │
│  │  • 1 new transaction added                                 │ │
│  │  • 2 price updates queued                                  │ │
│  │                                                             │ │
│  │                        [Retry Connection]                  │ │
│  │                                                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Holdings (Cached)                                               │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Security       │ Value      │ Price Age   │ Status         │ │
│  │────────────────│────────────│─────────────│────────────────│ │
│  │ CEC.LuSE       │ K6,250     │ 2h stale    │ ⚠️ Outdated    │ │
│  │ GRZ 10Y Bond   │ K50,000    │ Current     │ ✅ Fixed       │ │
│  │ 91-Day T-Bill  │ K48,500    │ Current     │ ✅ Fixed       │ │
│  │ AAPL           │ K41,250    │ 4h stale    │ ⚠️ Outdated    │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### Offline Transaction Entry

```
┌─────────────────────────────────────────────────────────────────┐
│ Add Transaction (Offline Mode)                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ⚠️ You are currently offline                                    │
│  This transaction will be saved locally and synced when          │
│  connectivity is restored.                                       │
│                                                                  │
│  Transaction Type *     [Dividend Payment ▼]                    │
│  Security *             [GRZ 10Y Bond ▼]                        │
│  Amount *               [K 2,500.00       ]                     │
│  Date *                 [15-Jan-2026      ]                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  ℹ️ Note: WHT calculations will be verified when online     │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│                         [Cancel]  [Save Offline]               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### Technical Implementation

**IndexedDB Schema**
```typescript
interface OfflineStore {
  // Cached data
  holdings: CachedHolding[];
  transactions: CachedTransaction[];
  fxRates: CachedFXRate[];
  securityPrices: CachedPrice[];

  // Pending sync queue
  pendingTransactions: PendingTransaction[];
  pendingPriceUpdates: PendingPriceUpdate[];

  // Metadata
  lastSyncTimestamp: Date;
  syncStatus: 'synced' | 'pending' | 'error';
}

interface CachedHolding {
  data: Holding;
  cachedAt: Date;
  isStale: boolean; // >24h since last update
}

interface PendingTransaction {
  id: string;
  transaction: Transaction;
  createdOfflineAt: Date;
  syncAttempts: number;
  lastError?: string;
}
```

**Service Worker Strategy**
```typescript
// sw.js - Investment module caching
const INVESTMENT_CACHE = 'investment-v1';
const CACHE_URLS = [
  '/api/investments/holdings',
  '/api/investments/transactions',
  '/api/fx/rates/latest',
  '/api/securities/prices'
];

// Cache-first for static data, network-first for prices
```

#### Sync Conflict Resolution

| Scenario | Resolution Strategy |
|----------|---------------------|
| Transaction added offline | Add to server, assign new ID if conflict |
| Price updated offline | Server wins (more recent data) |
| Holding edited offline | Merge changes, prompt user if conflict |
| Account deleted while offline | Flag for user review |

#### Connectivity Detection

```typescript
// Monitor connectivity status
const connectivityMonitor = {
  isOnline: navigator.onLine,
  connectionQuality: 'good' | 'poor' | 'offline',

  // Zambia-specific: detect slow connections
  checkConnectionQuality: async () => {
    const start = Date.now();
    try {
      await fetch('/api/health', { timeout: 5000 });
      const latency = Date.now() - start;
      return latency < 1000 ? 'good' : 'poor';
    } catch {
      return 'offline';
    }
  }
};
```

---

## 6. Zambian Tax Reporting

### 6.1 Withholding Tax (WHT)
- **Rate**: 15% on dividends (for residents)
- **Auto-calculation**: Deduct WHT when recording dividend transactions
- **Display**: Show gross dividend + WHT separately

Example:
```
CEC Dividend Payment
Gross Dividend:     K1,000.00
WHT (15%):          - K150.00
Net Received:       K850.00
```

### 6.2 Capital Gains Tax (CGT)
- **Current Status**: No CGT on securities in Zambia (as of 2026)
- **Future-proofing**: Track disposal proceeds vs cost basis
- **Report Generation**: Capital gains summary for ZRA filing

### 6.3 ZRA Export Format

Annual investment income CSV:
```csv
Date,Security,Type,Gross Amount (ZMW),WHT (ZMW),Net Amount (ZMW)
2025-03-15,CEC.LuSE,Dividend,1000.00,150.00,850.00
2025-06-20,AAPL,Dividend,2750.00,0.00,2750.00
2025-09-30,GRZ Bond 10Y,Interest,5000.00,0.00,5000.00
```

---

## 7. Implementation Phases

### Phase 1: Foundation
**Priority: CRITICAL**

- [ ] Database schema (securities, holdings, transactions, fx_rates)
- [ ] Basic CRUD APIs for holdings & securities
- [ ] Multi-currency account support
- [ ] Manual price entry
- [ ] LuSE stock support with ZMW
- [ ] USD investment accounts
- [ ] FX rate tracking (manual entry)

### Phase 2: Core Features
**Priority: CRITICAL**

- [ ] Holdings page UI (Monarch-inspired layout)
- [ ] Performance chart with benchmarks
- [ ] Transaction recording (Buy, Sell, Dividend)
- [ ] Asset allocation breakdown
- [ ] LuSE All Share Index benchmark
- [ ] WHT auto-calculation
- [ ] Cost basis & gain/loss tracking
- [ ] **Investment Notifications** (maturity alerts, dividend reminders)

### Phase 3: Zambian Assets
**Priority: HIGH**

- [ ] GRZ Bonds with full feature set:
  - [ ] Bond holdings with ISIN tracking
  - [ ] Coupon payment schedule & calendar
  - [ ] Accrued interest calculations
  - [ ] CSD account linking
  - [ ] **Bond Ladder Visualization**
- [ ] Treasury Bills:
  - [ ] Discount price calculations
  - [ ] Maturity tracking
  - [ ] **Auto-rollover setup**
- [ ] Unit Trusts (Madison, Prudential)
- [ ] Term Deposits with interest accrual
- [ ] Forex trading accounts

### Phase 4: Enhanced Analytics
**Priority: HIGH**

- [ ] Bank of Zambia FX API integration
- [ ] Yahoo Finance price feeds
- [ ] **FX Impact Attribution Panel** (separate investment vs currency returns)
- [ ] Performance attribution (security, FX, asset allocation)
- [ ] Tax reporting (ZRA export)
- [ ] CSV import/export

### Phase 5: Pension & Recurring Investments
**Priority: MEDIUM**

- [ ] **NAPSA Pension Tracking**:
  - [ ] Contribution history (employee + employer)
  - [ ] Balance tracking with projections
  - [ ] Retirement planning calculator
- [ ] **Private Pension Funds** (Madison Life, Prudential)
- [ ] **Recurring Investment Setup**:
  - [ ] Unit Trust SIPs (Systematic Investment Plans)
  - [ ] T-Bill auto-rollover at maturity
  - [ ] Term deposit auto-renewal
- [ ] **Goal Projection Calculator** (what-if scenarios)

### Phase 6: Offshore & Advanced
**Priority: MEDIUM**

- [ ] Offshore stocks (NYSE, JSE)
- [ ] SACCO/Cooperative investments
- [ ] Real estate tracking
- [ ] Broker API integration (Pangaea, SBZ)

### Phase 7: Offline & Resilience
**Priority: NICE-TO-HAVE**

- [ ] **Offline Mode Implementation**:
  - [ ] IndexedDB data caching
  - [ ] Service worker for offline access
  - [ ] Background sync queue
  - [ ] Conflict resolution logic
- [ ] Low-connectivity optimizations
- [ ] Progressive loading for slow connections

### Phase 8: Future Enhancements
**Priority: BACKLOG**

- [ ] Tax-Loss Harvesting Report (when CGT introduced)
- [ ] AI-powered investment insights
- [ ] Portfolio rebalancing recommendations
- [ ] Social/community features (anonymized comparisons)

---

## 8. Success Metrics

### User Engagement
- [ ] 80%+ of users add at least one holding within first week
- [ ] Average 3+ portfolio checks per week
- [ ] 60%+ of users track multi-currency holdings

### Accuracy
- [ ] FX rates within 0.5% of Bank of Zambia official rates
- [ ] Performance calculations match manual calculations (100% accuracy)
- [ ] WHT calculations correct for all dividend transactions

### Performance
- [ ] Holdings page loads in <2 seconds
- [ ] Performance chart renders in <1 second
- [ ] Auto-price updates complete in <30 seconds

---

## 9. Testing Requirements

### Unit Tests
- [ ] Cost basis calculations (FIFO, average cost)
- [ ] FX gain/loss calculations
- [ ] WHT deductions
- [ ] Performance return calculations (time-weighted)

### Integration Tests
- [ ] Full transaction flow (Buy → Hold → Sell)
- [ ] Multi-currency portfolio valuation
- [ ] Benchmark comparison accuracy
- [ ] CSV import/export

### User Acceptance Testing
- [ ] Test with real LuSE stocks (CEC, SCZ)
- [ ] Test with USD investment account
- [ ] Test with GRZ Bonds and T-Bills
- [ ] Test tax report generation

---

## 10. Documentation

- [ ] User guide: "Getting Started with Investments"
- [ ] FAQ: "Understanding Zambian investment taxation"
- [ ] Video tutorial: "Adding your first holding"
- [ ] API documentation for developers
- [ ] Broker integration guide (for Pangaea, SBZ)

---

## Appendices

### A. Zambian Financial Market Data Sources

**LuSE Stocks**:
- Website: https://www.luse.co.zm
- Manual price entry required (no API)

**Bank of Zambia FX Rates**:
- Website: https://www.boz.zm
- API: https://www.boz.zm/exchange-rates (if available)
- Fallback: XE.com API

**GRZ Bond Yields**:
- Source: Bank of Zambia weekly auctions
- Website: https://www.boz.zm/government-securities

**Unit Trust NAVs**:
- Madison: https://www.madison.co.zm
- Prudential: Contact directly
- ABC: Contact directly

### B. Sample Zambian Portfolio

Realistic example for testing:
```
Total Portfolio Value: K388,500 (≈ $14,127 USD)

Holdings:
1. CEC (LuSE)          - 500 shares @ K12.50  = K6,250
2. Apple (AAPL)        - 10 shares @ $150.00  = K41,250
3. Madison MMF         - 1,250 units @ K10.00 = K12,500
4. GRZ 10Y Bond        - K50,000 nominal       = K50,000
5. GRZ 5Y Bond         - K75,000 nominal       = K75,000
6. Stanbic Term Deposit- K100,000 @ 12% p.a.  = K103,000
7. Airtel Na Sova      - K25,000 @ 10% p.a.   = K25,500
8. Treasury Bills 91D  - K50,000 face value   = K48,000
9. Prudential Equity   - 2,700 units @ K10.00 = K27,000

Currency Breakdown:
- ZMW: K347,250 (89%)
- USD: K41,250 (11%)

Asset Class:
- Stocks: K47,500 (12%)
- Fixed Income: K276,000 (71%)
- Cash & MM: K65,000 (17%)
```

### C. Competitor Analysis

**Monarch Money** (US):
✅ Excellent UI/UX
✅ Strong performance tracking
✅ Multiple benchmarks
❌ No multi-currency support
❌ No manual price entry

**Personal Capital** (US):
✅ Great asset allocation
✅ Retirement planning
❌ US-only institutions
❌ Limited emerging market support

**Our Competitive Advantage**:
✅ Multi-currency (ZMW, USD, ZAR)
✅ Zambian asset classes (LuSE, GRZ, mobile money)
✅ Manual price entry (for LuSE)
✅ GRZ Bonds & Treasury Bills support
✅ FX gain/loss tracking
✅ Zambian tax compliance (WHT, ZRA export)

---

**Last Updated**: 2026-01-05
**Version**: 2.0
**Maintainer**: Personal Finance App Team
