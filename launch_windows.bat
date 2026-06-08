@echo off
title Smart Notes Generator v2
echo.
echo  ================================================
echo    Smart Notes Generator v2 — Starting up...
echo  ================================================
echo.

set ROOT=%~dp0

:: Backend
echo  [1/2] Installing backend dependencies...
cd /d "%ROOT%backend"
pip install -r requirements.txt --quiet --upgrade

echo  Starting FastAPI backend on http://127.0.0.1:8000
start "SmartNotes-Backend" /min cmd /c "python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload"

:: Frontend
echo  [2/2] Installing frontend dependencies...
cd /d "%ROOT%frontend"
call npm install --silent

echo  Starting React dev server...
echo  Opening http://localhost:5173
timeout /t 3 >nul
start http://localhost:5173

call npm run dev
pause
