@echo off
title Advocate Management System Launcher

REM ---------------------------------------------------------------------------
REM Opens one window per service. Close a window to stop that service.
REM
REM The scraper lives in a SEPARATE repository (all scraping is kept out of the
REM AMS backend), so its path is configurable below. Nothing auto-starts it and
REM nothing restarts it: while it is down, every court feature - display boards,
REM Daily Status, case import, cause lists - fails with a 503. It is started
REM here so that is one less thing to forget.
REM ---------------------------------------------------------------------------

set "ROOT=%~dp0"
set "BE=%ROOT%Advocate-app-BE-Django"
set "FE=%ROOT%Advocate-app-FE-main"
if not defined SCRAPER_DIR set "SCRAPER_DIR=C:\Users\ANILA\scrap"

echo ========================================
echo Starting Advocate Management System
echo ========================================

if not exist "%BE%\manage.py" (
    echo Backend not found: %BE%
    pause
    exit /b 1
)
if not exist "%BE%\venv\Scripts\python.exe" (
    echo Backend venv missing. Run:
    echo   cd "%BE%" ^&^& python -m venv venv ^&^& venv\Scripts\pip install -r requirements.txt
    pause
    exit /b 1
)
if not exist "%BE%\.env" (
    echo WARNING: %BE%\.env is missing - copy .env.example and set the database
    echo and MAIL_* values, or the backend will start without email configured.
    echo.
)
if not exist "%FE%\package.json" (
    echo Frontend not found: %FE%
    pause
    exit /b 1
)

REM --- Court scraper (port 8000) -------------------------------------------
if exist "%SCRAPER_DIR%\api\main.py" (
    start "Court Scraper" cmd /k "cd /d "%SCRAPER_DIR%" && venv\Scripts\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8000"
) else (
    echo WARNING: scraper not found at %SCRAPER_DIR%
    echo Court features ^(display boards, cause lists, case import^) will return 503.
    echo Set SCRAPER_DIR to override.
    echo.
)

REM --- Backend (port 8080) --------------------------------------------------
start "Backend" cmd /k "cd /d "%BE%" && venv\Scripts\python.exe manage.py runserver 0.0.0.0:8080"

REM Give the backend a moment so the frontend's first calls do not fail.
timeout /t 5 /nobreak >nul

REM --- Frontend (port 5173) -------------------------------------------------
start "Frontend" cmd /k "cd /d "%FE%" && npm run dev"

echo.
echo Frontend : http://localhost:5173
echo Backend  : http://localhost:8080
echo Scraper  : http://127.0.0.1:8000/docs
echo.
pause
