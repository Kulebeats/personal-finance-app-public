#  Local PostgreSQL Setup - Quick Guide

> [!NOTE]
> Deprecated. Use `docs/setup/database-setup.md` as the authoritative guide.

## Step-by-Step Instructions

### Step 1: Run Setup Script (As Administrator)

1. Navigate to the `finance-app` folder
2. **Right-click** on `scripts/windows/setup-local-db.bat`
3. Select **"Run as administrator"**
4. Enter your PostgreSQL password when prompted (default: `postgres`)

This script will:
-  Register PostgreSQL service
-  Start the service
-  Create `finance_app` database
-  Verify the connection

---

### Step 2: Update .env File

Open `finance-app/.env` and update the password:

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/finance_app
```

Replace `YOUR_PASSWORD` with your actual PostgreSQL password.

---

### Step 3: Run Database Migration

Open a regular Command Prompt (not as admin) in the `finance-app` folder:

```cmd
npm run db:push
```

This will create all the tables in your database.

---

### Step 4: Verify Everything Works

```cmd
npm run dev
```

Your app should start on http://localhost:5000

---

##  Troubleshooting Scripts

If you encounter issues, use these helper scripts:

### Check PostgreSQL Status
```cmd
scripts/windows/check-postgres.bat
```
Shows if PostgreSQL is running and if the database exists.

### Start PostgreSQL Service
```cmd
scripts/windows/start-postgres.bat
```
(Run as Administrator) - Starts the PostgreSQL service.

### Create Database Only
```cmd
scripts/windows/create-database.bat
```
Creates the `finance_app` database if it doesn't exist.

---

##  Common Issues

### Issue 1: "Access Denied" or "Permission Error"
**Solution:** Run the script as Administrator (right-click  Run as administrator)

### Issue 2: "Port 5432 is already in use"
**Check what's using the port:**
```cmd
netstat -ano | findstr :5432
```

**Solution:** Either stop the other process or configure PostgreSQL to use a different port.

### Issue 3: "Password authentication failed"
**Solution:** 
1. Find your PostgreSQL password (check your installation notes)
2. Update the `.env` file with the correct password
3. Or reset the password using pgAdmin

### Issue 4: "Data directory not found"
**Solution:** PostgreSQL data directory might be in a different location. Check:
- `C:\Program Files\PostgreSQL\18\data`
- `C:\PostgreSQL\data`
- Or wherever you installed PostgreSQL

---

##  Success Indicators

You'll know everything is working when:

1.  `scripts/windows/setup-local-db.bat` completes without errors
2.  `npm run db:push` creates all tables successfully
3.  `npm run dev` starts the server without database errors
4.  You can register a user at http://localhost:5000

---

##  What Gets Created

After running `npm run db:push`, you'll have these tables:

**User Tables:**
- users
- user_display_settings
- user_notification_preferences
- user_quiet_hours
- user_two_factor_auth
- user_sessions
- user_login_history

**Household Tables:**
- households
- household_members
- household_preferences
- household_invitations

**Financial Tables:**
- category_groups
- categories
- merchants
- merchant_aliases
- tags

**Rules & Data:**
- rules
- rule_execution_log
- data_exports
- data_imports

**Session Table:**
- session (created automatically by express-session)

---

##  Next Steps After Setup

Once your database is running:

1. **Test Authentication:**
   - Register a new user
   - Login
   - Check that session persists

2. **Explore the Database:**
   - Use pgAdmin or any PostgreSQL client
   - Connect to: `localhost:5432/finance_app`
   - Browse the tables and schema

3. **Continue Development:**
   - Phase 2: Profile Settings API and UI
   - Phase 3: Display Settings
   - Phase 4: Notification Settings
   - And more...

---

##  Pro Tips

- **Use pgAdmin:** Install pgAdmin 4 for a visual database management tool
- **Backup:** PostgreSQL data is in `C:\Program Files\PostgreSQL\18\data`
- **Logs:** Check PostgreSQL logs if something goes wrong
- **Service:** PostgreSQL will auto-start on Windows boot once registered

---

##  Still Having Issues?

If you're still stuck after trying the troubleshooting steps:

1. Check the detailed guide: `local-database-setup.md`
2. Or consider using a cloud database (Neon.tech) - it's much simpler!

---

**Ready? Run `scripts/windows/setup-local-db.bat` as Administrator to get started! **


