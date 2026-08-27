@echo off
REM ---------------------------------------------------------------------------
REM Trim the audit trail to its retention window. Registered to run monthly.
REM
REM Monthly, not daily: the window is measured in months, so a daily run would
REM delete a handful of rows 29 times for nothing.
REM
REM Needs no scraper - database only.
REM ---------------------------------------------------------------------------

setlocal

set BASE=%~dp0..
set PY=%BASE%\venv\Scripts\python.exe
set LOGDIR=%BASE%\logs
set LOG=%LOGDIR%\audit_prune.log

REM Retention window. Raise this if you need a longer trail; the command
REM refuses anything under 3 months.
set MONTHS=12

if not exist "%LOGDIR%" mkdir "%LOGDIR%"
if not exist "%PY%" (
  echo %DATE% %TIME% ERROR: python not found at %PY% >> "%LOG%"
  exit /b 1
)

echo. >> "%LOG%"
echo ===== %DATE% %TIME% : audit prune starting (%MONTHS% months) ===== >> "%LOG%"

cd /d "%BASE%"
"%PY%" manage.py prune_audit_log --months %MONTHS% --apply >> "%LOG%" 2>&1
set RC=%ERRORLEVEL%

echo ===== %DATE% %TIME% : prune finished with exit code %RC% ===== >> "%LOG%"
endlocal & exit /b %RC%
