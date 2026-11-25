<# Restarts the kiosk server (run after editing the settings file). Needs administrator rights. #>
$ErrorActionPreference = 'Stop'
try {
  Start-Service CRTLKioskDB
  Restart-Service CRTLKioskServer -Force
  Write-Host 'CRTL Kiosk Server restarted.' -ForegroundColor Green
} catch {
  Write-Host "Could not restart: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Log files: C:\ProgramData\CRTLKiosk\logs'
}
Start-Sleep -Seconds 4
