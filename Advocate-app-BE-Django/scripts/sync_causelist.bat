@echo off
REM ---------------------------------------------------------------------------
REM Morning cause-list sync, invoked by Windows Task Scheduler.
REM
REM Registered by tools\install-services.ps1 as "PactPro Cause List Sync",
REM daily at 06:30 (after the courts publish) and again at 12:30 (to pick up
REM lists published late or revised in the morning). By hand:
REM   scripts\sync_causelist.bat
REM
REM Without this the Daily Causelist's "Your matters today" and the Your Item
REM column stay empty - and empty looks exactly like broken (NEXT_STEPS 1.1).
REM
REM Fetches today and tomorrow (--days 2; courts publish a day or two ahead) for
REM every court the scraper serves. A day's rows are replaced, not merged, so a
REM re-run is always safe. One court failing does not stop the others.
REM
REM Output goes to logs\sync_causelist.log so a failed morning is diagnosable.
REM ---------------------------------------------------------------------------

setlocal

set BASE=%~dp0..
set PY=%BASE%\venv\Scripts\python.exe
set LOGDIR=%BASE%\logs
set LOG=%LOGDIR%\sync_causelist.log
set COURTS=sci chennai madurai chennai_dc

if not exist "%LOGDIR%" mkdir "%LOGDIR%"

echo. >> "%LOG%"
echo ===== %DATE% %TIME% : cause-list sync starting ===== >> "%LOG%"

if not exist "%PY%" (
  echo ERROR: python not found at %PY% >> "%LOG%"
  exit /b 1
)

REM Everything here is fetched from the scraper on :8000. netstat, not
REM Get-NetTCPConnection: the latter missed a live listener on this machine.
netstat -ano | findstr /R /C:"127.0.0.1:8000 .*LISTENING" >nul
if errorlevel 1 (
  echo ERROR: the scraper is not listening on port 8000 - nothing can be >> "%LOG%"
  echo        fetched. Check the "PactPro Scraper" task and logs\Scraper.log. >> "%LOG%"
  exit /b 2
)

cd /d "%BASE%"
set FAILED=0
for %%C in (%COURTS%) do (
  echo --- %%C --- >> "%LOG%"
  "%PY%" manage.py sync_causelist --court %%C --days 2 >> "%LOG%" 2>&1
  if errorlevel 1 set FAILED=1
)

echo ===== %DATE% %TIME% : finished (any court failed: %FAILED%) ===== >> "%LOG%"
endlocal & exit /b %FAILED%
