# Investment Analysis & Tracking Requirements

## 1. Overview

The goal is to implement a robust investment tracking feature modeled after Monarch Money, tailored specifically for the Zambian market context. This feature will allow users to track their net worth, portfolio performance, and asset allocation across various asset classes including local Zambian investments and offshore holdings.

## 2. 'Monarch Way' Features

The system will adopt the following core features from Monarch Money's investment philosophy:

- **Comprehensive Holdings View**: A detailed list of all owned securities/assets with current value, quantity, price, and daily change.
- **Asset Allocation**: Visual breakdown of the portfolio by asset class (Stock, Bond, Cash, etc.) and sector.
- **Performance Tracking**: Historical value charts (Time-Weighted Return or simple value history) to visualize wealth growth over time.
- **Transaction History**: Specific record-keeping for investment activities (Buy, Sell, Dividends, Interest, Fees).

## 3. Zambian Context Requirements

The feature MUST support specific Zambian financial application needs:

### 3.1. Currency & formatting

- **Primary Currency**: ZMW (Zambian Kwacha).
- **Exchange Rates**: Ability to hold assets in USD/GBP/ZAR but view total portfolio value in ZMW (future requirement, basic ZMW/USD toggle for now).

### 3.2. Asset Classes

Support for common Zambian investment vehicles:

- **LuSE Stocks**: Companies listed on the Lusaka Securities Exchange (e.g., CEC, SCZ, ZAMEFA, SHOPRITE).
- **GRZ Bonds**: Government of the Republic of Zambia securities (2yr, 3yr, 5yr, 7yr, 10yr, 15yr bonds).
- **Treasury Bills**: Short-term government debt (91, 182, 273, 364 days).
- **Unit Trusts**: Collective investment schemes (e.g., Madison Money Market, Prudential, ABC Asset Management).
- **Fixed/Term Deposits**: Bank-specific savings with fixed interest.
- **Mobile Money Savings**: e.g., Airtel Money Na Sova, MTN Kongola (if applicable as savings/loan).

### 3.3. Institutions (Banks & Brokers)

Leverage existing seed data for Zambian institutions:

- **Banks**: Zanaco, Stanbic, FNB Zambia, Standard Chartered, Absa, Atlas Mara.
- **Brokers**: Pangaea Securities, Stockbrokers Zambia (SBZ).

## 4. Technical Requirements

### 4.1. Data Model Changes

- **`securities` Table**:
  - `id`, `symbol` (e.g., "CEC.LuSE", "VTI"), `name`, `type` (Stock, Bond, MUTUAL_FUND), `currency` (ZMW, USD), `current_price`, `last_updated`.
- **`holdings` Table**:
  - `id`, `account_id`, `security_id`, `quantity`, `cost_basis`, `acquired_date`.
- **`security_prices` Table**:
  - Historical price data for performance charting (`security_id`, `date`, `price`).

### 4.2. Functional Capabilities

- **Manual Price Updates**: Since automated feeds for LuSE are likely unavailable, allow easy manual entry of current prices.
- **Manual Transactions**: Forms to record "Buy", "Sell", "Dividend Reinvestment".
- **Dashboard**: Update main dashboard to include Investment Summary widget.

## 5. User Interface

- **Refactor `client/src/pages/Investments.tsx`**:
  - Replace mock `recharts` data with data fetched from the new tables.
  - specialized "Add Holding" modal finding securities or creating custom ones.
  - Support "ZMW" symbol in all displays.
