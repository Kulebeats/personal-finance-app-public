# Compliance Summary (Quick View)

## Purpose

This is a short, high-level summary of compliance readiness for common fintech frameworks. It is not a certification.

For the authoritative mapping and evidence references, see `docs/compliance/compliance.md`.

## Assumptions (confirm)

- The app does not store or process payment card data.
- The app does not initiate payments on behalf of users.
- The app is currently for personal use and not a regulated production service.

If any assumption changes, update this mapping.

## Framework Status

| Framework | Scope                                 | Status                    | Notes                                                              |
| --------- | ------------------------------------- | ------------------------- | ------------------------------------------------------------------ |
| PCI DSS   | Cardholder data environment           | Not in scope (assumption) | If card data is stored or processed, PCI DSS applies.              |
| GDPR      | EU personal data processing           | Partial                   | Data subject rights and retention policy are not fully documented. |
| PSD2      | Payment initiation and account access | Not in scope (assumption) | Applies if regulated payment services are added.                   |

## Key Gaps To Address

- Define a data retention and deletion policy (GDPR).
- Add data export and account deletion workflows (GDPR).
- Formalize incident response and breach notification (GDPR).
- Document access controls, logging, and change management (PCI DSS baseline).
