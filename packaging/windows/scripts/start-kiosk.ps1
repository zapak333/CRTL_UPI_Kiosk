<#
  Opens the kiosk screen full-screen (Chrome if installed, otherwise Microsoft Edge).
  The URL comes from ..\config\kiosk-url.txt, so a touchscreen PC can point at a kiosk
  server on another machine (e.g. http://canteen-server:8080/kiosk).
  To leave kiosk mode: Alt+F4.
#>
param([string]$Url = '')
$ErrorActionPreference = 'Stop'
$AppDir = Split-Path -Parent $PSScriptRoot
if (-not $Url) {
  $f = Join-Path $AppDir 'config\kiosk-url.txt'
  $Url = if (Test-Path $f) { (Get-Content $f -TotalCount 1).Trim() } else { 'http://localhost:8080/kiosk' }
}

# At boot the server may still be starting: wait for it (up to 3 minutes) before opening the browser.
$health = ([Uri]$Url).GetLeftPart([UriPartial]::Authority) + '/api/health'
$deadline = (Get-Date).AddMinutes(3)
while ((Get-Date) -lt $deadline) {
  try { if ((Invoke-RestMethod $health -TimeoutSec 4).ok) { break } } catch { }
  Start-Sleep -Seconds 3
}

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
$edge = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

# A separate browser profile, so kiosk mode works even when the browser is already open
# and no personal logins or saved passwords are visible on the kiosk.
$profileDir = Join-Path $env:LOCALAPPDATA 'CRTLKiosk\browser-profile'
New-Item -ItemType Directory -Force $profileDir | Out-Null
$common = @("--kiosk", $Url, "--user-data-dir=`"$profileDir`"", '--no-first-run', '--no-default-browser-check',
  '--noerrdialogs', '--disable-pinch', '--overscroll-history-navigation=0', '--disable-features=TranslateUI',
  '--kiosk-printing', '--disable-session-crashed-bubble')

if ($chrome) {
  Start-Process -FilePath $chrome -ArgumentList $common
} elseif ($edge) {
  Start-Process -FilePath $edge -ArgumentList ($common + '--edge-kiosk-type=fullscreen')
} else {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("Neither Google Chrome nor Microsoft Edge was found.`nInstall one of them, or open $Url in any browser.", 'CRTL Kiosk') | Out-Null
}
