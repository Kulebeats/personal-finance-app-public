@echo off
REM Start PostgreSQL Service Script
REM Run this as Administrator

echo ========================================
echo PostgreSQL Service Setup
echo ========================================
echo.

REM Check if running as administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: This script must be run as Administrator!
    echo.
    echo Right-click this file and select "Run as administrator"
    echo.
    pause
    exit /b 1
)

echo Step 1: Registering PostgreSQL service...
echo.

cd "C:\Program Files\PostgreSQL\18\bin"

REM Try to register the service
pg_ctl register -N "postgresql-18" -D "C:\Program Files\PostgreSQL\18\data"

if %ERRORLEVEL% EQU 0 (
    echo ??? Service registered successfully!
) else (
    echo ??????  Service may already be registered or data directory not found.
)

echo.
echo Step 2: Starting PostgreSQL service...
echo.

net start postgresql-18

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ??? PostgreSQL service started successfully!
    echo.
    echo Next: Run scripts\\windows\\create-database.bat to create the finance_app database
) else (
    echo.
    echo ??? Failed to start service. Trying alternative method...
    echo.
    
    REM Try starting with pg_ctl directly
    pg_ctl -D "C:\Program Files\PostgreSQL\18\data" start
    
    if %ERRORLEVEL% EQU 0 (
        echo ??? PostgreSQL started successfully!
    ) else (
        echo ??? Could not start PostgreSQL.
        echo.
        echo Possible issues:
        echo - Data directory doesn't exist
        echo - Port 5432 is already in use
        echo - Insufficient permissions
        echo.
        echo Check docs\setup\local-database-setup.md for troubleshooting
    )
)

echo.
pause

