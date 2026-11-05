@echo off
REM SoilSight in Docker (needs Docker Desktop running). No Python needed.
cd /d "%~dp0.."
start "" cmd /c "timeout /t 15 /nobreak >nul & start http://localhost:7860"
docker compose up
pause
