@echo off
rem Hermes Config Deck - Windows Launcher
cd /d "%~dp0"
if exist "windows\Hermes Settings Windows.bat" (
    call "windows\Hermes Settings Windows.bat" %*
) else (
    if exist "windows\stop_previous.ps1" (
        powershell -NoProfile -ExecutionPolicy Bypass -File "windows\stop_previous.ps1"
    )
    python server.py %*
)
