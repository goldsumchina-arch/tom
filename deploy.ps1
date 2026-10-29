<#
 .SYNOPSIS
    把本地 node-backend 的前端/后端源码同步到腾讯云服务器，并验证改动已落地。
    用法（PowerShell，在 c:\gs-project 目录下）：
        .\deploy.ps1
    说明：
        - 只传源码（dist / server.mjs / schema.sql / package.json），不传 node_modules。
        - dist/index.html 是静态文件，传完即生效，无需重启服务；浏览器 Ctrl+Shift+R 强刷即可。
        - 若你改过 server.mjs（后端逻辑），脚本会尝试用 pm2 重启；没装 pm2 会提示，可手动重启。
#>

$ErrorActionPreference = 'Stop'

$Server     = 'ubuntu@124.156.134.135'
$Local      = 'c:\gs-project\node-backend'
$RemoteBase = '~/node-backend'

Write-Host '==> 同步 dist（前端）到服务器 ...' -ForegroundColor Cyan
scp -r "$Local\dist" "$Server`:$RemoteBase/"
# 安全网：若服务器实际从 ~/dist 启动也一并同步
scp -r "$Local\dist" "$Server`:~/dist/"

Write-Host '==> 同步后端核心文件 ...' -ForegroundColor Cyan
scp "$Local\server.mjs"    "$Server`:$RemoteBase/"
scp "$Local\schema.sql"    "$Server`:$RemoteBase/"
scp "$Local\package.json"  "$Server`:$RemoteBase/"

Write-Host '==> 若改过后端，尝试重启服务（仅 pm2 场景）...' -ForegroundColor Cyan
ssh $Server "bash -lc 'pm2 restart server.mjs 2>/dev/null || pm2 restart all 2>/dev/null || echo PM2_NOT_FOUND_SKIP_OK'"

Write-Host '==> 验证改动已落地 ...' -ForegroundColor Cyan
ssh $Server "echo '--- CLOUD_ONLY ---'; grep -n 'var CLOUD_ONLY' $RemoteBase/dist/index.html; echo '--- 模态框按钮标记 ---'; grep -c win-ctrl-fix $RemoteBase/dist/index.html"

Write-Host '完成。浏览器 Ctrl+Shift+R 强刷后重新登录。' -ForegroundColor Green
