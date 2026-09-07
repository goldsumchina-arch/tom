# deploy_to_server.ps1
# Sync local node-backend/dist (self-hosted frontend) + cloudflare/src/index.js (backend Worker code)
# to the Tencent Cloud server (SSH key), then restart the backend.
# Run in Windows PowerShell:  powershell -ExecutionPolicy Bypass -File .\deploy_to_server.ps1
# NOTE: ASCII-only on purpose - PowerShell 5.1 reads a BOM-less .ps1 as ANSI and a UTF-8
#       BOM breaks line 1 parsing on this machine, so keep all text ASCII.
$ErrorActionPreference = 'Stop'

$Server        = 'ubuntu@124.156.134.135'
$Key           = "$HOME/.ssh/agi_pm_deploy"
$LocalDist     = 'c:/gs-project/node-backend/dist'
$RemoteDist    = '/home/ubuntu/node-backend/dist'
$LocalWorker   = 'c:/gs-project/cloudflare/src/index.js'
$RemoteWorker  = '/home/ubuntu/cloudflare/src/index.js'
$RemoteSrvDir  = '/home/ubuntu/node-backend'
$NodeBin       = '/usr/bin/node'

if (-not (Test-Path $Key)) {
  Write-Error "Missing SSH key $Key - copy it back from the server first"; exit 1
}
if (-not (Test-Path $LocalDist)) {
  Write-Error "Missing local dir $LocalDist"; exit 1
}
# guard: never deploy dist without index.html (would 404 the whole app)
if (-not (Test-Path (Join-Path $LocalDist 'index.html'))) {
  Write-Error "Local dist has no index.html - abort (would 404 the server)"; exit 1
}

Write-Host ">> Sync $LocalDist -> ${Server}:${RemoteDist}"
scp -i $Key -o StrictHostKeyChecking=no -r "$LocalDist/." "${Server}:$RemoteDist/"

Write-Host ">> Sync $LocalWorker -> ${Server}:${RemoteWorker} (backend Worker code)"
scp -i $Key -o StrictHostKeyChecking=no "$LocalWorker" "${Server}:$RemoteWorker"

Write-Host ">> Restart backend (loads new session TTL / worker code)..."
& ssh -i $Key -o StrictHostKeyChecking=no -o BatchMode=yes $Server "sudo pkill -f 'node-backend/server.mjs' || true; sleep 1; cd $RemoteSrvDir && setsid sudo nohup $NodeBin $RemoteSrvDir/server.mjs > $RemoteSrvDir/server.out.log 2>&1 < /dev/null & sleep 2; ps aux | grep 'server.mjs' | grep -v grep || echo 'WARN: process not up'"

Write-Host ">> Done. Verify on server:"
& ssh -i $Key -o StrictHostKeyChecking=no -o BatchMode=yes $Server "echo '--- SESSION_TTL_HOURS ---'; grep -n 'SESSION_TTL_HOURS' $RemoteWorker; echo '--- HTTP ---'; curl -s -o /dev/null -w 'HTTP %{http_code}' http://127.0.0.1:3000/"
Write-Host ""
Write-Host "TIP: hard-refresh the browser (Ctrl+Shift+R) to drop the cached index.html before testing."
