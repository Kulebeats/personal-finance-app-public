# How to Reset PostgreSQL Password

> [!NOTE]
> Deprecated. Use `docs/setup/database-setup.md` as the authoritative guide.

The automation failed to connect to your database because the password `postgres` is incorrect. Please follow these steps to reset it.

## Method 1: Using pgAdmin (If installed)

1. Open pgAdmin.
2. Right-click on your server (e.g. "PostgreSQL 18").
3. Select **Properties** -> **Connection**.
4. Change the password there? No, that's for the tool. Use "Login/Group Roles".
5. Expand **Login/Group Roles**.
6. Right-click `postgres` user -> **Properties**.
7. Go to **Definition** tab.
8. Enter `postgres` in the "Password" field.
9. Click **Save**.

## Method 2: Command Line (Windows)

1. Open a new Command Prompt as **Administrator**.
2. Navigate to the bin folder:
   ```cmd
   cd "C:\Program Files\PostgreSQL\18\bin"
   ```
3. Update the password for the `postgres` user:
   ```cmd
   psql -U postgres -c "ALTER USER postgres PASSWORD 'postgres';"
   ```
   _Note: If this asks for a password again and you don't know it, you will need to edit pg_hba.conf to trust all connections temporarily._

## Method 3: 'Trust' Method (If you forgot the password)

1. Go to `C:\Program Files\PostgreSQL\18\data`.
2. Open `pg_hba.conf` in Notepad (as Admin).
3. Scroll to the bottom and change `scram-sha-256` or `md5` to `trust` for IPv4 and IPv6 local connections.
   ```
   # IPv4 local connections:
   host    all             all             127.0.0.1/32            trust
   # IPv6 local connections:
   host    all             all             ::1/128                 trust
   ```
4. Restart the PostgreSQL service:
   ```cmd
   net stop postgresql-18
   net start postgresql-18
   ```
5. Run the password reset command again (Method 2).
6. **Important**: Change `trust` back to `scram-sha-256` in `pg_hba.conf` and restart the service again to secure it.

After doing this, please **Run the App** again.
