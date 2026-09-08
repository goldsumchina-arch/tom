# backup_tencent.ps1
# Pull Tencent production data into the local OneDrive folder (offsite backup).
#
# SCOPE: database snapshots ONLY.
#   - Attachments (files/) are intentionally NOT synced, to keep the OneDrive
#     quota small. They stay on the server and are covered by the server-side
#     weekly files-*.tar.gz archives (/home/ubuntu/node-backend/backups).
#   - It pulls the consistent snapshot produced by server-side `sqlite3 .backup`
#     (handles WAL correctly) instead of copying the raw agi.db.
#
# NOTE: keep this file pure ASCII - Windows PowerShell 5.1 mis-decodes UTF-8
#       files without BOM and can fail to parse them.
# Usage: powershell -ExecutionPolicy Bypass -File .\backup_tencent.ps1
$ErrorActionPreference = 'Stop'

$Server      = 'ubuntu@124.156.134.135'
$Key         = "$HOME/.ssh/agi_pm_deploy"
# OneDrive sync root is C:\Users\tomal\OneDrive\agi-pm-backup\OneDrive (set in the
# OneDrive client), so the backup must live INSIDE that folder to actually sync.
$LocalBackup = "$HOME\OneDrive\agi-pm-backup\OneDrive\agi-pm-backup"

if (-not (Test-Path $Key)) {
    Write-Error "Missing SSH key $Key"
    exit 1
}
New-Item -ItemType Directory -Force -Path "$LocalBackup/data" | Out-Null

Write-Host "Triggering server-side consistent snapshot ..."
& ssh -i $Key -o StrictHostKeyChecking=no $Server "/home/ubuntu/backup_agipm.sh"
if ($LASTEXITCODE -ne 0) { Write-Error "server snapshot failed"; exit 1 }

Write-Host "Pulling latest DB snapshot -> $LocalBackup/data (no attachments)"
& scp -i $Key -o StrictHostKeyChecking=no "${Server}:/home/ubuntu/node-backend/backups/agi-*.db" "$LocalBackup/data/"
if ($LASTEXITCODE -ne 0) { Write-Error "scp snapshot failed"; exit 1 }

# Drop anything that is not a dated snapshot: attachments, raw db, -wal, -shm, ghostbak
# (Remove-Item is called with an explicit -Path on purpose: the piped form is not
#  supported by the Remove-Item wrapper available in this environment.)
Get-ChildItem "$LocalBackup/data" -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -notmatch '^agi-\d{4}-\d{2}-\d{2}\.db$'
} | ForEach-Object {
    Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
}

# Keep only the 10 most recent snapshots
Get-ChildItem "$LocalBackup/data/agi-*.db" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip 10 | ForEach-Object {
        Remove-Item -Path $_.FullName -Force -ErrorAction SilentlyContinue
    }

$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$ts | Out-File -Encoding utf8 "$LocalBackup/last_backup.txt"
Write-Host "Backup done at $ts (snapshots only, no attachments)"
