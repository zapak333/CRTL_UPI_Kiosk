<# Removes the CRTL Kiosk services and firewall rule. Data in C:\ProgramData\CRTLKiosk is kept. #>
param([Parameter(Mandatory)] [string]$AppDir)
$ErrorActionPreference = 'Continue'
$svcExe = Join-Path $AppDir 'service\CRTLKioskServer.exe'
if (Get-Service CRTLKioskServer -ErrorAction SilentlyContinue) {
  Stop-Service CRTLKioskServer -Force -ErrorAction SilentlyContinue
  if (Test-Path $svcExe) { & $svcExe uninstall } else { & sc.exe delete CRTLKioskServer }
}
if (Get-Service CRTLKioskDB -ErrorAction SilentlyContinue) {
  Stop-Service CRTLKioskDB -Force -ErrorAction SilentlyContinue
  $pgctl = Join-Path $AppDir 'pgsql\bin\pg_ctl.exe'
  if (Test-Path $pgctl) { & $pgctl unregister -N CRTLKioskDB } else { & sc.exe delete CRTLKioskDB }
}
Get-NetFirewallRule -DisplayName 'CRTL Kiosk' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
# Give Windows a moment to release node.exe / postgres.exe so the uninstaller can delete them
Start-Sleep -Seconds 3
exit 0
