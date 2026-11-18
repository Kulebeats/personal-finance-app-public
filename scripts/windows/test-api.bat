@echo off
echo ========================================
echo Testing Finance App API
echo ========================================
echo.

echo Server should be running on http://localhost:5000
echo.

echo Test 1: Register a new user
echo ----------------------------
curl -X POST http://localhost:5000/api/auth/register ^
  -H "Content-Type: application/json" ^
  -d "{\"username\":\"testuser\",\"email\":\"test@example.com\",\"password\":\"Test123!@#\",\"fullName\":\"Test User\"}"

echo.
echo.
echo Test 2: Login with the user
echo ----------------------------
curl -X POST http://localhost:5000/api/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"test@example.com\",\"password\":\"Test123!@#\"}" ^
  -c cookies.txt

echo.
echo.
echo Test 3: Get current user (should work with session)
echo ---------------------------------------------------
curl http://localhost:5000/api/auth/me -b cookies.txt

echo.
echo.
echo ========================================
echo Tests complete!
echo ========================================
pause
