@echo off
rem Creates an administrator account from the console (e.g. if the admin password is lost).
rem Must be run as administrator, because it reads the settings file with the database password.
cd /d "%ProgramData%\CRTLKiosk"
"%~dp0..\node\node.exe" "%~dp0..\app\server\dist\scripts\createAdmin.js"
pause
