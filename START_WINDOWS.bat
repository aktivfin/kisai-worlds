@echo off
setlocal
cd /d "%~dp0"
title KisAI Worlds
where node >nul 2>nul
if errorlevel 1 ( echo Node.js 20+ not found. Install Node.js LTS from https://nodejs.org & pause & exit /b 1 )
if not exist "data\config.json" copy /Y "data\config.example.json" "data\config.json" >nul
for /f %%p in ('node -e "try{console.log(require('./data/config.json').port||8787)}catch(e){console.log(8787)}"') do set KISAI_PORT=%%p
start "" "http://localhost:%KISAI_PORT%"
set KISAI_BIND=127.0.0.1
node server.mjs
pause
