@echo off
setlocal
cd /d "%~dp0"
call "%~dp0run-python.cmd" -B server.py --open --page maps %*
set "CRATE_LAUNCH_EXIT=%errorlevel%"
if not "%CRATE_LAUNCH_EXIT%"=="0" pause
exit /b %CRATE_LAUNCH_EXIT%
