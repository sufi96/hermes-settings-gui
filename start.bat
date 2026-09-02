@echo off
rem Hermes Config Deck - Windows Launcher
cd /d "%~dp0"
if exist "windows\Hermes Settings Windows.bat" (
    call "windows\Hermes Settings Windows.bat" %*
) else (
    python server.py %*
)
