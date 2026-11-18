#  Database Setup Complete Guide

> [!NOTE]
> Deprecated. Use `docs/setup/database-setup.md` as the authoritative guide.

##  You Are Here: Local PostgreSQL Setup

PostgreSQL 18 is installed on your machine. Let's get it running!

---

##  Quick Start (3 Commands)

### 1 Run Setup (As Administrator)

Right-click `scripts/windows/setup-local-db.bat`  **Run as administrator**

```
 Registers PostgreSQL service
 Starts the service  
 Creates finance_app database
 Verifies connection
```

### 2 Update Password

Edit `.env` file:
```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/finance_app
```

### 3 Create Tables

```cmd
npm run db:push
```

**Done! **

---

##  Files Created for You

| File | Purpose |
|------|---------|
| `scripts/windows/setup-local-db.bat` | **Main setup script** - Run this first (as admin) |
| `scripts/windows/check-postgres.bat` | Check if PostgreSQL is running |
| `scripts/windows/start-postgres.bat` | Start PostgreSQL service (as admin) |
| `scripts/windows/create-database.bat` | Create database only |
| `database-setup-steps.md` | Detailed step-by-step guide |
| `local-database-setup.md` | Troubleshooting and alternatives |

---

##  What Happens When You Run `npm run db:push`

```
 Creating 20+ tables:

Users & Auth:
   users
   user_display_settings
   user_notification_preferences
   user_quiet_hours
   user_two_factor_auth
   user_sessions
   user_login_history

Households:
   households
   household_members
   household_preferences
   household_invitations

Financial:
   category_groups
   categories
   merchants
   merchant_aliases
   tags

Rules & Data:
   rules
   rule_execution_log
   data_exports
   data_imports

 Database ready!
```

---

##  Test Your Setup

After setup, test the authentication:

```bash
# Start the server
npm run dev

# In another terminal, test registration
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"testuser\",\"email\":\"test@example.com\",\"password\":\"Test123!@#\",\"fullName\":\"Test User\"}"
```

You should see:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "...",
      "username": "testuser",
      "email": "test@example.com",
      "fullName": "Test User"
    }
  }
}
```

---

##  Troubleshooting

### "Access Denied"
 Run `scripts/windows/setup-local-db.bat` as Administrator

### "Port 5432 already in use"
```cmd
netstat -ano | findstr :5432
```
Stop the process or use a different port

### "Password authentication failed"
 Update password in `.env` file

### "Service won't start"
 Check `local-database-setup.md` for detailed troubleshooting

### Still stuck?
Run `scripts/windows/check-postgres.bat` to diagnose the issue

---

##  Understanding the Setup

### What is PostgreSQL?
A powerful, open-source relational database. Your finance app stores all data here.

### Why Local Setup?
-  Full control
-  No internet required
-  Free forever
-  Fast development

### Service vs Manual
- **Service**: Auto-starts with Windows (recommended)
- **Manual**: You start/stop it yourself

---

##  Security Notes

### Default Password
PostgreSQL default password is usually `postgres`. Change it for production!

### Connection String
Never commit `.env` file to git. It contains your database password.

### Session Secret
Update `SESSION_SECRET` in `.env` for production:
```env
SESSION_SECRET=generate-a-random-string-here
```

---

##  Database Management Tools

### pgAdmin 4 (Recommended)
Visual database management tool that comes with PostgreSQL.

**Access:**
- Start Menu  PostgreSQL 18  pgAdmin 4
- Connect to: `localhost:5432`
- Database: `finance_app`

### Command Line
```cmd
# Connect to database
psql -U postgres -d finance_app

# List tables
\dt

# Describe table
\d users

# Run query
SELECT * FROM users;

# Exit
\q
```

---

##  Next Steps After Database Setup

1.  Database is running
2.  Tables are created
3.  Authentication works

**Now you can:**
- Start building the Settings UI (Phase 2)
- Test user registration and login
- Explore the database with pgAdmin
- Continue with the implementation plan

---

##  Pro Tips

1. **Backup Your Data**
   ```cmd
   pg_dump -U postgres finance_app > backup.sql
   ```

2. **Restore From Backup**
   ```cmd
   psql -U postgres -d finance_app < backup.sql
   ```

3. **Reset Database**
   ```cmd
   psql -U postgres -c "DROP DATABASE finance_app;"
   psql -U postgres -c "CREATE DATABASE finance_app;"
   npm run db:push
   ```

4. **View Logs**
   Check: `C:\Program Files\PostgreSQL\18\data\log\`

---

##  Need Help?

1. Check `database-setup-steps.md` for detailed instructions
2. Check `local-database-setup.md` for troubleshooting
3. Run `scripts/windows/check-postgres.bat` to diagnose issues
4. Or use cloud database (Neon.tech) for simpler setup

---

**Ready to start? Run `scripts/windows/setup-local-db.bat` as Administrator! **


