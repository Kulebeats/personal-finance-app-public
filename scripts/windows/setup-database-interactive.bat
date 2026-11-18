@echo off
echo ========================================
echo Finance App - Database Setup
echo ========================================
echo.

set PGPATH="C:\Program Files\PostgreSQL\18\bin"

echo PostgreSQL 18 is installed and running.
echo.
echo Please enter your PostgreSQL password for user 'postgres':
set /p PGPASSWORD="Password: "

echo.
echo Testing connection...
set PGPASSWORD=%PGPASSWORD%
%PGPATH%\psql.exe -U postgres -h localhost -p 5432 -c "SELECT version();" postgres
if errorlevel 1 (
    echo.
    echo ERROR: Cannot connect to PostgreSQL
    echo Please check your password and try again.
    pause
    exit /b 1
)

echo.
echo Connection successful!
echo.
echo Creating database 'finance_app'...
%PGPATH%\psql.exe -U postgres -h localhost -p 5432 -c "CREATE DATABASE finance_app;" postgres 2>nul
if errorlevel 1 (
    echo Database might already exist - checking...
    %PGPATH%\psql.exe -U postgres -h localhost -p 5432 -c "\l" postgres | findstr finance_app >nul
    if errorlevel 1 (
        echo ERROR: Failed to create database
        pause
        exit /b 1
    ) else (
        echo Database 'finance_app' already exists - OK
    )
) else (
    echo Database created successfully!
)

echo.
echo Updating .env file...
(
echo # Database Configuration
echo DATABASE_URL=postgresql://postgres:%PGPASSWORD%@localhost:5432/finance_app
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

echo .env file updated!

echo.
echo Running database migrations...
call npm run db:push
if errorlevel 1 (
    echo.
    echo ERROR: Migration failed
    pause
    exit /b 1
)

echo.
echo ========================================
echo SUCCESS! Database setup complete!
echo ========================================
echo.
echo Your database is ready at:
echo   postgresql://postgres:****@localhost:5432/finance_app
echo.
echo Next step: Run 'npm run dev' to start the app
echo.
pause
