@echo off
setlocal
cd /d "%~dp0"
if exist "runtime\node\node.exe" (
 "runtime\node\node.exe" export.cjs
) else (
 node export.cjs
)
pause
