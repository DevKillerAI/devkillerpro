$ErrorActionPreference = 'Stop'
$tailscale = 'C:\Program Files\Tailscale\tailscale.exe'
if (-not (Test-Path -LiteralPath $tailscale)) { throw 'Tailscale is not installed.' }
$status = (& $tailscale status --json | ConvertFrom-Json)
if ($status.BackendState -ne 'Running') {
  throw 'Sign in to Tailscale from its Windows tray icon, then run this script again.'
}
$health = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/login' -Method Get -TimeoutSec 10
if ($health.StatusCode -ne 200) { throw 'DevKiller is not ready on local port 3000.' }
& $tailscale serve --bg 3000
if ($LASTEXITCODE -ne 0) { throw 'Tailscale could not publish the private DevKiller address.' }
& $tailscale serve status
