$ErrorActionPreference = 'Stop'

function Get-LocalServiceEntry {
  param([string]$ProjectRoot, [ValidateSet('worker','web')][string]$Service)
  if ($Service -eq 'worker') { return Join-Path $ProjectRoot 'scripts\generator-v2-worker.ts' }
  return Join-Path $ProjectRoot 'node_modules\next\dist\bin\next'
}

function Test-LocalServiceIdentity {
  param($Record, $Process, [string]$ProjectRoot, [ValidateSet('worker','web')][string]$Service)
  if (-not $Record -or -not $Process) { return $false }
  $entry = Get-LocalServiceEntry -ProjectRoot $ProjectRoot -Service $Service
  if ($Record.projectRoot -ne $ProjectRoot -or $Record.service -ne $Service -or $Record.entryPoint -ne $entry) { return $false }
  if ([int]$Record.processId -ne [int]$Process.ProcessId -or $Process.Name -notmatch '^node(\.exe)?$') { return $false }
  if (-not $Process.CreationDate -or -not $Process.CommandLine) { return $false }
  try {
    $created = ([datetime]$Process.CreationDate).ToUniversalTime()
    $recordedCreated = ([datetime]$Record.creationDate).ToUniversalTime()
    if ($created.Ticks -ne $recordedCreated.Ticks) { return $false }
  } catch { return $false }
  $entryPattern = '(?i)(?:^|["\s])' + [regex]::Escape($entry) + '(?:["\s]|$)'
  return $Process.CommandLine -match $entryPattern
}

function Get-LocalService {
  param([string]$ProjectRoot, [ValidateSet('worker','web')][string]$Service)
  $recordPath = Join-Path $ProjectRoot ".devkiller\processes\$Service.json"
  if (-not (Test-Path -LiteralPath $recordPath)) { return $null }
  $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$record.processId)" -ErrorAction SilentlyContinue
  if (-not $process) { return $null }
  if (-not (Test-LocalServiceIdentity -Record $record -Process $process -ProjectRoot $ProjectRoot -Service $Service)) {
    throw "The $Service process record no longer matches its process. No process was selected."
  }
  return $process
}

function Save-LocalService {
  param([string]$ProjectRoot, [ValidateSet('worker','web')][string]$Service, [int]$ProcessId)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
  if (-not $process) { throw "$Service exited before it could be registered. Check .devkiller\logs." }
  $record = [ordered]@{
    projectRoot = $ProjectRoot
    service = $Service
    entryPoint = Get-LocalServiceEntry -ProjectRoot $ProjectRoot -Service $Service
    processId = $ProcessId
    creationDate = ([datetime]$process.CreationDate).ToUniversalTime().ToString('o')
  }
  if (-not (Test-LocalServiceIdentity -Record ([pscustomobject]$record) -Process $process -ProjectRoot $ProjectRoot -Service $Service)) {
    throw "Unable to verify the launched $Service process."
  }
  $recordPath = Join-Path $ProjectRoot ".devkiller\processes\$Service.json"
  $record | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding UTF8
}
