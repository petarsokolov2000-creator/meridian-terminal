@echo off
rem Double-click to start Meridian Terminal with real market data and open it in your browser.
title Meridian Terminal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get the LTS version from https://nodejs.org and try again. & pause & exit /b 1)
node serve.mjs --open
pause
