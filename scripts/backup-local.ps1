$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$backupRoot = Join-Path $projectRoot ".devkiller\backups"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $backupRoot "devkiller-$timestamp.sql"

[System.IO.Directory]::CreateDirectory($backupRoot) | Out-Null
Push-Location $projectRoot
try {
  & npx supabase db dump --local --data-only --use-copy -f $backupPath
  if ($LASTEXITCODE -ne 0) { throw "Database backup failed." }
  Write-Output "Backup created: $backupPath"
} finally {
  Pop-Location
}
