@echo off
REM 每月自动刷新菲律宾 Bantay Presyo 畜禽零售价（由 Windows 任务计划程序调用）
cd /d "C:\gs-project"
python refresh_ph_monthly.py >> ph_refresh_stdout.log 2>&1
