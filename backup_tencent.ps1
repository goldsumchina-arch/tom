# backup_tencent.ps1
# 把腾讯云生产数据（SQLite + 附件）拉到本机 OneDrive 同步目录，实现异地备份。
# 数据量极小（agi.db ~484KB + files/ ~12MB，共约 16MB），OneDrive 同步无压力。
# 运行： powershell -ExecutionPolicy Bypass -File .\backup_tencent.ps1
$ErrorActionPreference = 'Stop'

$Server      = 'ubuntu@124.156.134.135'
$Key         = "$HOME/.ssh/agi_pm_deploy"
# OneDrive 同步目录（放这里，文件一落地就被 OneDrive 传上云）
$LocalBackup = "$HOME\OneDrive\agi-pm-backup"

if (-not (Test-Path $Key)) {
    Write-Error "Missing SSH key $Key"; exit 1
}
New-Item -ItemType Directory -Force -Path $LocalBackup | Out-Null

Write-Host ">> Pull Tencent data -> $LocalBackup"
& scp -i $Key -o StrictHostKeyChecking=no -r "${Server}:node-backend/data/." "$LocalBackup/data/"
if ($LASTEXITCODE -ne 0) { Write-Error "scp failed"; exit 1 }

$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$ts | Out-File -Encoding utf8 "$LocalBackup/last_backup.txt"
Write-Host ">> Backup done at $ts (OneDrive will sync automatically)"
