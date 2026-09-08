$ErrorActionPreference = 'Stop'
$tailscale = 'C:\Program Files\Tailscale\tailscale.exe'
if (-not (Test-Path -LiteralPath $tailscale)) { throw 'Tailscale is not installed.' }
& $tailscale serve reset
if ($LASTEXITCODE -ne 0) { throw 'Tailscale private sharing could not be stopped.' }
