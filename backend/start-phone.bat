@echo off
REM Like start.bat, but phones on the same Wi-Fi can open SoilSight too.
REM Windows may ask to allow Python through the firewall: choose Private networks.
set HOST=0.0.0.0
call "%~dp0start.bat"
