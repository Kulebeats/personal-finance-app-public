# Database Setup

## Personal Finance Application

**Authoritative Guide** — This document consolidates and supersedes the legacy setup docs (archived in `docs/setup/legacy/`):

- `docs/setup/legacy/database-quickstart.md`
- `docs/setup/legacy/database-readme.md`
- `docs/setup/legacy/database-setup-steps.md`
- `docs/setup/legacy/local-database-setup.md`
- `docs/setup/legacy/reset-db-password.md`

---

## Quick Start (3 Steps)

### 1. Create Database

**Option A: Automated (Windows)**

```bash
scripts/windows/setup-database-interactive.bat
```

**Option B: Manual**

```bash
psql -U postgres -h localhost
CREATE DATABASE finance_app;
\q
```

### 2. Configure Environment

Copy `.env.example` to `.env` and set:

```bash
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/finance_app
SESSION_SECRET=your-minimum-32-char-secret-here
```

### 3. Run Migrations

```bash
npm run db:push
```

---

## Cloud Alternatives (Recommended for Development)

| Provider                         | Free Tier | SSL Required | Setup Time |
| -------------------------------- | --------- | ------------ | ---------- |
| [Neon](https://neon.tech)        | ✅ Yes    | ✅ Yes       | 2 min      |
| [Supabase](https://supabase.com) | ✅ Yes    | ✅ Yes       | 5 min      |
| [Railway](https://railway.app)   | ✅ Trial  | ✅ Yes       | 3 min      |

**Connection String Format:**

```bash
DATABASE_URL=postgresql://user:pass@host.neon.tech/dbname?sslmode=require
```

---

## Schema Structure

After running migrations, you'll have these tables:

**Core**

- `households` - Multi-tenant isolation unit
- `users` - User accounts with MFA fields
- `session` - Express-session storage

**Financial Data**

- `accounts` - Bank accounts, credit cards, investments
- `transactions` - All financial transactions
- `categories` / `category_groups` - Transaction categorization
- `budgets` - Category budgets with rollover
- `goals` - Savings and investment goals
- `investments` / `securities` / `holdings` - Investment tracking

**Settings**

- `user_display_settings` - UI preferences
- `user_notification_preferences` - Notification config
- `rules` / `rule_execution_log` - Auto-categorization rules

---

## Commands Reference

| Command                 | Purpose                  |
| ----------------------- | ------------------------ |
| `npm run db:push`       | Apply schema changes     |
| `npm run db:generate`   | Generate migration files |
| `npm run db:studio`     | Open Drizzle Studio GUI  |
| `npm run db:test:reset` | Reset test database      |

**psql Quick Reference:**

```bash
psql -U postgres -d finance_app   # Connect
\dt                                # List tables
\d users                           # Describe table
\q                                 # Exit
```

---

## Troubleshooting

### "Password authentication failed"

1. Reset password: `docs/setup/legacy/reset-db-password.md` (archived)
2. Or use cloud database (see above)

### "Database does not exist"

```bash
psql -U postgres -c "CREATE DATABASE finance_app;"
```

### "Connection refused"

Check PostgreSQL service:

```bash
# Windows
sc query postgresql-x64-18
net start postgresql-x64-18

# Linux/macOS
sudo systemctl status postgresql
sudo systemctl start postgresql
```

### Port 5432 in use

```bash
netstat -ano | findstr :5432
# Kill the process or use a different port
```

---

## Environment Variables

| Variable         | Required | Description                            |
| ---------------- | -------- | -------------------------------------- |
| `DATABASE_URL`   | ✅       | PostgreSQL connection string           |
| `SESSION_SECRET` | ✅       | 32+ char secret for sessions           |
| `REDIS_URL`      | ❌       | Optional for distributed rate limiting |

---

## Migrations

### Creating a Migration

1. Update `shared/schema.ts`
2. Generate migration: `npm run db:generate`
3. Review generated SQL in `drizzle/`
4. Apply: `npm run db:push`

### Rolling Back

Drizzle Kit doesn't support automatic rollback. For rollbacks:

1. Restore from backup
2. Or manually write reverse migration

---

## Production Setup

See [deployment.md](../system/deployment.md) for production configuration including:

- Connection pooling
- SSL enforcement
- Backup strategy
- Monitoring

---

_Document consolidated: 2026-02-06_
