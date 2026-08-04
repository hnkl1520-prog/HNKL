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

REM --- the original page itself, served from THIS origin ---
REM  compare.html puts the original in an iframe. Browsers block script
REM  access across different ports, which breaks scroll syncing, so the
REM  original has to be reachable at localhost:3000 too.
REM  Its own relative links then resolve correctly:
REM    media/...          -> /works/projects/vibra/media/...
REM    ../../../common.css -> /common.css
if exist "public\works\projects\vibra" rmdir "public\works\projects\vibra" 2>nul
if not exist "public\works\projects" mkdir "public\works\projects"
mklink /J "public\works\projects\vibra" "%SITE%\works\projects\vibra" >nul
if errorlevel 1 (echo   FAILED: public\works\projects\vibra & exit /b 1)

REM --- shared css/js: hard links so edits stay in sync both ways ---
if exist "public\common.css" del "public\common.css"
mklink /H "public\common.css" "%SITE%\common.css" >nul
if errorlevel 1 (echo   FAILED: public\common.css & exit /b 1)

if exist "public\common.js" del "public\common.js"
mklink /H "public\common.js" "%SITE%\common.js" >nul
if errorlevel 1 (echo   FAILED: public\common.js & exit /b 1)

if exist "lib\common.js" del "lib\common.js"
mklink /H "lib\common.js" "%SITE%\common.js" >nul
if errorlevel 1 (echo   FAILED: lib\common.js & exit /b 1)

echo   Linked:
echo     public\media                 -^> works\projects\vibra\media
echo     public\assets                -^> assets
echo     public\works\projects\vibra  -^> works\projects\vibra   (for compare.html)
echo     public\common.css            -^> common.css
echo     public\common.js             -^> common.js
echo     lib\common.js                -^> common.js
endlocal
