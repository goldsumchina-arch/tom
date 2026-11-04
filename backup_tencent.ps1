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
# NO-WINDOW rule (BACKUP-NOWINDOW-20261104):
#   This script must NEVER write to a console. It is launched by
#   backup_hidden.vbs (wscript + WScript.Shell.Run(cmd, 0, False)) so no black
#   window appears at 09:00. All output goes to $LocalBackup\backup.log through
#   pipes (child stdout/stderr is redirected), and scp runs with -q so it does
#   not paint a progress meter anywhere.
#
# NOTE: keep this file pure ASCII - Windows PowerShell 5.1 mis-decodes UTF-8
#       files without BOM and can fail to parse them.
# Usage: wscript.exe //nologo backup_hidden.vbs
#        (manual: powershell -ExecutionPolicy Bypass -File .\backup_tencent.ps1)
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$Server      = 'ubuntu@124.156.134.135'
$Key         = "$HOME/.ssh/agi_pm_deploy"
# OneDrive sync root is C:\Users\tomal\OneDrive\agi-pm-backup\OneDrive (set in the
# OneDrive client), so the backup must live INSIDE that folder to actually sync.
$LocalBackup = "$HOME\OneDrive\agi-pm-backup\OneDrive\agi-pm-backup"
$Log         = Join-Path $LocalBackup 'backup.log'

if (-not (Test-Path $Key)) {
    "MISSING SSH KEY $Key" | Out-File -Append -Encoding utf8 $Log
    exit 1
}
New-Item -ItemType Directory -Force -Path "$LocalBackup/data" | Out-Null

function Write-Log([string]$msg) {
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    $line | Out-File -Append -Encoding utf8 $Log
}

Write-Log "=== start (server=$Server) ==="

# 1) ask the server to make a consistent sqlite snapshot (.backup = WAL-safe)
$out = & ssh -i $Key -o StrictHostKeyChecking=no $Server "/home/ubuntu/backup_agipm.sh" 2>&1
$out | Out-File -Append -Encoding utf8 $Log
if ($LASTEXITCODE -ne 0) { Write-Log "ERROR server snapshot failed (exit $LASTEXITCODE)"; exit 1 }

# 2) pull the snapshots (-q: no progress meter, nothing to print anywhere)
Write-Log "pulling snapshots -> data/"
$out = & scp -q -i $Key -o StrictHostKeyChecking=no "${Server}:/home/ubuntu/node-backend/backups/agi-*.db" "$LocalBackup/data/" 2>&1
if ($out) { $out | Out-File -Append -Encoding utf8 $Log }
if ($LASTEXITCODE -ne 0) { Write-Log "ERROR scp failed (exit $LASTEXITCODE)"; exit 1 }

# 3) Drop anything that is not a dated snapshot: attachments, raw db, -wal, -shm, ghostbak
# (Remove-Item is called with an explicit -Path on purpose: the piped form is not
#  supported by the Remove-Item wrapper available in this environment.)
Get-ChildItem "$LocalBackup/data" -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -notmatch '^agi-\d{4}-\d{2}-\d{2}\.db$'
} | ForEach-Object {
    Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
}

# 4) Keep only the 10 most recent snapshots
Get-ChildItem "$LocalBackup/data/agi-*.db" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip 10 | ForEach-Object {
        Remove-Item -Path $_.FullName -Force -ErrorAction SilentlyContinue
    }

# 5) stamp last successful run
$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$ts | Out-File -Encoding utf8 "$LocalBackup/last_backup.txt"
Write-Log "=== done at $ts (snapshots only, no attachments) ==="
