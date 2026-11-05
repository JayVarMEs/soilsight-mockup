@echo off
REM SoilSight: double-click to start. First time it installs what it needs.
REM To use it from a phone on the same Wi-Fi, double-click start-phone.bat instead.
cd /d "%~dp0"
title SoilSight server - keep this window open
set PY=python
if exist .venv\Scripts\python.exe set PY=.venv\Scripts\python.exe
%PY% -c "import torch, torchvision, fastapi, cv2, sklearn, PIL, multipart" 1>nul 2>nul
if errorlevel 1 (
  echo First run: installing Python packages. This takes a few minutes...
  python -m pip install -r requirements.txt
  if errorlevel 1 goto :err
  set PY=python
)
start "" cmd /c "timeout /t 6 /nobreak >nul & start http://localhost:8000"
%PY% serve.py
echo.
echo The server stopped. If you see an error above, send it to the team.
pause
exit /b
:err
echo.
echo Setup failed. Is Python installed? Get it from https://www.python.org (tick "Add to PATH").
pause
