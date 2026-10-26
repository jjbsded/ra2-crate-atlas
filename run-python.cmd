@echo off
setlocal EnableExtensions DisableDelayedExpansion
call :selectPython "%~dp0runtime\python\python.exe"
if not errorlevel 1 goto run
if defined CRATE_ATLAS_PYTHON (
  call :selectPython "%CRATE_ATLAS_PYTHON%"
  if not errorlevel 1 goto run
)
call :selectPython "%~dp0.venv\Scripts\python.exe"
if not errorlevel 1 goto run
call :selectPython "%~dp0..\..\portable\CrateAtlas-Windows-x64\runtime\python\python.exe"
if not errorlevel 1 goto run
for /f "delims=" %%P in ('where.exe python.exe 2^>nul') do (
  call :selectPython "%%P"
  if not errorlevel 1 goto run
)
for /f "delims=" %%P in ('where.exe python3.exe 2^>nul') do (
  call :selectPython "%%P"
  if not errorlevel 1 goto run
)
echo Python 3.11+ was not found. The Windows Store shortcut is not a Python runtime.
echo Fully extract the Windows portable ZIP, or install Python and add it to PATH.
echo You can also set CRATE_ATLAS_PYTHON to the full path of python.exe.
exit /b 1

:run
"%CRATE_RUN_PYTHON%" %*
exit /b %errorlevel%

:selectPython
set "CRATE_PY_CANDIDATE=%~1"
if not exist "%CRATE_PY_CANDIDATE%" exit /b 1
if not "%CRATE_PY_CANDIDATE:\Microsoft\WindowsApps\=%"=="%CRATE_PY_CANDIDATE%" exit /b 1
"%CRATE_PY_CANDIDATE%" -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1
if errorlevel 1 exit /b 1
set "CRATE_RUN_PYTHON=%CRATE_PY_CANDIDATE%"
exit /b 0
