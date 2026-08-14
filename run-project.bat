@echo off
title Advocate Management System Launcher

set "ROOT=%~dp0"
set "BE=%ROOT%Advocate-app-BE-main"
set "FE=%ROOT%Advocate-app-FE-main"

echo ========================================
echo Starting Advocate Management System
echo ========================================

REM Check backend
if not exist "%BE%\pom.xml" (
    echo Backend project not found:
    echo %BE%
    pause
    exit /b
)

REM Check frontend
if not exist "%FE%\package.json" (
    echo Frontend project not found:
    echo %FE%
    pause
    exit /b
)

REM Start Backend
start "Backend" cmd /k "cd /d "%BE%" && mvnw.cmd spring-boot:run "-Dspring-boot.run.profiles=dev""

REM Wait 5 seconds
timeout /t 5 /nobreak >nul

REM Start Frontend
start "Frontend" cmd /k "cd /d "%FE%" && npm run dev"

echo.
echo Backend : http://localhost:8080
echo Frontend: http://localhost:5173
pause