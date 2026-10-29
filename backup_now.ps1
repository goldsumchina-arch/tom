# backup_now.ps1 - AGI-PM 一键双备份（本地 SQLite + 云端 D1）
# 用法：powershell -ExecutionPolicy Bypass -File .\backup_now.ps1

$root = 'C:\gs-project'
Set-Location $root
$env:PYTHONIOENCODING = 'utf-8'

Write-Host ''
Write-Host '==> AGI-PM 一键双备份' -ForegroundColor Cyan
Write-Host ''

& python backup_agipm.py
$code = $LASTEXITCODE

if ($code -ne 0) {
    Write-Host '[FAIL] 备份失败，请查看上方输出。' -ForegroundColor Red
    exit $code
}

Write-Host ''
Write-Host '==> 备份产物目录：' -NoNewline
Write-Host (Join-Path $root 'backups') -ForegroundColor Green
