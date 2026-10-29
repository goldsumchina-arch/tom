@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM ============================================================
REM  AGI-PM 唯一实例启动脚本
REM  作用：启动前彻底清理残留的 app.py 进程与占用 5050 端口的进程，
REM        确保任何时刻只有 1 个服务实例，避免"改了代码看不到效果"。
REM  用法：双击本文件，或在 PowerShell 里执行 .\start_server.bat
REM ============================================================

set PORT=5050
set DIR=%~dp0
set PYEXE=C:\Users\tomal\AppData\Local\Python\pythoncore-3.14-64\python.exe
if not exist "%PYEXE%" set PYEXE=python

echo [1/3] 结束所有 app.py 进程...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*app.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

echo [2/3] 结束占用 %PORT% 端口的进程...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr LISTENING') do (
    if not "%%a"=="0" (
        echo      结束 PID %%a
        taskkill /PID %%a /F >nul 2>&1
    )
)

echo [3/3] 等待端口释放并启动服务...
timeout /t 2 /nobreak >nul

cd /d "%DIR%"
echo.
echo 服务启动中，请勿关闭本窗口（关闭即停止服务）
echo 访问地址: http://127.0.0.1:%PORT%
echo ============================================================
"%PYEXE%" app.py

echo.
echo 服务已停止。
pause
