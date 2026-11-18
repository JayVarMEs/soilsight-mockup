@echo off
REM Builds dist\SoilSight\SoilSight.exe (a folder you can copy to any Windows PC; no Python needed there).
REM Run this ONCE on a PC where start.bat already works. Needs internet. Takes about 10-20 minutes.
cd /d "%~dp0"
set PY=python
if exist .venv\Scripts\python.exe set PY=.venv\Scripts\python.exe
%PY% -m pip install pyinstaller || goto :err
echo Getting the ResNet-34 weights (cached after the first time)...
%PY% -c "import torchvision.models as m; m.resnet34(weights=m.ResNet34_Weights.IMAGENET1K_V1)" || goto :err
if exist bundle rmdir /s /q bundle
mkdir bundle\torch\hub\checkpoints
copy "%USERPROFILE%\.cache\torch\hub\checkpoints\resnet34-*.pth" bundle\torch\hub\checkpoints\ >nul || goto :err
%PY% -m PyInstaller --noconfirm --clean --name SoilSight --console ^
  --paths . ^
  --collect-submodules uvicorn --collect-submodules sklearn --collect-submodules scipy --collect-submodules soilsight ^
  --collect-all torchvision ^
  --hidden-import multipart --hidden-import joblib --hidden-import cv2 ^
  --add-data "artifacts\model.joblib;backend\artifacts" ^
  --add-data "..\index.html;." --add-data "..\favicon.svg;." ^
  --add-data "..\css;css" --add-data "..\js;js" ^
  --add-data "bundle\torch;torch" ^
  serve.py || goto :err
echo.
echo Done. Open dist\SoilSight\SoilSight.exe  (copy the whole dist\SoilSight folder to move it).
pause
exit /b
:err
echo.
echo Build failed. Send the error above to the team.
pause
