@echo off
REM Launch the Django backend on port 8080 (drop-in replacement for Spring Boot).
cd /d "%~dp0"
call venv\Scripts\activate.bat
python manage.py runserver 8080
