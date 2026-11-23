# GRZ Government Securities Auction Data

This document stores reference data for Bank of Zambia Government Bond and Treasury Bill auctions.
Data retrieved: January 5, 2026.

## Government Bonds (November 2025 Auction)

Date: November 21, 2025
Tender No: 11/2025/BA

| Tenor    | Yield Rate (Coupon) | Notes |
| -------- | ------------------- | ----- |
| 2 Years  | 15.00%              |       |
| 3 Years  | 16.00%              |       |
| 5 Years  | 16.49%              |       |
| 7 Years  | 17.00%              |       |
| 10 Years | 17.50%              |       |
| 15 Years | 18.99%              |       |

**Notes:**

- Effective January 2024, bonds are issued at **Par Value**.
- Purchase Price = Face Value (typically).
- Coupon Rate matches the Cut-off Yield Rate at issuance.
- Day Count Convention: **Actual/365**. The app applies this as a policy default, pending OI-03; see [grz-policy-defaults.md](grz-policy-defaults.md).

## Treasury Bills (November/December 2025)

| Tenor    | Average Yield | Notes |
| -------- | ------------- | ----- |
| 91 Days  | 11.50%        |       |
| 182 Days | N/A           |       |
| 273 Days | N/A           |       |
| 364 Days | N/A           |       |

**Notes:**

- Issued at discount.
- Day Count Convention: **Actual/365**. The app applies this as a policy default, pending OI-03; see [grz-policy-defaults.md](grz-policy-defaults.md).
