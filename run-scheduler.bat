@echo off
title PactPro Notifications Scheduler
REM Runs manage.py run_scheduler in this window: sends queued notifications every
REM minute and raises hearing / overdue-invoice / task-deadline reminders every
REM 15 minutes. Close the window to stop it.
REM
REM For unattended use, tools\install-services.ps1 runs it as a sign-in task that
REM restarts it if it stops - use one or the other, not both.

powershell -NoProfile -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'manage\.py run_scheduler' }) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
    echo The scheduler is already running ^(probably the PactPro Scheduler task^). Not starting a second one.
    pause
    exit /b 0
)
cd /d "%~dp0Advocate-app-BE-Django"
venv\Scripts\python.exe manage.py run_scheduler
