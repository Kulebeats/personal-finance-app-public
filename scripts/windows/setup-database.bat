@echo off
echo ========================================
echo Finance App - Database Setup
echo ========================================
echo.

set PGPATH="C:\Program Files\PostgreSQL\18\bin"
set PGPASSWORD=postgres
set PGUSER=postgres
set PGHOST=localhost
set PGPORT=5432

echo Step 1: Testing PostgreSQL connection...
%PGPATH%\psql.exe -U %PGUSER% -h %PGHOST% -p %PGPORT% -c "SELECT version();" postgres
if errorlevel 1 (
    echo ERROR: Cannot connect to PostgreSQL
    echo Please check:
    echo   1. PostgreSQL service is running
    echo   2. Password is correct (default: postgres)
    echo   3. Port 5432 is not blocked
    pause
    exit /b 1
)

echo.
echo Step 2: Creating database 'finance_app'...
%PGPATH%\psql.exe -U %PGUSER% -h %PGHOST% -p %PGPORT% -c "CREATE DATABASE finance_app;" postgres 2>nul
if errorlevel 1 (
    echo Database might already exist, checking...
    %PGPATH%\psql.exe -U %PGUSER% -h %PGHOST% -p %PGPORT% -c "\l" postgres | findstr finance_app
    if errorlevel 1 (
        echo ERROR: Failed to create database
        pause
        exit /b 1
    ) else (
        echo Database 'finance_app' already exists - OK
    )
) else (
    echo Database 'finance_app' created successfully!
)

echo.
echo Step 3: Updating .env file...
(
echo # Database Configuration
echo DATABASE_URL=postgresql://postgres:postgres@localhost:5432/finance_app
echo.
echo # Session Secret
echo SESSION_SECRET=your-secret-key-change-this-in-production
echo.
echo # Node Environment
echo NODE_ENV=development
echo.
echo # Server Port
echo PORT=5000
) > .env

echo .env file updated with database connection string

echo.
echo Step 4: Running database migrations...
call npm run db:push
if errorlevel 1 (
    echo ERROR: Database migration failed
    pause
    exit /b 1
)

echo.
echo ========================================
echo Database setup complete!
echo ========================================
echo.
echo Connection details:
echo   Host: localhost
echo   Port: 5432
echo   Database: finance_app
echo   User: postgres
echo.
echo You can now run: npm run dev
echo.
pause
