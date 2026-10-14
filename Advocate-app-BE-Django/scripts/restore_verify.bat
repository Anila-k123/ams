@echo off
REM Restore a backup into the isolated database pactpro_restore_check and verify it.
REM Usage: restore_verify.bat <backup folder> [-CreateDatabase]
if "%~1"=="" ( echo Usage: restore_verify.bat ^<backup folder^> [-CreateDatabase] & exit /b 2 )
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore_verify.ps1" -BackupPath "%~1" %2 %3
exit /b %ERRORLEVEL%
