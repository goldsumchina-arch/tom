@echo off
REM 注册 Windows 任务计划：每月 1 日 09:00 自动运行 run_monthly_refresh.py
REM 需以管理员身份运行一次本文件即可完成注册。
setlocal EnableDelayedExpansion
set TASKNAME=Livestock_Monthly_Refresh
set DIR=C:\gs-project
set SCRIPT=%DIR%\run_monthly_refresh.py
REM 显式使用 pythonw 绝对路径（无控制台窗口版，计划任务触发时不再弹黑窗）
set PYEXEW=C:\Users\tomal\AppData\Local\Python\pythoncore-3.14-64\pythonw.exe
REM 控制台版 python 仅用于本脚本末尾的手动联网验证（需要看到输出）
set PYEXEC=C:\Users\tomal\AppData\Local\Python\pythoncore-3.14-64\python.exe
if not exist "%PYEXEW%" (
  REM 回退：用 PATH 里的 python
  set PYEXEW=pythonw.exe
  set PYEXEC=python
)

REM 检查是否管理员（注册计划任务必须管理员）
net session >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo [WARN] 当前不是管理员，schtasks 注册会失败。
  echo        请右键本文件 -> "以管理员身份运行"。
  echo.
)

REM 直接调用 pythonw + 绝对脚本路径，不经 cmd /c 包装（cmd 会弹控制台窗口）。
REM run_monthly_refresh.py 内部用 __file__ 定位目录，不依赖工作目录。
schtasks /Create /TN "%TASKNAME%" ^
  /TR "\"%PYEXEW%\" \"%SCRIPT%\"" ^
  /SC MONTHLY /D 1 /ST 09:00 ^
  /RU "%USERNAME%" ^
  /RL HIGHEST ^
  /F

if %ERRORLEVEL%==0 (
  echo.
  echo [OK] 已注册任务 "%TASKNAME%"：每月 1 日 09:00 自动刷新畜禽价格（含巴西）。
  echo      触发时使用 pythonw（无窗口）静默后台运行，日志见 _monthly_refresh.log。
  echo      查看： schtasks /Query /TN "%TASKNAME%"
  echo      删除： schtasks /Delete /TN "%TASKNAME%" /F
  echo.
  echo 现在立即跑一次联网验证（巴西生猪/肉鸡/鸡蛋能否抓到当月真实值）...
  echo ============================================================
  "%PYEXEC%" "%SCRIPT%"
  echo ============================================================
  echo 上方若为 BR 的 pig/chicken/egg 输出了具体 USD/kg 数值（非 None），即自动更新可用。
) else (
  echo [FAIL] 注册失败，请右键"以管理员身份运行"本文件。
)
pause
