$ErrorActionPreference = 'Stop'
$ruleName = 'DevKiller-Local-Supabase-Only'
$localPorts = @('54321-54329', '55321-55329', '56321-56329')
$remoteAddresses = @(
  '0.0.0.0-126.255.255.255',
  '128.0.0.0-255.255.255.255',
  '::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'
)
if (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue) {
  Set-NetFirewallRule -Name $ruleName -Enabled True -Profile Any -Action Block -ErrorAction Stop
  Get-NetFirewallRule -Name $ruleName | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $localPorts -ErrorAction Stop
} else {
  New-NetFirewallRule -Name $ruleName -DisplayName 'DevKiller: Supabase local access only' `
    -Direction Inbound -Action Block -Enabled True -Profile Any -Protocol TCP `
    -LocalPort $localPorts -RemoteAddress $remoteAddresses | Out-Null
}
Write-Output 'Local Supabase firewall protection is active.'
