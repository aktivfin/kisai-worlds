@echo off
setlocal
cd /d "%~dp0"
title KisAI Worlds LAN Host
where node >nul 2>nul
if errorlevel 1 ( echo Node.js 20+ not found. Install Node.js LTS from https://nodejs.org & pause & exit /b 1 )
if not exist "data\config.json" copy /Y "data\config.example.json" "data\config.json" >nul
for /f %%p in ('node -e "try{console.log(require('./data/config.json').port||8787)}catch(e){console.log(8787)}"') do set KISAI_PORT=%%p
echo Local: http://localhost:%KISAI_PORT%
ipconfig | findstr /R /C:"IPv4"
echo Share your IPv4 with port %KISAI_PORT%. Allow Node.js on Private networks if Firewall asks.
node server.mjs
pause
