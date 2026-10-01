@echo off
REM ============================================================
REM  $CIRCO - avvia il motore dal PC di casa (Windows)
REM  Doppio click per partire. Lascia aperte le due finestre.
REM ============================================================
title CIRCO - motore
cd /d "%~dp0..\..\engine"

where node >nul 2>nul || (echo Node.js non trovato: installa la versione 22 da https://nodejs.org & pause & exit /b 1)
if not exist ".env" (echo Manca il file engine\.env con le impostazioni: vedi LEGGIMI.md & pause & exit /b 1)
if not exist "node_modules" (echo Prima installazione delle librerie... & call npm install --omit=dev)

REM il PC non deve andare in sospensione mentre il circo gira (solo con l'alimentatore collegato)
powercfg /change standby-timeout-ac 0 >nul 2>nul
powercfg /change hibernate-timeout-ac 0 >nul 2>nul

REM il tunnel Cloudflare in una seconda finestra: da al motore un indirizzo pubblico https
where cloudflared >nul 2>nul && start "CIRCO - tunnel" cmd /k "cloudflared tunnel run circo-engine"
where cloudflared >nul 2>nul || echo ATTENZIONE: cloudflared non installato, il motore gira ma il sito non lo raggiunge. Vedi LEGGIMI.md

REM il motore: se si chiude o si blocca, ripartire da solo dopo 5 secondi
:loop
echo.
echo [%date% %time%] Avvio del motore...
node --experimental-strip-types --env-file=.env src\index.ts >> "%~dp0motore.log" 2>&1
echo [%date% %time%] Il motore si e' fermato: riparto tra 5 secondi. (Chiudi questa finestra per fermarlo davvero.)
timeout /t 5 /nobreak >nul
goto loop
