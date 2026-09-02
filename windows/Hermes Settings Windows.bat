@echo off
setlocal enabledelayedexpansion
title Hermes Agent Config Deck

rem Switch to project root folder
cd /d "%~dp0.."

rem Auto-refresh Windows shortcut with icon in windows folder
if exist "%~dp0create_shortcut.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create_shortcut.ps1" >nul 2>nul
)

echo ================================================================
echo           Hermes Agent - Config Deck (Windows)
echo ================================================================
echo.

rem 1. Check Python installation
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in your system PATH.
    echo.
    echo Please install Python 3.10+ from https://www.python.org/
    echo IMPORTANT: Make sure to check "Add Python to PATH" during setup.
    echo.
    pause
    exit /b 1
)

rem 2. Check PyYAML dependency
python -c "import yaml" >nul 2>nul
if %errorlevel% neq 0 (
    echo [INFO] PyYAML is missing. Automatically installing required dependencies...
    python -m pip install --upgrade pyyaml
    if %errorlevel% neq 0 (
        echo [ERROR] Could not install PyYAML. Please run: pip install pyyaml
        pause
        exit /b 1
    )
    echo [OK] PyYAML installed successfully.
    echo.
)

rem 3. Launch the Server
python server.py %*
