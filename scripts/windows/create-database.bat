@echo off
REM Create finance_app database
REM Run this AFTER starting PostgreSQL service

echo ========================================
echo Create Finance App Database
echo ========================================
echo.

REM Add PostgreSQL to PATH
set PATH=%PATH%;C:\Program Files\PostgreSQL\18\bin

echo Creating database 'finance_app'...
echo.
echo You will be prompted for the PostgreSQL password.
echo Default password is usually: postgres
echo.

REM Create the database
psql -U postgres -c "CREATE DATABASE finance_app;"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo ??? Database created successfully!
    echo ========================================
    echo.
    echo Next steps:
    echo 1. Make sure your .env file has the correct password
    echo 2. Run: npm run db:push
    echo.
    echo Your connection string should be:
    echo DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/finance_app
    echo.
) else (
    echo.
    echo ========================================
    echo ??? Failed to create database
    echo ========================================
    echo.
    echo Possible issues:
    echo - PostgreSQL service is not running (run scripts\\windows\\start-postgres.bat first)
    echo - Wrong password
    echo - Database already exists
    echo.
    echo To check if database exists:
    echo psql -U postgres -l
    echo.
)

pause

