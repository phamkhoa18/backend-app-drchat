@echo off
echo ====================================
echo   Restart Chat Server
echo   (Backend cho FREE CALL)
echo ====================================
echo.
echo Dang khoi dong server...
echo.

REM Kill existing node process on port 3000 (if any)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    echo Dang dong process cu: %%a
    taskkill /F /PID %%a >nul 2>&1
)

timeout /t 2 /nobreak >nul

echo Khoi dong server moi...
echo.
echo Server se chay tren: http://localhost:3000
echo.
echo Nhan Ctrl+C de dung server
echo.

npm start

pause
