@echo off
REM Nightly AMS backup (database + uploaded files). See docs\OPERATIONS.md "Backups".
REM Set AMS_BACKUP_DIR to a folder on another disk or a network share.
REM Set AMS_MEDIA_DIR to the drafting media folder (settings.MEDIA_ROOT) to include it.
REM The DB password comes from %APPDATA%\postgresql\pgpass.conf, never from this file.
if "%AMS_BACKUP_DIR%"=="" (
  echo AMS_BACKUP_DIR is not set. & exit /b 2
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup_db.ps1" -BackupDir "%AMS_BACKUP_DIR%" -UploadDirs "%~dp0..\..\Advocate-app-BE-main\uploads" %*
exit /b %ERRORLEVEL%
