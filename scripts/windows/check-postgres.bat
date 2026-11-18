@echo off
REM Check PostgreSQL status

echo ========================================
echo PostgreSQL Status Check
echo ========================================
echo.

REM Add PostgreSQL to PATH
set PATH=%PATH%;C:\Program Files\PostgreSQL\18\bin

echo Checking if PostgreSQL service is running...
echo.

sc query postgresql-18 2>nul

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ??? PostgreSQL service is registered
) else (
    echo ??????  PostgreSQL service is not registered
    echo Run scripts\\windows\\start-postgres.bat as Administrator to register it
)

echo.
echo Checking if PostgreSQL is responding...
echo.

psql -U postgres -c "SELECT version();" 2>nul

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ??? PostgreSQL is running and responding!
    echo.
    echo Checking for finance_app database...
    psql -U postgres -l | findstr finance_app
    
    if %ERRORLEVEL% EQU 0 (
        echo ??? finance_app database exists!
        echo.
        echo You're all set! Run: npm run db:push
    ) else (
        echo ??????  finance_app database does not exist
        echo Run: scripts\\windows\\create-database.bat
    )
) else (
    echo ??? PostgreSQL is not responding
    echo.
    echo Run scripts\\windows\\start-postgres.bat as Administrator to start the service
)

echo.
pause

