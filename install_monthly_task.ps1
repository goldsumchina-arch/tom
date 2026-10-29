# Register "AGI-PM Monthly Price Update"  ->  3rd day of every month, 03:00
# Refreshes metal / feed / livestock price snapshots and uploads them to R2.
#
# Why this shape (two quirks of this machine):
#   1) New-ScheduledTaskTrigger has no -Monthly here, and -Trigger only accepts
#      CIM instances typed MSFT_TaskTrigger, so a hand-built monthly trigger is rejected.
#      -> create the task with native schtasks (/SC MONTHLY /D 3), which supports it.
#   2) schtasks /Change cannot modify the schedule type (/SC is rejected), and
#      hand-written XML fails on namespace.
#      -> delete + /Create, then apply settings with Set-ScheduledTask.
#
# ASCII-only file on purpose: PowerShell 5.1 reads BOM-less .ps1 as ANSI,
# and a UTF-8 BOM breaks line 1 parsing here.
#
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File .\install_monthly_task.ps1
# (If "Access is denied", run as Administrator.)

$ErrorActionPreference = 'Stop'

$taskName = 'AGI-PM Monthly Price Update'
$root     = 'C:\gs-project'
$script   = Join-Path $root 'run_snapshot_task.py'

# pythonw = no console window; fall back if missing
$pyw = 'C:\Users\tomal\AppData\Local\Python\pythoncore-3.14-64\pythonw.exe'
if (-not (Test-Path $pyw)) {
    $c = Get-Command pythonw -ErrorAction SilentlyContinue
    if ($c) { $pyw = $c.Source } else { $pyw = (Get-Command python).Source }
}
Write-Host "Interpreter: $pyw"
Write-Host "Script:      $script"

# ---- remove previous registration (incl. the daily placeholder) ----
& schtasks /Delete /TN $taskName /F 2>&1 | Out-Null

# ---- create: monthly, day 3, 03:00 ----
$tr = '"' + $pyw + '" "' + $script + '"'
& schtasks /Create /TN $taskName /TR $tr /SC MONTHLY /D 3 /ST 03:00 /F
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] schtasks /Create returned $LASTEXITCODE" -ForegroundColor Red
    exit 1
}

# ---- apply settings (StartWhenAvailable, network, timeout, batteries) ----
try {
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RunOnlyIfNetworkAvailable `
        -ExecutionTimeLimit ([TimeSpan]::FromHours(2)) `
        -MultipleInstances IgnoreNew
    Set-ScheduledTask -TaskName $taskName -Settings $settings | Out-Null
    Write-Host "Settings applied."
} catch {
    Write-Host "[WARN] Could not apply extra settings: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[OK] Registered: $taskName  (monthly, day 3 at 03:00)" -ForegroundColor Green
Write-Host "     Log file: cloudflare\snapshot_cron.log"
Write-Host ""
Write-Host "Query:  Get-ScheduledTask -TaskName '$taskName'"
Write-Host "Run now: Start-ScheduledTask -TaskName '$taskName'"

$t = Get-ScheduledTask -TaskName $taskName
Write-Host ""
Write-Host "State:   $($t.State)"
Write-Host "Command: $($t.Actions[0].Execute) $($t.Actions[0].Arguments)"
Write-Host "Triggers:"
$t.Triggers | ForEach-Object { Write-Host "  $($_.CimClass.CimClassName)  start=$($_.StartBoundary)  days=$($_.DaysOfMonth)" }
Get-ScheduledTaskInfo -TaskName $taskName | Select-Object LastRunTime, NextRunTime | Format-List
