@echo off
REM ---------------------------------------------------------------------------
REM Run the backend test suite.
REM
REM Uses a SEPARATE database (test_advocate_db) which Django creates and drops
REM around the run, so your real data is never touched. --noinput answers the
REM "delete stale test database?" prompt, which otherwise stops an unattended
REM run.
REM
REM Most models are unmanaged (Spring-owned tables), so the tables are built
REM from the model definitions - see core/test_runner.py for what that covers
REM and what it cannot.
REM ---------------------------------------------------------------------------

setlocal

set BASE=%~dp0..
set PY=%BASE%\venv\Scripts\python.exe

if not exist "%PY%" (
  echo ERROR: python not found at %PY%
  exit /b 1
)

cd /d "%BASE%"
"%PY%" manage.py test --noinput %*
endlocal & exit /b %ERRORLEVEL%
