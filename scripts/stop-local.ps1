$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
. (Join-Path $PSScriptRoot 'local-processes.ps1')
$processDir = Join-Path $projectRoot '.devkiller\processes'
if (-not (Test-Path -LiteralPath $processDir)) {
  Write-Output 'No app processes are registered for this project. Supabase and other apps were not changed.'
  exit 0
}
$lock = [System.IO.File]::Open((Join-Path $processDir 'lifecycle.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
try {
  # Validate both roots before selecting any descendants or stopping anything.
  $roots = @()
  foreach ($service in @('worker','web')) {
    $process = Get-LocalService -ProjectRoot $projectRoot -Service $service
    if ($process) { $roots += $process }
  }
  $all = @(Get-CimInstance Win32_Process)
  $selected = @{}
  function Add-Descendants {
    param($Parent)
    $selected[[int]$Parent.ProcessId] = $Parent
    foreach ($child in $all | Where-Object { $_.ParentProcessId -eq $Parent.ProcessId }) {
      if (-not $selected.ContainsKey([int]$child.ProcessId) -and $child.CreationDate -ge $Parent.CreationDate) { Add-Descendants $child }
    }
  }
  foreach ($root in $roots) {
    $snapshotRoot = $all | Where-Object { $_.ProcessId -eq $root.ProcessId -and $_.CreationDate -eq $root.CreationDate -and $_.CommandLine -eq $root.CommandLine }
    if ($snapshotRoot) { Add-Descendants $snapshotRoot }
  }
  # Parent processes are stopped first so they cannot restart children.
  $stopped = 0
  foreach ($selectedProcess in $selected.Values | Sort-Object CreationDate) {
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$selectedProcess.ProcessId)" -ErrorAction SilentlyContinue
    if ($current -and $current.CreationDate -eq $selectedProcess.CreationDate -and $current.CommandLine -eq $selectedProcess.CommandLine) {
      Stop-Process -Id $current.ProcessId -ErrorAction Stop
      $stopped++
    }
  }
  Write-Output "Stopped $stopped registered app process(es) and descendants. Supabase and generated app data were preserved."
  Write-Output 'An interrupted V2 run retains its durable state and resumes after its lease expires.'
} finally { $lock.Dispose() }
