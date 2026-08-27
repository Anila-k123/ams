@echo off
REM ---------------------------------------------------------------------------
REM Drain the notification queue. Registered to run every 5 minutes.
REM
REM Unlike the appeal sweep this needs NO scraper: it only touches the database
REM and SMTP, so there is no port check here.
REM
REM Logging is deliberately quiet. At 288 runs a day an unconditional log line
REM would bury the interesting entries, so output is kept only when something
REM was actually sent or something failed.
REM ---------------------------------------------------------------------------

setlocal

set BASE=%~dp0..
set PY=%BASE%\venv\Scripts\python.exe
set LOGDIR=%BASE%\logs
set LOG=%LOGDIR%\notifications.log
set OUT=%TEMP%\ams_process_notifications.out

if not exist "%LOGDIR%" mkdir "%LOGDIR%"
if not exist "%PY%" (
  echo %DATE% %TIME% ERROR: python not found at %PY% >> "%LOG%"
  exit /b 1
)

cd /d "%BASE%"
"%PY%" manage.py process_notifications --limit 100 > "%OUT%" 2>&1
set RC=%ERRORLEVEL%

REM Idle runs report "0 sent, 0 failed" - skip those.
findstr /C:"0 sent, 0 failed" "%OUT%" >nul
set QUIET=%ERRORLEVEL%

if not "%RC%"=="0" goto :keep
if "%QUIET%"=="1" goto :keep
goto :done

:keep
echo. >> "%LOG%"
echo ===== %DATE% %TIME% : exit %RC% ===== >> "%LOG%"
type "%OUT%" >> "%LOG%"

:done
del /q "%OUT%" 2>nul
endlocal & exit /b %RC%
