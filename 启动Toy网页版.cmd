@echo off
setlocal
cd /d "%~dp0"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-latest.ps1" -Edition toy %*
set "TOY_LAUNCH_EXIT=%errorlevel%"
if not "%TOY_LAUNCH_EXIT%"=="0" pause
exit /b %TOY_LAUNCH_EXIT%
