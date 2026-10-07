@echo off
title AMS Dev Launcher

REM ---------------------------------------------------------------------------
REM Dev instance that runs BESIDE the test instance (8080 / 5173, PactPro_db).
REM Ports 8081 / 5174, database from Advocate-app-BE-Django\.env (pactpro_db1).
REM Deliberately does NOT start the scraper (the shared one on 8000 is used) or
REM the notifications scheduler: on a copy of the test data it would send
REM duplicate reminders.
REM ---------------------------------------------------------------------------

set "ROOT=%~dp0"
set "BE=%ROOT%Advocate-app-BE-Django"
set "FE=%ROOT%Advocate-app-FE-main"

start "Dev Backend" cmd /k "cd /d "%BE%" && venv\Scripts\python.exe manage.py runserver 0.0.0.0:8081"
timeout /t 5 /nobreak >nul
start "Dev Frontend" cmd /k "cd /d "%FE%" && npm run dev -- --port 5174 --strictPort"

echo.
echo Frontend : http://192.168.1.36:5174
echo Backend  : http://192.168.1.36:8081
echo.
pause
