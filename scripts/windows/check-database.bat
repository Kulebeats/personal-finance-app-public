@echo off
echo Checking PostgreSQL status...
echo.

set PGPATH="C:\Program Files\PostgreSQL\18\bin"

echo PostgreSQL Service Status:
sc query postgresql-x64-18 | findstr STATE
echo.

echo Testing connection to finance_app database...
%PGPATH%\psql.exe -U postgres -h localhost -p 5432 -d finance_app -c "SELECT 'Database is accessible!' as status;"
if errorlevel 1 (
    echo.
    echo ERROR: Cannot connect to database
    echo Run scripts\\windows\\setup-database.bat to create the database
) else (
    echo.
    echo SUCCESS: Database is ready!
)

echo.
pause

