@echo off
REM Controlla in un attimo se il motore e' vivo, e mostra le ultime righe del registro.
title CIRCO - stato
curl -s http://127.0.0.1:8787/health
echo.
echo --- ultime righe del registro ---
powershell -NoProfile -Command "Get-Content '%~dp0motore.log' -Tail 25"
pause
