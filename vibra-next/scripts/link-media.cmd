@echo off
REM ---------------------------------------------------------------
REM  Link the original site's media/assets into this Next project.
REM
REM  Nothing is copied. Junctions (/J) and hard links (/H) both work
REM  WITHOUT administrator rights, so this just works on a normal PC.
REM
REM  Run this once after cloning. Re-run any time the links break.
REM ---------------------------------------------------------------
setlocal
cd /d "%~dp0.."
set "SITE=%CD%\..\public"

if not exist "%SITE%\common.css" (
  echo   Could not find the original site at "%SITE%".
  echo   Expected layout:  HNKL\public\  and  HNKL\vibra-next\
  exit /b 1
)

if not exist "public" mkdir "public"
if not exist "lib"    mkdir "lib"

REM --- media  (200MB, never copied) ---
if exist "public\media" rmdir "public\media" 2>nul
mklink /J "public\media" "%SITE%\works\projects\vibra\media" >nul
if errorlevel 1 (echo   FAILED: public\media & exit /b 1)

REM --- assets (logo.svg etc.) ---
if exist "public\assets" rmdir "public\assets" 2>nul
mklink /J "public\assets" "%SITE%\assets" >nul
if errorlevel 1 (echo   FAILED: public\assets & exit /b 1)

REM --- shared css/js: hard links so edits stay in sync both ways ---
if exist "public\common.css" del "public\common.css"
mklink /H "public\common.css" "%SITE%\common.css" >nul
if errorlevel 1 (echo   FAILED: public\common.css & exit /b 1)

if exist "lib\common.js" del "lib\common.js"
mklink /H "lib\common.js" "%SITE%\common.js" >nul
if errorlevel 1 (echo   FAILED: lib\common.js & exit /b 1)

echo   Linked:
echo     public\media       -^> works\projects\vibra\media
echo     public\assets      -^> assets
echo     public\common.css  -^> common.css
echo     lib\common.js      -^> common.js
endlocal
