@echo off
REM Launch the Django backend on port 8080 (drop-in replacement for Spring Boot).
cd /d "%~dp0"
call venv\Scripts\activate.bat
REM 0.0.0.0 => listen on all interfaces so other devices on the LAN can reach it.
python manage.py runserver 0.0.0.0:8080
