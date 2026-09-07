@echo off
chcp 65001 >nul
title AGI-PM APK Builder
cd /d "%~dp0"

REM ============================================================
REM  This batch file only launches build_apk.py
REM  All logic is in Python to avoid cmd parsing issues.
REM ============================================================

echo Starting APK build...
echo.

python build_apk.py

if errorlevel 1 (
    echo.
    echo BUILD FAILED - see messages above.
) else (
    echo.
    echo BUILD SUCCESS
)

echo.
pause
