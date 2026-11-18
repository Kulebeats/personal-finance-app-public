@echo off
REM Master setup script for local PostgreSQL

echo ========================================
echo Finance App - Local Database Setup
echo ========================================
echo.
echo This script will help you set up PostgreSQL locally.
echo.
echo Prerequisites:
echo - PostgreSQL 18 is installed at: C:\Program Files\PostgreSQL\18
echo - You know your PostgreSQL password (default: postgres)
echo.
echo ========================================
echo.

REM Check if running as administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ❌ ERROR: This script must be run as Administrator!
    echo.
    echo Please:
    echo 1. Right-click this file
    echo 2. Select "Run as administrator"
    echo.
    pause
    exit /b 1
)

echo ✅ Running as Administrator
echo.

REM Add PostgreSQL to PATH
set PATH=%PATH%;C:\Program Files\PostgreSQL\18\bin

echo ========================================
echo Step 1: Register PostgreSQL Service
echo ========================================
echo.

pg_ctl register -N "postgresql-18" -D "C:\Program Files\PostgreSQL\18\data" 2>nul

if %ERRORLEVEL% EQU 0 (
    echo ✅ Service registered successfully!
) else (
    echo ⚠️  Service already registered or registration failed
    echo Continuing anyway...
)

echo.
echo ========================================
echo Step 2: Start PostgreSQL Service
echo ========================================
echo.

net start postgresql-18 2>nul

if %ERRORLEVEL% EQU 0 (
    echo ✅ PostgreSQL service started!
) else (
    echo ⚠️  Service may already be running or failed to start
    echo Checking if PostgreSQL is responding...
    
    psql -U postgres -c "SELECT 1;" >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        echo ✅ PostgreSQL is running!
    ) else (
        echo ❌ PostgreSQL is not responding
        echo.
        echo Please check:
        echo - Is port 5432 available?
        echo - Does the data directory exist?
        echo.
        echo Run: netstat -ano | findstr :5432
        echo.
        pause
        exit /b 1
    )
)

echo.
echo ========================================
echo Step 3: Create Database
echo ========================================
echo.
echo You will be prompted for PostgreSQL password.
echo Default password is usually: postgres
echo.

psql -U postgres -c "CREATE DATABASE finance_app;" 2>nul

if %ERRORLEVEL% EQU 0 (
    echo ✅ Database 'finance_app' created successfully!
) else (
    echo ⚠️  Database may already exist or creation failed
    
    REM Check if database exists
    psql -U postgres -l | findstr finance_app >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        echo ✅ Database 'finance_app' already exists!
    ) else (
        echo ❌ Failed to create database
        echo.
        echo Please run manually:
        echo psql -U postgres -c "CREATE DATABASE finance_app;"
        echo.
        pause
        exit /b 1
    )
)

echo.
echo ========================================
echo Step 4: Verify Setup
echo ========================================
echo.

psql -U postgres -d finance_app -c "SELECT 'Database connection successful!' as status;" 2>nul

if %ERRORLEVEL% EQU 0 (
    echo ✅ Database connection verified!
) else (
    echo ❌ Could not connect to database
    pause
    exit /b 1
)

echo.
echo ========================================
echo ✅ Setup Complete!
echo ========================================
echo.
echo Your PostgreSQL database is ready!
echo.
echo Next steps:
echo.
echo 1. Update your .env file with the correct password:
echo    DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/finance_app
echo.
echo 2. Run the database migration:
echo    npm run db:push
echo.
echo 3. Start the development server:
echo    npm run dev
echo.
echo ========================================
echo.

pause
