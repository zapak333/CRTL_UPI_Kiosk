<# Used by Start-menu shortcuts: runs a maintenance script or opens the settings file with administrator rights. #>
param([Parameter(Mandatory)] [string]$Action)
$AppDir = Split-Path -Parent $PSScriptRoot
$ps = "$env:windir\System32\WindowsPowerShell\v1.0\powershell.exe"
switch ($Action) {
  'edit-settings' { Start-Process notepad.exe -Verb RunAs -ArgumentList "`"$env:ProgramData\CRTLKiosk\.env`"" }
  'restart'       { Start-Process $ps -Verb RunAs -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSScriptRoot\restart-server.ps1`"" }
  'create-admin'  { Start-Process cmd.exe -Verb RunAs -ArgumentList '/c', "`"$PSScriptRoot\create-admin.cmd`"" }
  'backup'        { Start-Process cmd.exe -Verb RunAs -ArgumentList '/c', "`"$PSScriptRoot\backup-now.cmd`"" }
}
