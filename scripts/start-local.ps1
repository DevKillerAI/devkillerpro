$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
. (Join-Path $PSScriptRoot 'local-processes.ps1')
$nodeCli = (Get-Command node -ErrorAction Stop).Source
$dockerCli = (Get-Command docker -ErrorAction Stop).Source
$processDir = Join-Path $projectRoot '.devkiller\processes'
$logDir = Join-Path $projectRoot '.devkiller\logs'
New-Item -ItemType Directory -Path $processDir, $logDir -Force | Out-Null
$lockPath = Join-Path $processDir 'lifecycle.lock'
$lock = [System.IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
Push-Location $projectRoot
try {
  & $dockerCli info *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Docker is unavailable. Start Docker Desktop first.' }
  $protection = Get-NetFirewallRule -Name 'DevKiller-Local-Supabase-Only' -ErrorAction SilentlyContinue
  if (-not $protection -or $protection.Enabled -ne 'True' -or $protection.Action -ne 'Block') {
    throw 'Run scripts/protect-local-services.ps1 as administrator before starting Supabase.'
  }
  $existingNetwork = & $dockerCli network ls --filter 'name=^devkiller-local$' --format '{{.Name}}'
  if (-not $existingNetwork) {
    & $dockerCli network create --opt 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1' devkiller-local | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Unable to create the local Docker network.' }
  }
  Write-Output 'Starting local Supabase...'
  & npm run infra:start
  if ($LASTEXITCODE -ne 0) { throw 'Supabase did not start. Inspect the diagnostic output above.' }
  & $nodeCli scripts/configure-local-env.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Local environment configuration failed.' }

  # This is deliberately read-only. Schema upgrades remain explicit operator work.
  & $nodeCli --conditions=react-server --import tsx --env-file=.env.local scripts/doctor.ts --pre-start
  if ($LASTEXITCODE -ne 0) { throw 'Startup prerequisites failed. Apply migrations/build the reviewed runtime as indicated above.' }
  $worker = Get-LocalService -ProjectRoot $projectRoot -Service worker
  $web = Get-LocalService -ProjectRoot $projectRoot -Service web
  if (-not $web -and (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {
    throw 'Port 3000 belongs to an unregistered process. No application processes were started; stop or move that process explicitly.'
  }
  $environmentFile = Join-Path $projectRoot '.env.local'
  if (-not $web) {
    $entry = Get-LocalServiceEntry -ProjectRoot $projectRoot -Service web
    $quotedEntry = '"' + $entry + '"'
    $launched = Start-Process -FilePath $nodeCli -ArgumentList @($quotedEntry, 'dev', '--hostname', '127.0.0.1', '--port', '3000') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'web.out.log') -RedirectStandardError (Join-Path $logDir 'web.err.log')
    Save-LocalService -ProjectRoot $projectRoot -Service web -ProcessId $launched.Id
  }
  if (-not $worker) {
    $entry = Get-LocalServiceEntry -ProjectRoot $projectRoot -Service worker
    $quotedEntry = '"' + $entry + '"'
    $environmentArgument = '--env-file="' + $environmentFile + '"'
    $launched = Start-Process -FilePath $nodeCli -ArgumentList @('--conditions=react-server', $environmentArgument, '--import', 'tsx', $quotedEntry) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'worker.out.log') -RedirectStandardError (Join-Path $logDir 'worker.err.log')
    Save-LocalService -ProjectRoot $projectRoot -Service worker -ProcessId $launched.Id
  }

  $webReady = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if (-not (Get-LocalService -ProjectRoot $projectRoot -Service web) -or -not (Get-LocalService -ProjectRoot $projectRoot -Service worker)) {
      throw 'A service exited during startup. Inspect .devkiller\logs; registered surviving processes can be stopped with local:stop.'
    }
    try { $webReady = (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/login' -TimeoutSec 2).StatusCode -eq 200 } catch { $webReady = $false }
    if ($webReady) { break }
    Start-Sleep -Milliseconds 1000
  }
  if (-not $webReady) { throw 'The web server did not become ready. Inspect .devkiller\logs.' }
  & $nodeCli --conditions=react-server --import tsx --env-file=.env.local scripts/doctor.ts
  if ($LASTEXITCODE -ne 0) { throw 'Services started, but V2 readiness failed. Inspect the diagnostics and .devkiller\logs.' }
  Write-Output 'Web and V2 worker are ready. Open http://127.0.0.1:3000'
  Write-Output 'Use local:stop to stop only the registered app processes. Supabase is managed with infra:stop.'
} finally {
  Pop-Location
  $lock.Dispose()
}
