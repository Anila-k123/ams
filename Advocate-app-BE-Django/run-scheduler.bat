@echo off
REM Background scheduler: delivers notifications and raises due reminders on a timer.
REM Run this in its own window alongside run-django.bat. In production, wrap it with
REM NSSM (Windows service) or systemd so it restarts on reboot/crash.
cd /d "%~dp0"
call venv\Scripts\activate.bat
python manage.py run_scheduler
