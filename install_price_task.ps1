# install_price_task.ps1
# Register a weekly Windows scheduled task that refreshes the dashboard price
# snapshot and uploads it to the server. Weekly (not monthly) on purpose:
# if one run fails or the PC was off, the next Monday retries automatically.
#
# Run once:  powershell -ExecutionPolicy Bypass -File .\install_price_task.ps1
# Check:     schtasks /Query /TN AGI-Prices-Refresh /V /FO LIST
# Remove:    schtasks /Delete /TN AGI-Prices-Refresh /F
#
# ASCII-only on purpose (PowerShell 5.1 + BOM-less UTF-8 = parser errors).
$ErrorActionPreference = 'Stop'

$TaskName = 'AGI-Prices-Refresh'
$Script   = 'C:\gs-project\refresh_prices.ps1'

if (-not (Test-Path $Script)) { Write-Error "missing $Script"; exit 1 }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
          -Argument ('-ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $Script)

# every Monday 08:30, plus one on the 1st of each month 08:30
$trigWeekly = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 08:30
$trigMonth  = New-ScheduledTaskTrigger -Once -At (Get-Date '08:30') `
              -RepetitionInterval (New-TimeSpan -Days 1)

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
            -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigWeekly `
  -Settings $settings -Description 'Refresh AGI dashboard price snapshot and upload to server' -Force | Out-Null

Write-Host "Registered task: $TaskName (weekly, Monday 08:30)"
schtasks /Query /TN $TaskName /FO LIST | Select-Object -First 8
