@echo off
rem Takes a database backup right now into BACKUP_DIR (see the settings file). Run as administrator.
cd /d "%ProgramData%\CRTLKiosk"
"%~dp0..\node\node.exe" "%~dp0..\app\server\dist\scripts\backup.js"
pause
