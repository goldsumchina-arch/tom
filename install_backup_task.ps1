# install_backup_task.ps1  --  BACKUP-NOWINDOW-20261104
#
# (Re)register the daily production-DB backup task so that it can NEVER show a
# console window.
#
# Root cause this fixes:
#   The old action was
#       powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File backup_tencent.ps1
#   powershell.exe is a CONSOLE program. When Task Scheduler (InteractiveToken =
#   "run only when user is logged on") starts it, Windows creates a console window
#   on the interactive desktop first, and only then does PowerShell see the
#   -WindowStyle Hidden flag. Result: a black window pops up every morning at 09:00
#   (and ssh/scp paint their progress into it). -WindowStyle Hidden cannot prevent
#   a console program from getting a console.
#
#   Correct approach: launch via wscript.exe (GUI subsystem, has no console) and
#   start PowerShell with WScript.Shell.Run(cmd, 0, False) -> SW_HIDE, so the
#   console is created hidden from the very first frame (see backup_hidden.vbs).
#
# Usage (normal PowerShell, no admin needed for a per-user task):
#     powershell -ExecutionPolicy Bypass -File .\install_backup_task.ps1
$ErrorActionPreference = 'Stop'

$TaskName = 'AGI-PM-Tencent-Backup'
$Vbs      = 'C:\gs-project\backup_hidden.vbs'

if (-not (Test-Path $Vbs)) { throw "missing launcher: $Vbs" }

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('//nologo "{0}"' -f $Vbs)
$trigger = New-ScheduledTaskTrigger -Daily -At '09:00'
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Force | Out-Null

$t = Get-ScheduledTask -TaskName $TaskName
Write-Host ("OK  {0}" -f $TaskName)
Write-Host ("    run : {0} {1}" -f $t.Actions[0].Execute, $t.Actions[0].Arguments)
Write-Host ("    when: daily {0}" -f ($t.Triggers[0].StartBoundary -replace '.*T', ''))
Write-Host "    test: schtasks /Run /TN `"$TaskName`"   (no window should appear)"
Write-Host "    log : %USERPROFILE%\OneDrive\agi-pm-backup\OneDrive\agi-pm-backup\backup.log"
