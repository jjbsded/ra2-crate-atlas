@echo off
setlocal
cd /d "%~dp0"
set "CRATE_PY=%~dp0runtime\python\python.exe"
if exist "%CRATE_PY%" (
  "%CRATE_PY%" -B server.py --open --page maps %*
) else (
  python -B server.py --open --page maps %*
)
pause
