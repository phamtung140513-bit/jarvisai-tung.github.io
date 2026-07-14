@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PY=%~dp0.venv\Scripts\python.exe
if not exist "%PY%" set PY=python

echo ============================================
echo   Jarvis Web - cung mien (UI + API)
echo ============================================
echo.

REM Start web if not running
powershell -NoProfile -Command "try { Invoke-WebRequest http://127.0.0.1:7860/api/health -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  echo Dang khoi dong server...
  start "Jarvis-Web" /MIN "%PY%" -m webapp.server
  timeout /t 4 /nobreak >nul
) else (
  echo Server da chay.
)

echo.
echo Mo trinh duyet:
echo   http://127.0.0.1:7860/
echo.
start "" "http://127.0.0.1:7860/"
echo Neu chat loi: F12 xem Console. Admin can WEB_ADMIN_KEY trong .env
pause
