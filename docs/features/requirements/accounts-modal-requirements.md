# Accounts Modal UI Requirements (Manual Only - Zambia)

Status: Ready for implementation  
Version: 1.0  
Last updated: 2025-12-17

This document defines UI and functional requirements for the Add Account modal. Accounts are added manually only. The Zambian bank list and mobile money providers in code must remain unchanged.

Related:

- `docs/implementation-plan-v7-final.md`
- `docs/transactions-section-requirements.md`
- `shared/schema.ts` (accounts + transactions)
- `client/src/components/AddAccountModal.tsx`

## Scope

### In scope (v1)

- Add Account modal (manual only) with a multi-step flow
- Zambian bank and mobile money provider selection
- Initial balance capture
- Account type mapping to the data model
- Linking accounts to transactions and balance adjustments

### Out of scope (v1)

- Auto-updated investment prices

## Canonical invariants (must not be violated)

1. `accounts.balance` is authoritative; it is updated via transaction create/update/delete and balance adjustments.
2. `initial_balance` is stored on account creation and used as the starting point for balance reconciliation.
3. Household scoping: all reads/writes must filter by `household_id` first.
4. Privacy: private accounts are only visible to their owner.

## UX goals

- Adding accounts is the first step for new users to see net worth and enable transactions.
- The modal should be fast, clear, and require no credential entry.
- Manual-only flow is explicit: no "Connect" steps or data-provider selection.

## Modal flow

### Trigger

- Accounts page top-right "Add account" button (web).
- Mobile: "+" action in Accounts header.

### Step 1: Account type selection

Grid of type cards with icon + label + short sublabel:

- Bank Account (FNB, ZANACO, Absa...)
- Mobile Money (Airtel, MTN, Zamtel)
- Cash (Physical Cash)
- Investment (BOZ Bonds, Stocks)
- Credit Card (Visa, Mastercard)
- Property (Real Estate, Land)
- Vehicle (Car, Boat, RV)
- Other (Custom Asset)

### Step 2: Account details form

Common fields (all types):

- Account Name (required)
- Institution / Platform (optional; required if bank = Other)
- Initial Balance (numeric)
- Notes (optional)
- Currency (default ZMW; selectable for bank accounts - see foreign currency section)

Type-specific fields:

Bank Account:

- Select Bank (required; list below)
- Account Type (checking, savings, CD)
- Currency (dropdown; see "Foreign currency accounts" below)
- If bank = Other, show free-text "Bank Name"

### Foreign currency accounts

Zambian banks offer multi-currency accounts. When "Bank Account" is selected, show a currency dropdown with:

| Currency | Code | Common At |
|----------|------|-----------|
| Zambian Kwacha (default) | ZMW | All banks |
| US Dollar | USD | FNB, Stanbic, Standard Chartered, Absa, ZANACO |
| South African Rand | ZAR | FNB, Stanbic, Absa, ZANACO |
| British Pound | GBP | Standard Chartered, Stanbic, Citibank |
| Euro | EUR | Standard Chartered, Stanbic, Ecobank |
| Botswana Pula | BWP | Stanbic, FNB |

**UI behavior:**

- Default selection: ZMW (Zambian Kwacha)
- Currency symbol updates based on selection (K for ZMW, $ for USD, R for ZAR, £ for GBP, € for EUR)
- Balance input shows the selected currency symbol
- Account list displays currency badge if not ZMW (e.g., "FNB Savings [USD]")

Mobile Money:

- Provider (Airtel Money, MTN MoMo, Zamtel Money)

Cash:

- Initial Balance only

Investment (manual only; no auto pricing):

- Investment Type (see "Zambian investment categories")
- Current Value (numeric)

Credit Card:

- Current Balance (Owed)
- Credit Limit (optional; stored if supported)
- APR % (optional, UI-only if not stored)
- Statement Day (optional, UI-only if not stored)

Property (manual; no Zillow or auto valuation):

- Estimated Value (numeric)
- Purchase Date (optional)
- Address (optional)

Vehicle:

- Estimated Value (numeric)
- Notes (optional)

Other:

- Initial Balance

### Step 3: Success state

- Title: "Account Created"
- Confirmation copy: "Your account has been created. You can now track its balance and transactions."
- Actions:
  - "Add Another Account"
  - "Done"

## Institution branding (logos)

All banks and mobile money providers should display their official logos for visual recognition. Logos improve UX by helping users quickly identify their institutions.

### Logo requirements

- **Format**: PNG or SVG (prefer SVG for scalability)
- **Size**: 24x24px display size (provide 48x48 or 96x96 source for retina)
- **Location**: `client/public/logos/banks/` and `client/public/logos/mobile-money/`
- **Naming convention**: lowercase, hyphenated (e.g., `zanaco.png`, `fnb.png`, `airtel-money.png`)
- **Fallback**: Show first letter initial in a colored circle if logo is missing

### Required bank logos

| Bank | Filename | Status |
|------|----------|--------|
| Absa Bank Zambia | `absa.png` | Missing |
| Access Bank Zambia | `access-bank.png` | Missing |
| Atlas Mara (BancABC) | `atlas-mara.png` | Missing |
| Bank of China (Zambia) | `bank-of-china.png` | Missing |
| Citibank Zambia | `citibank.png` | Missing |
| Ecobank Zambia | `ecobank.png` | Missing |
| First Capital Bank | `first-capital.png` | Missing |
| First National Bank (FNB) | `fnb.png` | Missing |
| Indo-Zambia Bank | `indo-zambia.png` | Missing |
| Investrust Bank | `investrust.png` | Missing |
| Stanbic Bank Zambia | `stanbic.png` | Missing |
| Standard Chartered Bank | `standard-chartered.png` | Missing |
| United Bank for Africa (UBA) | `uba.png` | Missing |
| Zambia National Commercial Bank (ZANACO) | `zanaco.png` | Missing |

### Required mobile money logos

| Provider | Filename | Status |
|----------|----------|--------|
| Airtel Money | `airtel-money.png` | Exists (`airtel.png`) |
| MTN MoMo | `mtn-momo.png` | Missing |
| Zamtel Money | `zamtel-money.png` | Exists (`zamtel.png`) |

### Display specifications

**In dropdowns (Step 2):**

- Logo displayed at 20x20px to the left of institution name
- 8px gap between logo and text
- Use `object-fit: contain` to preserve aspect ratio

**Example dropdown item:**

```text
[Logo] Zambia National Commercial Bank (ZANACO)
```

### Implementation notes

- Create a `BankLogo` component that handles loading and fallback
- Use lazy loading for logos to improve performance
- Consider bundling commonly-used logos inline as base64 for critical path

## Zambian institution lists (must remain as-is in code)

### Zambian banks (manual selection)

Use the list in `client/src/components/AddAccountModal.tsx` exactly:

- Absa Bank Zambia
- Access Bank Zambia
- Atlas Mara (BancABC)
- Bank of China (Zambia)
- Citibank Zambia
- Ecobank Zambia
- First Capital Bank
- First National Bank (FNB)
- Indo-Zambia Bank
- Investrust Bank
- Stanbic Bank Zambia
- Standard Chartered Bank
- United Bank for Africa (UBA)
- Zambia National Commercial Bank (ZANACO)
- Other

### Mobile money providers

- Airtel Money
- MTN MoMo
- Zamtel Money

## Zambian investment categories (manual)

These categories reflect common Zambian investment products and should be offered as manual investment types or platform suggestions:

- Government securities: Treasury Bills and Government Bonds (BoZ auctions)
- Collective Investment Schemes: Unit Trusts / Mutual Funds / Money Market Funds (SEC-regulated)
- Listed equities: Lusaka Securities Exchange (LUSE) stocks
- Retirement / Pension funds
- Fixed Deposits / Term Deposits
- Crypto (manual)
- Other

Notes:

- Investments are manual; prices and balances are updated by the user.
- Do not require external credentials or market feeds.

## Data model mapping

Map UI types to `accountTypeEnum`:

- Bank Account -> checking or savings (based on subtype)
- Mobile Money -> mobile_money
- Cash -> cash
- Investment -> investment
- Credit Card -> credit
- Property -> real_estate
- Vehicle -> vehicle
- Other -> other

## Validation rules

- Account Name: required, 1..255 chars
- Initial Balance: numeric, max 2 decimal places
- For liability accounts (credit, loan): balance represents amount owed (positive)
- Currency: default ZMW; for bank accounts, must be one of: ZMW, USD, ZAR, GBP, EUR, BWP

## Link to transactions (critical behavior)

- Every transaction references an `account_id`.
- Creating/updating/deleting a transaction updates `accounts.balance` via the service layer.
- Manual balance correction uses `POST /api/accounts/:id/adjust-balance` and creates a `balance_adjustment` transaction.

## Acceptance criteria

- Add Account modal works without any credentials.
- Zambian bank and mobile money lists match code exactly.
- Created account is visible in Accounts list and can be used to create transactions.
- Initial balance is stored and reflected in net worth and account balance.
- Bank and mobile money dropdowns display institution logos next to names.
- Missing logos show a fallback (first letter initial in colored circle).
- Bank accounts support foreign currency selection (USD, ZAR, GBP, EUR, BWP).
- Currency symbol in balance input updates based on selected currency.

## Sources (market categories)

- Bank of Zambia: bonds and treasury bills (BoZ auctions).
- Securities and Exchange Commission of Zambia: collective investment schemes.
