@echo off
REM ---------------------------------------------------------------------------
REM Nightly appeal-detection sweep, invoked by Windows Task Scheduler.
REM
REM Registered with:
REM   schtasks /Create /TN "AMS Appeal Scan" /TR "<this file>" /SC DAILY /ST 02:00
REM
REM Every court search is a live CAPTCHA-gated scrape taking seconds to tens of
REM seconds, so --limit bounds how much one run does. Raise it once you know how
REM long a run actually takes on your caseload.
REM
REM Output is appended to logs\scan_appeals.log so a silent failure is still
REM diagnosable the next morning - a scheduled task that fails invisibly is
REM worse than no task at all.
REM ---------------------------------------------------------------------------

setlocal

set BASE=%~dp0..
set PY=%BASE%\venv\Scripts\python.exe
set LOGDIR=%BASE%\logs
set LOG=%LOGDIR%\scan_appeals.log

if not exist "%LOGDIR%" mkdir "%LOGDIR%"

echo. >> "%LOG%"
echo ===== %DATE% %TIME% : appeal sweep starting ===== >> "%LOG%"

if not exist "%PY%" (
  echo ERROR: python not found at %PY% >> "%LOG%"
  exit /b 1
)

REM The sweep talks to the scraper service on :8000. If that is not running
REM every search fails, so say so plainly rather than logging 25 identical
REM connection errors.
powershell -NoProfile -Command "exit (@(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue).Count -eq 0)" >nul 2>&1
if errorlevel 1 (
  echo ERROR: the scraper service is not listening on port 8000 - no court >> "%LOG%"
  echo        search can succeed. Start it before this task runs. >> "%LOG%"
  exit /b 2
)

cd /d "%BASE%"
"%PY%" manage.py scan_appeals --limit 25 >> "%LOG%" 2>&1
set RC=%ERRORLEVEL%

echo ===== %DATE% %TIME% : finished with exit code %RC% ===== >> "%LOG%"
endlocal & exit /b %RC%
