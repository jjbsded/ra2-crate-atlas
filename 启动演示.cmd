@echo off
setlocal
cd /d "%~dp0"
set "CRATE_PY=%~dp0runtime\python\python.exe"
if not exist "%CRATE_PY%" set "CRATE_PY=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if exist "%CRATE_PY%" (
  "%CRATE_PY%" server.py --open %*
) else (
  python server.py --open %*
)
pause
