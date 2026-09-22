@echo off
REM ---------------------------------------------------------------------------
REM Catch-up / retry pass for document AI summaries. Register to run every few
REM minutes. Uploads summarize immediately in a background thread; this reruns
REM anything left PENDING or stuck in PROCESSING (e.g. after a process restart).
REM
REM Needs only the database and the configured LLM backend (LLM_PROVIDER) - no
REM scraper, so there is no port check here.
REM ---------------------------------------------------------------------------

setlocal

set BASE=%~dp0..
set PY=%BASE%\venv\Scripts\python.exe
set LOGDIR=%BASE%\logs
set LOG=%LOGDIR%\summaries.log
set OUT=%TEMP%\ams_summarize_documents.out

if not exist "%LOGDIR%" mkdir "%LOGDIR%"
if not exist "%PY%" (
  echo %DATE% %TIME% ERROR: python not found at %PY% >> "%LOG%"
  exit /b 1
)

cd /d "%BASE%"
"%PY%" manage.py summarize_documents --limit 25 > "%OUT%" 2>&1
set RC=%ERRORLEVEL%

REM Idle runs report "Nothing to process." - skip logging those.
findstr /C:"Nothing to process." "%OUT%" >nul
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
