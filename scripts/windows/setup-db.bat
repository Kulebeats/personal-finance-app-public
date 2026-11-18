@echo off
REM Setup script for local PostgreSQL database

echo Setting up PostgreSQL for Finance App...
echo.

REM Add PostgreSQL to PATH
set PATH=%PATH%;C:\Program Files\PostgreSQL\18\bin

REM Create database
echo Creating database 'finance_app'...
psql -U postgres -c "CREATE DATABASE finance_app;"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ✅ Database created successfully!
    echo.
    echo Next steps:
    echo 1. Update your .env file with the connection string
    echo 2. Run: npm run db:push
    echo.
) else (
    echo.
    echo ❌ Failed to create database. Make sure PostgreSQL is running.
    echo.
)

pause
