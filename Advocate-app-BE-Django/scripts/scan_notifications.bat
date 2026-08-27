@echo off
REM ---------------------------------------------------------------------------
REM Queue the reminders that are due. Registered to run daily at 07:00.
REM
REM Morning is deliberate: a hearing reminder is useful before the working day,
REM not after it. It only ENQUEUES - process_notifications does the sending.
REM
REM Needs no scraper: hearings, invoices and tasks all come from our own
REM database.
REM ---------------------------------------------------------------------------

setlocal

set BASE=%~dp0..
set PY=%BASE%\venv\Scripts\python.exe
set LOGDIR=%BASE%\logs
set LOG=%LOGDIR%\notifications.log

if not exist "%LOGDIR%" mkdir "%LOGDIR%"
if not exist "%PY%" (
  echo %DATE% %TIME% ERROR: python not found at %PY% >> "%LOG%"
  exit /b 1
)

echo. >> "%LOG%"
echo ===== %DATE% %TIME% : reminder scan starting ===== >> "%LOG%"

cd /d "%BASE%"
"%PY%" manage.py scan_notifications >> "%LOG%" 2>&1
set RC=%ERRORLEVEL%

echo ===== %DATE% %TIME% : scan finished with exit code %RC% ===== >> "%LOG%"
endlocal & exit /b %RC%
