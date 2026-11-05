@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 22.12 or newer, then run this file again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js with npm enabled, then run this file again.
  pause
  exit /b 1
)

where py >nul 2>nul
if errorlevel 1 (
  echo The Python launcher is required. Install Python 3.12 and enable the Python launcher.
  pause
  exit /b 1
)

py -3.12 --version >nul 2>nul
if errorlevel 1 (
  echo Python 3.12 was not found. Install Python 3.12, then run this file again.
  pause
  exit /b 1
)

if not exist "backend\venv\Scripts\python.exe" (
  echo Creating backend Python environment...
  py -3.12 -m venv backend\venv
  if errorlevel 1 goto setup_failed
)

echo Installing backend requirements...
backend\venv\Scripts\python.exe -m pip install -r backend\requirements.txt
if errorlevel 1 goto setup_failed

echo Installing frontend requirements...
call npm --prefix frontend ci
if errorlevel 1 goto setup_failed

echo Starting NEXUS backend and frontend...
start "NEXUS Audio Analysis API" cmd /k "cd /d ""%~dp0backend"" && venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000"
start "NEXUS DJ Workstation" cmd /k "cd /d ""%~dp0frontend"" && npm run dev -- --host 127.0.0.1"
timeout /t 3 /nobreak >nul
start "" "http://localhost:5173"
exit /b 0

:setup_failed
echo Setup did not complete. Check the error above, verify your internet connection, and run this file again.
pause
exit /b 1
