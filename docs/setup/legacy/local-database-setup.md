# Local PostgreSQL Database Setup

> [!NOTE]
> Deprecated. Use `docs/setup/database-setup.md` as the authoritative guide.

## Current Status
- PostgreSQL 18 is installed at: `C:\Program Files\PostgreSQL\18`
- PostgreSQL service is not running

## Option 1: Start PostgreSQL Service (Recommended)

### Step 1: Register and Start PostgreSQL Service

Open **Command Prompt as Administrator** and run:

```cmd
cd "C:\Program Files\PostgreSQL\18\bin"
pg_ctl register -N "postgresql-18" -D "C:\Program Files\PostgreSQL\18\data"
net start postgresql-18
```

### Step 2: Create Database

Once the service is running, open a new Command Prompt and run:

```cmd
cd finance-app
scripts/windows/setup-db.bat
```

When prompted for password, enter your PostgreSQL password (default is usually `postgres`).

### Step 3: Update .env File

Edit `finance-app/.env` and update the password in the DATABASE_URL:

```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/finance_app
```

Replace `YOUR_PASSWORD` with your actual PostgreSQL password.

### Step 4: Run Database Migration

```cmd
cd finance-app
npm run db:push
```

This will create all the tables in your database.

---

## Option 2: Use Cloud Database (Easier - Recommended)

If you're having trouble with local PostgreSQL, using a cloud database is much simpler:

### Neon (Recommended - Free Tier)

1. Go to https://neon.tech
2. Sign up for a free account
3. Create a new project
4. Copy the connection string
5. Update `finance-app/.env`:
   ```
   DATABASE_URL=postgresql://user:password@host.neon.tech/database?sslmode=require
   ```
6. Run: `npm run db:push`

### Supabase (Alternative - Free Tier)

1. Go to https://supabase.com
2. Sign up and create a new project
3. Go to Settings  Database
4. Copy the connection string (Connection pooling)
5. Update `finance-app/.env` with the connection string
6. Run: `npm run db:push`

---

## Option 3: Manual PostgreSQL Setup

If the service registration doesn't work, you can run PostgreSQL manually:

### Step 1: Initialize Database (if not already done)

```cmd
cd "C:\Program Files\PostgreSQL\18\bin"
initdb -D "C:\PostgreSQL\data" -U postgres
```

### Step 2: Start PostgreSQL Server

```cmd
pg_ctl -D "C:\PostgreSQL\data" -l logfile start
```

### Step 3: Create Database

```cmd
createdb -U postgres finance_app
```

### Step 4: Update .env and Run Migration

Update `finance-app/.env` with your connection string, then:

```cmd
cd finance-app
npm run db:push
```

---

## Troubleshooting

### PostgreSQL Service Won't Start

1. Check if port 5432 is already in use:
   ```cmd
   netstat -ano | findstr :5432
   ```

2. If another process is using it, either:
   - Stop that process
   - Or configure PostgreSQL to use a different port

### Connection Refused Error

- Make sure PostgreSQL service is running
- Check if firewall is blocking port 5432
- Verify the connection string in `.env` is correct

### Permission Denied

- Make sure you're running Command Prompt as Administrator
- Check PostgreSQL data directory permissions

---

## Verify Setup

Once everything is configured, test the connection:

```cmd
cd finance-app
node -e "require('./server/db.js').pool.query('SELECT NOW()').then(r => console.log(' Database connected:', r.rows[0]))"
```

If you see a timestamp, your database is connected successfully!

---

## Recommended: Use Cloud Database

For development, I strongly recommend using a cloud database like Neon or Supabase:

**Pros:**
-  No local setup required
-  Always available
-  Free tier available
-  Automatic backups
-  Better performance
-  No port conflicts

**Cons:**
-  Requires internet connection
-  Data stored externally

For a production app, cloud databases are the standard approach.


