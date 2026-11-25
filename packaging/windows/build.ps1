<#
  Builds the CRTL Kiosk Windows installer (CRTL-Kiosk-Setup-<version>.exe).

  Runs on Windows (GitHub Actions windows-latest, or a dev PC with Node 22 and Inno Setup 6).
  It downloads the runtime pieces, builds the app, assembles everything into build\stage\
  and compiles packaging\windows\crtl-kiosk.iss with Inno Setup.

  Nothing secret is bundled: Razorpay keys, the session secret, database passwords and the
  first-admin setup token are all created on the target PC at install time.

  Usage:  pwsh packaging/windows/build.ps1 [-Version 1.0.0.5]
#>
param(
  [string]$Version = '',
  [string]$NodeMajor = '22',
  # PostgreSQL major version that ships inside the installer. Changing the major version later
  # needs a data migration (pg_upgrade), so keep it fixed for existing installs.
  [string]$PgMajor = '17',
  [string]$WinSWVersion = 'v2.12.0'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is very slow with the progress bar

$Root  = (Resolve-Path "$PSScriptRoot\..\..").Path
$Build = Join-Path $Root 'build'
$Cache = Join-Path $Build 'downloads'
$Stage = Join-Path $Build 'stage'
$Out   = Join-Path $Build 'installer'

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Download($url, $dest) {
  if (Test-Path $dest) { Write-Host "cached: $dest"; return }
  Write-Host "download: $url"
  Invoke-WebRequest -Uri $url -OutFile "$dest.part" -UseBasicParsing
  Move-Item "$dest.part" $dest
}
function Test-Url($url) {
  try { $r = Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -MaximumRedirection 5; return $r.StatusCode -eq 200 } catch { return $false }
}

if (-not $Version) {
  $base = (Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version
  $run = if ($env:GITHUB_RUN_NUMBER) { $env:GITHUB_RUN_NUMBER } else { '0' }
  $Version = "$base.$run"
}

New-Item -ItemType Directory -Force $Cache, $Out | Out-Null
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force $Stage | Out-Null

# ---------------------------------------------------------------- Node.js (portable)
Step "Node.js $NodeMajor (portable, win-x64)"
$index = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
$nodeVer = ($index | Where-Object { $_.version -like "v$NodeMajor.*" } | Select-Object -First 1).version
$nodeZip = Join-Path $Cache "node-$nodeVer-win-x64.zip"
Download "https://nodejs.org/dist/$nodeVer/node-$nodeVer-win-x64.zip" $nodeZip
Expand-Archive $nodeZip -DestinationPath "$Build\tmp-node" -Force
New-Item -ItemType Directory -Force "$Stage\node" | Out-Null
# Only node.exe is needed at runtime (no npm on the kiosk PC)
Copy-Item "$Build\tmp-node\node-$nodeVer-win-x64\node.exe" "$Stage\node\"
Copy-Item "$Build\tmp-node\node-$nodeVer-win-x64\LICENSE" "$Stage\node\"
Remove-Item -Recurse -Force "$Build\tmp-node"

# ---------------------------------------------------------------- PostgreSQL (binaries only)
Step "PostgreSQL $PgMajor (EDB Windows binaries)"
$pgZip = Get-ChildItem $Cache -Filter "postgresql-$PgMajor.*-windows-x64-binaries.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $pgZip) {
  $found = $null
  foreach ($minor in 15..0) {
    foreach ($build in 1..2) {
      $u = "https://get.enterprisedb.com/postgresql/postgresql-$PgMajor.$minor-$build-windows-x64-binaries.zip"
      if (Test-Url $u) { $found = $u; break }
    }
    if ($found) { break }
  }
  if ($found) {
    $pgZipPath = Join-Path $Cache ([IO.Path]::GetFileName($found))
    Download $found $pgZipPath
    $pgZip = Get-Item $pgZipPath
  }
}
if ($pgZip) {
  Expand-Archive $pgZip.FullName -DestinationPath "$Build\tmp-pg" -Force
  $pgSrc = "$Build\tmp-pg\pgsql"
} else {
  # Fallback for CI: GitHub's Windows runners ship a full PostgreSQL install.
  $pgSrc = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq $PgMajor } | Select-Object -First 1 -ExpandProperty FullName
  if (-not $pgSrc) { throw "Could not download PostgreSQL $PgMajor binaries and no local copy was found." }
  Write-Warning "EDB download unavailable, using $pgSrc"
}
New-Item -ItemType Directory -Force "$Stage\pgsql" | Out-Null
foreach ($d in 'bin', 'lib', 'share') { Copy-Item -Recurse "$pgSrc\$d" "$Stage\pgsql\$d" }
# Trim what a server-only install never uses (pgAdmin, StackBuilder, docs, headers, debug symbols)
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "$Stage\pgsql\bin\pgAdmin*", "$Stage\pgsql\bin\stackbuilder*", "$Stage\pgsql\lib\*.lib", "$Stage\pgsql\lib\*.pdb", "$Stage\pgsql\bin\*.pdb"
if (Test-Path "$Build\tmp-pg") { Remove-Item -Recurse -Force "$Build\tmp-pg" }
$pgVersionText = & "$Stage\pgsql\bin\postgres.exe" --version
Write-Host $pgVersionText

# ---------------------------------------------------------------- Windows service wrapper + VC++ runtime
Step "WinSW $WinSWVersion and Visual C++ runtime"
New-Item -ItemType Directory -Force "$Stage\service", "$Stage\redist" | Out-Null
Download "https://github.com/winsw/winsw/releases/download/$WinSWVersion/WinSW-x64.exe" "$Cache\WinSW-x64-$WinSWVersion.exe"
Copy-Item "$Cache\WinSW-x64-$WinSWVersion.exe" "$Stage\service\CRTLKioskServer.exe"
# PostgreSQL needs the MSVC runtime; installed silently only when the PC does not already have it
Download 'https://aka.ms/vs/17/release/vc_redist.x64.exe' "$Cache\vc_redist.x64.exe"
Copy-Item "$Cache\vc_redist.x64.exe" "$Stage\redist\"

# ---------------------------------------------------------------- App build
Step 'Build web + server'
Push-Location $Root
try {
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE) { throw 'npm ci failed' }
  npm run build
  if ($LASTEXITCODE) { throw 'npm run build failed' }

  $app = "$Stage\app"
  New-Item -ItemType Directory -Force "$app\server", "$app\web" | Out-Null
  Copy-Item -Recurse "server\dist" "$app\server\dist"
  Copy-Item -Recurse "server\src\db\migrations" "$app\server\dist\db\migrations"
  Copy-Item -Recurse "server\assets" "$app\server\assets"
  Copy-Item "server\package.json" "$app\server\"
  Copy-Item "server\.env.example" "$app\server\"
  Copy-Item -Recurse "web\dist" "$app\web\dist"
  Get-ChildItem "$app\server\dist" -Recurse -Filter *.map | Remove-Item -Force
  Copy-Item -Recurse "docs" "$Stage\docs"

  Step 'Production dependencies for the server'
  Remove-Item -Recurse -Force node_modules
  npm ci --omit=dev --workspace=@crtl/server --include-workspace-root=false --no-audit --no-fund
  if ($LASTEXITCODE) { throw 'npm ci (production) failed' }
  # Workspace links (node_modules/@crtl/*) point back into the repo; drop them.
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "node_modules\@crtl"
  robocopy node_modules "$app\node_modules" /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
  $global:LASTEXITCODE = 0
} finally { Pop-Location }

# ---------------------------------------------------------------- Scripts + installer
Step 'Installer scripts'
Copy-Item -Recurse "$PSScriptRoot\scripts" "$Stage\scripts"
Copy-Item "$PSScriptRoot\README-INSTALL.txt" "$Stage\"
Set-Content "$Stage\VERSION.txt" "CRTL Canteen Kiosk $Version`r`n$pgVersionText`r`nNode.js $nodeVer"

Step "Compile installer $Version"
$iscc = @(
  (Get-Command iscc.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $iscc) {
  Write-Host 'Inno Setup not found, installing with Chocolatey'
  choco install innosetup -y --no-progress | Out-Host
  $iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
}
& $iscc "/DAppVersion=$Version" "/DStageDir=$Stage" "/DOutputDir=$Out" "$PSScriptRoot\crtl-kiosk.iss"
if ($LASTEXITCODE) { throw "ISCC failed ($LASTEXITCODE)" }

$exe = Get-ChildItem $Out -Filter "CRTL-Kiosk-Setup-$Version.exe" | Select-Object -First 1
Write-Host "`nBuilt $($exe.FullName) ($([math]::Round($exe.Length / 1MB, 1)) MB)" -ForegroundColor Green
if ($env:GITHUB_OUTPUT) {
  "installer=$($exe.FullName)" | Out-File -Append -Encoding utf8 $env:GITHUB_OUTPUT
  "version=$Version" | Out-File -Append -Encoding utf8 $env:GITHUB_OUTPUT
}
