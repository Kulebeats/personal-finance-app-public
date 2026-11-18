# Personal Finance App

A full-stack personal finance platform for households. Track accounts, transactions, budgets, goals, investments, and reports with a modern React client and a Node/Express API.

## Product Overview

Built for households that want a unified view of cash flow, spending, savings, and investments. The platform combines daily transaction workflows with analytics, automation, and auditability.

## Key Capabilities

- Accounts and transactions with search, filters, and categorization
- Budgets, category groups, rollups, and forecasting views
- Merchants with analytics, deduplication, and exports
- Rules engine for automatic categorization and cleanup
- Reports and dashboards: cash flow, net worth, spending, savings rate
- Receipts, attachments, and OCR ingestion
- Investments tracking and tax reporting
- Household management, preferences, and security settings

## Demo and Screens

- Demo walkthrough: `docs/features/feature-showcase.md`
- Feature guide: `docs/features/features.md`

## Tech Stack

- Frontend: React + Vite + TypeScript + Tailwind
- Backend: Node.js + Express + Drizzle ORM
- Database: PostgreSQL

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+

### Install

```
npm install
```

### Environment

Copy `.env.example` to `.env` and fill in required values
(database, session secret, SMTP if needed).

### Database

```
npm run db:push
```

## Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection string |
| `SESSION_SECRET` | Yes | Session signing secret |
| `CLIENT_URL` | Prod only | CORS origin for the client |
| `REDIS_URL` | Optional | Distributed rate limiting |

### Run (Dev)

```
npm run dev
```

In a second terminal:

```
npm run dev:client
```

## Project Structure

- `client/` - React client
- `server/` - Express API
- `shared/` - Shared types and schemas
- `docs/` - System, compliance, and product docs
- `migrations/` - Database migrations
- `scripts/` - Tooling and Windows setup scripts
- `tasks/` - Task and planning notes

## Scripts

- `npm run test` - client tests (watch)
- `npm run test:run` - client tests (run once)
- `npm run test:server:run` - server tests (run once)
- `npm run build` - build client + server bundle
- `npm run start` - run production bundle

## Security and Compliance

Security architecture, privacy controls, and compliance alignment live in `docs/security/` and `docs/compliance/`.
See `docs/security/security-architecture.md` and `docs/compliance/compliance-summary.md` for current status.

## Data and Privacy

- Data handling and retention: `docs/compliance/data-privacy.md`
- Export formats and audit notes: `docs/features/data-export.md`

## Deployment Notes

- Production build: `npm run build` then `npm run start`
- Health endpoint: `GET /healthz` (see `docs/system/health.md`)
- Uploads served from `/uploads`

## Performance Notes

- Add database indexes for high-volume reporting and merchant analytics as usage grows.
- If report payloads become large, shift filters to server-side query params.

## Documentation

See `docs/README.md` for system docs, security/compliance, setup, and specs.
Key product references live in `docs/features/features.md` and `docs/features/feature-showcase.md`.
Security, compliance, and SDLC artifacts live in `docs/security/`, `docs/compliance/`, and `docs/sdlc/`.

## Contributing

Internal repo. Document changes in `docs/operations/changelog.md` and keep docs up to date.

## Changelog

- Project changelog (Keep a Changelog format): `docs/operations/changelog.md`
- AI change logs live in `docs/operations/ai-changelog/`.
- Latest: [June 2026 — Production-Readiness Remediation](docs/operations/ai-changelog/2026-06-production-readiness-remediation.md)
  (~40 PRs: CI/deploy, DPA audit logging, AI PII sanitizer, Money/FX, atomic writes, real-DB tests).
