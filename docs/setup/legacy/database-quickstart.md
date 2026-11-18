# Database Quick Start Guide

> [!NOTE]
> Deprecated. Use `docs/setup/database-setup.md` as the authoritative guide.

##  PostgreSQL 18 is Installed and Running!

Your system has PostgreSQL 18 installed at:
```
C:\Program Files\PostgreSQL\18\bin
```

##  Quick Setup (3 Steps)

### Step 1: Run the Setup Script

Open Command Prompt in the `finance-app` folder and run:

```bash
scripts/windows/setup-database-interactive.bat
```

This will:
1. Ask for your PostgreSQL password
2. Create the `finance_app` database
3. Update your `.env` file
4. Run database migrations to create all tables

### Step 2: Verify Database

Check that everything is working:

```bash
scripts/windows/check-database.bat
```

### Step 3: Start the App

```bash
npm run dev
```

The app will be available at http://localhost:5000

##  Manual Setup (If Scripts Don't Work)

### 1. Find Your PostgreSQL Password

When you installed PostgreSQL, you set a password for the `postgres` user. If you don't remember it, you may need to reset it.

### 2. Create Database Manually

Open Command Prompt and run:

```bash
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost
```

Enter your password, then run:

```sql
CREATE DATABASE finance_app;
\q
```

### 3. Update .env File

Edit `finance-app/.env` and set:

```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/finance_app
```

Replace `YOUR_PASSWORD` with your actual PostgreSQL password.

### 4. Run Migrations

```bash
npm run db:push
```

##  Troubleshooting

### "Password authentication failed"

Your PostgreSQL password is incorrect. Try:
1. Check if you remember the password from installation
2. Reset the password using pgAdmin (if installed)
3. Or reinstall PostgreSQL

### "Database already exists"

That's fine! Just run:
```bash
npm run db:push
```

### "Cannot connect to server"

Check if PostgreSQL is running:
```bash
sc query postgresql-x64-18
```

If it's not running, start it:
```bash
net start postgresql-x64-18
```

##  Database Structure

After setup, you'll have these tables:

**Users & Auth:**
- users
- user_display_settings
- user_notification_preferences
- user_quiet_hours
- user_two_factor_auth
- user_sessions
- user_login_history

**Households:**
- households
- household_members
- household_preferences
- household_invitations

**Financial Data:**
- category_groups
- categories
- merchants
- merchant_aliases
- tags
- rules
- rule_execution_log
- data_exports
- data_imports

**Session Store:**
- session (created automatically by express-session)

##  Next Steps

Once your database is set up:

1. **Start the dev server:**
   ```bash
   npm run dev
   ```

2. **Test the auth endpoints:**
   - Register: `POST /api/auth/register`
   - Login: `POST /api/auth/login`
   - Get user: `GET /api/auth/me`

3. **Check the setup guide:**
   See `setup.md` for detailed information about what's been implemented.

##  Useful Commands

```bash
# Check database status
scripts/windows/check-database.bat

# Connect to database
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d finance_app

# View all tables
\dt

# View table structure
\d users

# Exit psql
\q
```

##  Default Credentials

After running the setup, you can create a test user:

```bash
# Register via API
curl -X POST http://localhost:5000/api/auth/register ^
  -H "Content-Type: application/json" ^
  -d "{\"username\":\"testuser\",\"email\":\"test@example.com\",\"password\":\"Test123!@#\",\"fullName\":\"Test User\"}"
```

Password requirements:
- Minimum 8 characters
- At least 1 uppercase letter
- At least 1 number
- At least 1 special character


