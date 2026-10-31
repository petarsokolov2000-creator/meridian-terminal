@echo off
rem One-time setup: builds Meridian.exe and adds Meridian to your Desktop and Start menu.
title Install Meridian
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Meridian needs Node.js, which isn't installed.
  where winget >nul 2>nul
  if errorlevel 1 (
    echo Download the LTS version from https://nodejs.org, install it, then run this again.
    start "" https://nodejs.org/
    pause
    exit /b 1
  )
  choice /m "Install Node.js LTS now with winget"
  if errorlevel 2 (
    echo Download the LTS version from https://nodejs.org, install it, then run this again.
    pause
    exit /b 1
  )
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  echo.
  echo Node.js is installed. Close this window and double-click "Install Meridian.cmd" again
  echo ^(Windows only sees new programs in newly opened windows^).
  pause
  exit /b 0
)
node tools\install.mjs
echo.
pause
