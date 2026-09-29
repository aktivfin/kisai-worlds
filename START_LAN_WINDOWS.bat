@echo off
cd /d "%~dp0"
title KisAI Worlds LAN Host
ipconfig | findstr /R /C:"IPv4"
echo.
echo Give friends this address: http://YOUR_IPV4:8787
node server.mjs
pause
