@echo off
REM ---------------------------------------------------------------
REM  HNKL editor launcher
REM
REM  NOTE: keep this file ASCII-only.
REM  cmd.exe reads .cmd files using the system codepage, not UTF-8,
REM  so Korean text here would be garbled. Korean messages are
REM  printed by server.js instead (chcp 65001 below makes them show).
REM ---------------------------------------------------------------
chcp 65001 >nul 2>&1
title HNKL Editor - closing this window stops the editor
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js not found. Install it from https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\parse5" (
  echo.
  echo   First run - installing dependencies...
  echo.
  call npm install
)

node server.js

echo.
echo   Editor stopped.
ping -n 4 127.0.0.1 >nul 2>&1
