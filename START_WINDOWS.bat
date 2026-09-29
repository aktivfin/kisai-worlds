@echo off
cd /d "%~dp0"
title KisAI Worlds
if not exist "data\config.json" (
  copy /Y "data\config.example.json" "data\config.json" >nul
)
start "" http://localhost:8787
node server.mjs
pause
