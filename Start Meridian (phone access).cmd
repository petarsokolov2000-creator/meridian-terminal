@echo off
rem Like Start Meridian.cmd, but your phone on the same Wi-Fi can open it too.
rem The window shows the address and a 6-digit access key to type on the phone.
title Meridian Terminal (phone access)
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get the LTS version from https://nodejs.org and try again. & pause & exit /b 1)
node serve.mjs --lan --open
pause
