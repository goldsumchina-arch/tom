# 以管理员身份在 PowerShell 运行此脚本，创建每日自动抓取任务
# 使用 pythonw.exe（无控制台窗口版）：计划任务触发时不再弹出黑色窗口
$py  = "C:\Users\tomal\AppData\Local\Python\pythoncore-3.14-64\pythonw.exe"
$dir = "C:\gs-project"
$action = New-ScheduledTaskAction -Execute $py -Argument "run_monthly_refresh.py" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -Daily -At "08:00"
$pri = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -StartWhenAvailable
Register-ScheduledTask -TaskName "LivestockDailyFetch" -Action $action -Trigger $trigger -Settings $pri -Force
Write-Host "Task LivestockDailyFetch created (daily 08:00 online fetch CN/VN livestock)"
