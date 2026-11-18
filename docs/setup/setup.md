# Finance App Setup Guide

## Phase 1 Complete: Database Setup and Core Infrastructure 

### What's Been Implemented

#### 1. Database Schema (Task 1) 
- **Comprehensive PostgreSQL schema** with 20+ tables covering:
  - Users and authentication (users, user_display_settings, user_notification_preferences, user_quiet_hours, user_two_factor_auth, user_sessions, user_login_history)
  - Households (households, household_members, household_preferences, household_invitations)
  - Financial configuration (category_groups, categories, merchants, merchant_aliases, tags)
  - Rules engine (rules, rule_execution_log)
  - Data management (data_exports, data_imports)
- **Zod validation schemas** for type-safe data validation
- **TypeScript types** generated from schema

#### 2. Drizzle ORM Configuration (Task 2) 
- Database connection setup in `server/db.ts`
- DatabaseStorage class in `server/storage.ts` with methods for:
  - User CRUD operations
  - Display settings management
  - Notification preferences
  - Household management
  - Category management
- Seed script (`server/seed.ts`) for:
  - Default categories (38 categories across 8 groups)
  - Default notification preferences (10 types)

#### 3. Authentication System (Task 3) 
- **Session-based authentication** with PostgreSQL session store
- **Password security**:
  - bcrypt hashing (12 salt rounds)
  - Complexity validation (8+ chars, uppercase, numbers, special chars)
- **Authentication middleware**:
  - `requireAuth` - Protect routes
  - `attachUser` - Attach user to request
- **Auth endpoints** (`/api/auth`):
  - `POST /register` - Create new user with default settings
  - `POST /login` - Authenticate user
  - `POST /logout` - End session
  - `GET /me` - Get current user

### Files Created/Modified

#### New Files
- `finance-app/server/db.ts` - Database connection
- `finance-app/server/auth.ts` - Authentication middleware
- `finance-app/server/seed.ts` - Database seeding
- `finance-app/server/routes/auth.ts` - Auth endpoints
- `finance-app/.env` - Environment variables
- `finance-app/.env.example` - Environment template

#### Modified Files
- `finance-app/shared/schema.ts` - Complete database schema
- `finance-app/server/storage.ts` - Database storage layer
- `finance-app/server/app.ts` - Session middleware
- `finance-app/server/routes.ts` - Route registration

### Next Steps: Database Setup Required 

You have PostgreSQL 18 installed. Follow these steps:

#### Quick Setup (3 Steps)

**Step 1: Run Setup Script**
1. Navigate to `finance-app` folder
2. Right-click `scripts/windows/setup-local-db.bat`
3. Select "Run as administrator"
4. Enter PostgreSQL password when prompted (default: `postgres`)

**Step 2: Update .env File**
Edit `finance-app/.env` and update the password:
```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/finance_app
```

**Step 3: Run Database Migration**
```bash
cd finance-app
npm run db:push
```

#### Detailed Instructions
See `database-setup.md` for the authoritative guide with troubleshooting.

#### Helper Scripts
- `scripts/windows/setup-local-db.bat` - Complete setup (run as admin)
- `scripts/windows/check-postgres.bat` - Check PostgreSQL status
- `scripts/windows/start-postgres.bat` - Start PostgreSQL service (run as admin)
- `scripts/windows/create-database.bat` - Create database only

### Default Categories

The seed script creates 38 default categories organized into 8 groups:

**Housing & Utilities**: Rent/Mortgage, Electricity, Water, Internet & Phone, Home Maintenance

**Food & Dining**: Groceries, Restaurants, Fast Food, Coffee Shops

**Transportation**: Fuel/Gas, Public Transport, Car Payment, Car Maintenance, Parking

**Personal & Family**: Clothing, Healthcare, Personal Care, Kids, Education, Childcare

**Entertainment & Lifestyle**: Entertainment, Subscriptions, Hobbies, Travel, Gifts

**Financial**: Insurance, Debt Repayment, Savings, Investments, Bank Fees

**Income**: Salary, Freelance, Business Income, Investments, Other Income

**Transfers**: Transfer In, Transfer Out

Plus an "Uncategorized" category for unclassified transactions.

### Default Notification Types

10 notification types are created for each user:
- Account Connection Issues
- Deposits Received
- Expenses
- Budget Exceeded
- Recurring Transactions
- Subscription Reminders
- Transactions Needing Review
- Large Transactions
- Bill Due Reminders
- Goal Achievements

Each type supports 3 channels: In-App, Email, and Push notifications.

### Security Features

- **Password Hashing**: bcrypt with 12 salt rounds
- **Session Security**: HTTP-only cookies, secure in production
- **Password Validation**: Enforces complexity requirements
- **SQL Injection Protection**: Parameterized queries via Drizzle ORM
- **Session Expiration**: 30-day session lifetime

### API Error Format

All API errors follow a consistent format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

Error codes include:
- `VALIDATION_ERROR` - Invalid input
- `UNAUTHORIZED` - Not authenticated
- `FORBIDDEN` - Insufficient permissions
- `NOT_FOUND` - Resource not found
- `DUPLICATE_ENTRY` - Unique constraint violation
- `DATABASE_ERROR` - Database operation failed
- `INVALID_CREDENTIALS` - Wrong email/password

### Testing the Auth System

Once the database is set up, you can test the auth endpoints:

```bash
# Register a new user
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "Test123!@#",
    "fullName": "Test User"
  }'

# Login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!@#"
  }'

# Get current user (requires session cookie)
curl http://localhost:5000/api/auth/me \
  --cookie "connect.sid=YOUR_SESSION_COOKIE"
```

### What's Next: Phase 2

The next phase will implement:
- Profile Settings API and UI
- Profile picture upload
- Timezone selection
- Birthday picker
- Form validation and error handling

See `.kiro/specs/settings-feature/tasks.md` for the complete implementation plan.


