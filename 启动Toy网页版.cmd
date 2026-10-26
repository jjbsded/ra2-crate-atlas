@echo off
setlocal
cd /d "%~dp0"
call "%~dp0run-python.cmd" -B serve-toy.py --open %*
set "TOY_LAUNCH_EXIT=%errorlevel%"
if not "%TOY_LAUNCH_EXIT%"=="0" pause
exit /b %TOY_LAUNCH_EXIT%
