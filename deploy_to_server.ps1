# deploy_to_server.ps1
# Sync local node-backend/dist (self-hosted frontend) + node-backend/src (backend business code)
# + node-backend/server.mjs (entry) to the Tencent Cloud server (SSH key), then restart the backend.
# Run in Windows PowerShell:  powershell -ExecutionPolicy Bypass -File .\deploy_to_server.ps1
# NOTE: ASCII-only on purpose - PowerShell 5.1 reads a BOM-less .ps1 as ANSI and a UTF-8
#       BOM breaks line 1 parsing on this machine, so keep all text ASCII.
$ErrorActionPreference = 'Stop'

$Server        = 'ubuntu@124.156.134.135'
$Key           = "$HOME/.ssh/agi_pm_deploy"
$LocalDist     = 'c:/gs-project/node-backend/dist'
$RemoteDist    = '/home/ubuntu/node-backend/dist'
$LocalSrc      = 'c:/gs-project/node-backend/src'
$RemoteSrc     = '/home/ubuntu/node-backend/src'
$LocalServer   = 'c:/gs-project/node-backend/server.mjs'
$RemoteServer  = '/home/ubuntu/node-backend/server.mjs'
$RemoteSrvDir  = '/home/ubuntu/node-backend'
$NodeBin       = '/usr/bin/node'

if (-not (Test-Path $Key)) {
  Write-Error "Missing SSH key $Key - copy it back from the server first"; exit 1
}
if (-not (Test-Path $LocalDist)) {
  Write-Error "Missing local dir $LocalDist"; exit 1
}
if (-not (Test-Path $LocalSrc)) {
  Write-Error "Missing local dir $LocalSrc"; exit 1
}
# guard: never deploy dist without index.html (would 404 the whole app)
if (-not (Test-Path (Join-Path $LocalDist 'index.html'))) {
  Write-Error "Local dist has no index.html - abort (would 404 the server)"; exit 1
}

# OpenSSH 9+ scp uses the SFTP protocol and requires the destination dir to pre-exist,
# otherwise "realpath ... No such file / path canonicalization failed". Create them first.
Write-Host ">> Ensure remote dirs exist"
& ssh -i $Key -o StrictHostKeyChecking=no -o BatchMode=yes $Server "mkdir -p $RemoteDist $RemoteSrc"
if ($LASTEXITCODE -ne 0) { Write-Error "failed to create remote dirs"; exit 1 }

Write-Host ">> Sync $LocalDist -> ${Server}:${RemoteDist}"
& scp -i $Key -o StrictHostKeyChecking=no -r "$LocalDist/." "${Server}:$RemoteDist/"
if ($LASTEXITCODE -ne 0) { Write-Error "dist sync failed"; exit 1 }

Write-Host ">> Sync $LocalSrc -> ${Server}:${RemoteSrc} (backend business code)"
& scp -i $Key -o StrictHostKeyChecking=no -r "$LocalSrc/." "${Server}:$RemoteSrc/"
if ($LASTEXITCODE -ne 0) { Write-Error "src sync failed"; exit 1 }

Write-Host ">> Sync $LocalServer -> ${Server}:${RemoteServer} (backend entry, import path changed)"
& scp -i $Key -o StrictHostKeyChecking=no "$LocalServer" "${Server}:$RemoteServer"
if ($LASTEXITCODE -ne 0) { Write-Error "server.mjs sync failed"; exit 1 }

Write-Host ">> Sync backend helper modules ..."
& scp -i $Key -o StrictHostKeyChecking=no "c:/gs-project/node-backend/tencent-usage.mjs" "${Server}:$RemoteSrvDir/tencent-usage.mjs"
if ($LASTEXITCODE -ne 0) { Write-Error "tencent-usage.mjs sync failed"; exit 1 }

Write-Host ">> Restart backend (loads new session TTL / worker code)..."
& ssh -i $Key -o StrictHostKeyChecking=no -o BatchMode=yes $Server "sudo pkill -f 'node-backend/server.mjs' || true; sleep 1; cd $RemoteSrvDir && setsid sudo nohup $NodeBin $RemoteSrvDir/server.mjs > $RemoteSrvDir/server.out.log 2>&1 < /dev/null & sleep 2; ps aux | grep 'server.mjs' | grep -v grep || echo 'WARN: process not up'"

Write-Host ">> Done. Verify on server:"
& ssh -i $Key -o StrictHostKeyChecking=no -o BatchMode=yes $Server "echo '--- HTTP ---'; curl -s -o /dev/null -w 'HTTP %{http_code}' http://127.0.0.1:3000/; echo; echo '--- process ---'; ps aux | grep 'server.mjs' | grep -v grep"
Write-Host ""
Write-Host "TIP: hard-refresh the browser (Ctrl+Shift+R) to drop the cached index.html before testing."
