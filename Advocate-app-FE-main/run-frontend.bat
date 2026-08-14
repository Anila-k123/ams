@echo off
title Advocate Frontend
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ========================================
echo  Starting Advocate Frontend (DEV)
echo ========================================
echo.

:: Check Node.js installation
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo         Please install Node.js 18 or later from https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: Print Node.js version
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [OK] Node.js version: %NODE_VER%

:: Check npm installation
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm is not installed or not in PATH.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('npm -v') do set NPM_VER=%%i
echo [OK] npm version: %NPM_VER%

:: Check package.json exists
if not exist "%~dp0package.json" (
    echo [ERROR] package.json not found.
    echo         Please ensure you are in the correct project directory.
    echo.
    pause
    exit /b 1
)

:: Install dependencies if node_modules is missing
if not exist "%~dp0node_modules" (
    echo.
    echo Installing dependencies...
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo.
        echo [ERROR] npm install failed. Check the logs above.
        pause
        exit /b 1
    )
    echo Dependencies installed.
) else (
    echo [OK] Dependencies already installed
)

echo.
echo Starting Vite dev server...
echo Frontend URL: http://localhost:5173
echo.

call npm run dev

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Frontend failed to start. Check the logs above.
    pause
    exit /b 1
)

pause
