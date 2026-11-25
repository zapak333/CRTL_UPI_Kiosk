<#
  Post-install configuration, run elevated by the installer (and safe to re-run).

  - Installs the Visual C++ runtime if PostgreSQL needs it
  - Creates the PostgreSQL cluster (first install only) and registers it as service CRTLKioskDB
  - Creates the app database + user with random passwords
  - Writes C:\ProgramData\CRTLKiosk\.env (first install only; upgrades keep it)
  - Registers the Node server as service CRTLKioskServer and waits until it answers

  Exit code 0 = success. Log: C:\ProgramData\CRTLKiosk\logs\install.log
#>
param(
  [Parameter(Mandatory)] [string]$AppDir,
  [string]$OptionsFile = '',
  [string]$ResultFile = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$DataRoot = Join-Path $env:ProgramData 'CRTLKiosk'
$PgData   = Join-Path $DataRoot 'pgdata'
$EnvFile  = Join-Path $DataRoot '.env'
$Logs     = Join-Path $DataRoot 'logs'
$PgBin    = Join-Path $AppDir 'pgsql\bin'
$PgPort   = 5433            # not 5432, so an existing PostgreSQL on the PC is left alone
$DbService  = 'CRTLKioskDB'
$AppService = 'CRTLKioskServer'

New-Item -ItemType Directory -Force $DataRoot, $Logs, "$DataRoot\data", "$DataRoot\backups" | Out-Null
Start-Transcript -Path (Join-Path $Logs 'install.log') -Append | Out-Null

function Say($m) { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $m" }
function RandomHex([int]$bytes) {
  $b = New-Object byte[] $bytes
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  -join ($b | ForEach-Object { $_.ToString('x2') })
}
function Run($exe, [string[]]$argv) {
  # Native tools write progress to stderr; don't let PowerShell treat that as a failure.
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $exe @argv 2>&1 | ForEach-Object { Write-Host "  $_" } } finally { $ErrorActionPreference = $old }
  if ($LASTEXITCODE) { throw "$([IO.Path]::GetFileName($exe)) failed with exit code $LASTEXITCODE" }
}
function Wait-Until([scriptblock]$test, [int]$seconds, [string]$what) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    try { if (& $test) { return } } catch { }
    Start-Sleep -Seconds 2
  }
  throw "Timed out after $seconds s waiting for $what"
}

try {
  # ------------------------------------------------------------ options from the installer wizard
  $opt = @{ PORT = '8080'; PAYMENT_PROVIDER = 'simulated'; RAZORPAY_KEY_ID = ''; RAZORPAY_KEY_SECRET = ''; RAZORPAY_WEBHOOK_SECRET = ''; FIREWALL = '0'; NOSLEEP = '0' }
  if ($OptionsFile -and (Test-Path $OptionsFile)) {
    foreach ($line in Get-Content $OptionsFile) {
      $i = $line.IndexOf('=')
      if ($i -gt 0) { $opt[$line.Substring(0, $i).Trim()] = $line.Substring($i + 1).Trim() }
    }
    Remove-Item $OptionsFile -Force   # may contain the Razorpay secret
  }

  # ------------------------------------------------------------ Visual C++ runtime
  if (-not ((Test-Path "$env:windir\System32\vcruntime140.dll") -and (Test-Path "$env:windir\System32\vcruntime140_1.dll") -and (Test-Path "$env:windir\System32\msvcp140.dll"))) {
    Say 'Installing Microsoft Visual C++ runtime'
    $p = Start-Process -FilePath (Join-Path $AppDir 'redist\vc_redist.x64.exe') -ArgumentList '/install', '/quiet', '/norestart' -Wait -PassThru
    if ($p.ExitCode -notin 0, 1638, 3010) { throw "VC++ runtime install failed ($($p.ExitCode))" }
  }

  # ------------------------------------------------------------ PostgreSQL cluster
  $newCluster = -not (Test-Path (Join-Path $PgData 'PG_VERSION'))
  if ($newCluster) {
    Say "Creating database cluster in $PgData"
    if (Test-Path $PgData) { Remove-Item -Recurse -Force $PgData }   # leftover from a failed attempt
    New-Item -ItemType Directory -Force $PgData | Out-Null
    $superPw = RandomHex 24
    $pwFile = Join-Path $env:TEMP "crtl-pg-$(RandomHex 6).txt"
    Set-Content -Path $pwFile -Value $superPw -NoNewline -Encoding ascii
    try {
      Run "$PgBin\initdb.exe" @('-D', $PgData, '-U', 'postgres', "--pwfile=$pwFile", '-A', 'scram-sha-256', '-E', 'UTF8', '--no-locale')
    } finally { Remove-Item $pwFile -Force -ErrorAction SilentlyContinue }
    Add-Content (Join-Path $PgData 'postgresql.conf') @"

# ---- CRTL Kiosk ----
port = $PgPort
listen_addresses = 'localhost'
timezone = 'Asia/Kolkata'
logging_collector = on
log_directory = 'log'
log_rotation_age = 7d
log_truncate_on_rotation = on
"@
    # Kept for maintenance only (Administrators/SYSTEM can read it)
    Set-Content (Join-Path $DataRoot 'postgres-superuser.txt') "user=postgres`r`nport=$PgPort`r`npassword=$superPw" -Encoding ascii
  }

  # The DB service runs as NETWORK SERVICE, which needs write access to the cluster
  & icacls $PgData /grant '*S-1-5-20:(OI)(CI)M' /T /Q | Out-Null

  if (-not (Get-Service $DbService -ErrorAction SilentlyContinue)) {
    Say "Registering service $DbService"
    Run "$PgBin\pg_ctl.exe" @('register', '-N', $DbService, '-D', $PgData, '-S', 'auto', '-w')
    & sc.exe description $DbService 'CRTL Canteen Kiosk database (PostgreSQL)' | Out-Null
    & sc.exe failure $DbService reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
  }
  Say "Starting $DbService"
  Start-Service $DbService
  Wait-Until { & "$PgBin\pg_isready.exe" -h localhost -p $PgPort -q; $LASTEXITCODE -eq 0 } 60 'PostgreSQL to accept connections'

  # ------------------------------------------------------------ app database + .env
  if (-not (Test-Path $EnvFile)) {
    if (-not $newCluster) { throw "$EnvFile is missing but a database already exists in $PgData. Restore the .env file (it holds the database password) or move the pgdata folder away to start fresh." }
    Say 'Creating app database'
    $dbPw = RandomHex 24
    $superPw = @((Get-Content (Join-Path $DataRoot 'postgres-superuser.txt')) -match '^password=')[0] -replace '^password=', ''
    $env:PGPASSWORD = $superPw
    # Two separate -c commands: CREATE DATABASE cannot run inside the implicit transaction of a multi-statement string
    Run "$PgBin\psql.exe" @('-h', 'localhost', '-p', "$PgPort", '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q',
      '-c', "CREATE ROLE crtl LOGIN PASSWORD '$dbPw'",
      '-c', "CREATE DATABASE crtl_kiosk OWNER crtl ENCODING 'UTF8' TEMPLATE template0")
    Remove-Item Env:\PGPASSWORD

    $port = [int]$opt.PORT
    $provider = if ($opt.PAYMENT_PROVIDER -eq 'razorpay') { 'razorpay' } else { 'simulated' }
    $hostName = $env:COMPUTERNAME.ToLower()
    Say "Writing $EnvFile"
    $envText = @"
# CRTL Canteen Kiosk settings. Created by the installer on $(Get-Date -Format 'yyyy-MM-dd HH:mm').
# After changing anything here, restart the "CRTL Kiosk Server" service
# (Start menu > CRTL Kiosk > Restart kiosk server).

# ---------- Server ----------
NODE_ENV=production
PORT=$port
# URL other devices use to reach this PC (used for webhook hints and the simulated QR)
PUBLIC_URL=http://${hostName}:$port
SESSION_SECRET=$(RandomHex 32)
# true only when the admin pages are served over HTTPS
COOKIE_SECURE=false
# Optional: comma-separated IPs allowed to open /admin (empty = any)
ADMIN_ALLOWED_IPS=
# One-time token for http://localhost:$port/admin/setup (only works until the first admin exists)
ADMIN_SETUP_TOKEN=$(RandomHex 12)

# ---------- Database (bundled PostgreSQL, service CRTLKioskDB) ----------
DATABASE_URL=postgres://crtl:$dbPw@localhost:$PgPort/crtl_kiosk
PG_DUMP_PATH=$PgBin\pg_dump.exe

# ---------- Payments ----------
# simulated | razorpay   (keep "simulated" until Razorpay has been tested with your account)
PAYMENT_PROVIDER=$provider
SIMULATED_WEBHOOK_SECRET=$(RandomHex 16)
RAZORPAY_KEY_ID=$($opt.RAZORPAY_KEY_ID)
RAZORPAY_KEY_SECRET=$($opt.RAZORPAY_KEY_SECRET)
RAZORPAY_WEBHOOK_SECRET=$($opt.RAZORPAY_WEBHOOK_SECRET)
PAYMENT_QR_TTL_MINUTES=5

# ---------- Storage ----------
DATA_DIR=$DataRoot\data
# Put backups on another disk if you can, e.g. D:\CRTLKioskBackups
BACKUP_DIR=$DataRoot\backups
BACKUP_KEEP_DAYS=30
# Daily backup time (cron, IST)
BACKUP_CRON=30 23 * * *
"@
    Set-Content -Path $EnvFile -Value $envText -Encoding utf8
  } else {
    Say "Keeping existing $EnvFile"
    if (-not (Select-String -Path $EnvFile -Pattern '^PG_DUMP_PATH=' -Quiet)) { Add-Content $EnvFile "PG_DUMP_PATH=$PgBin\pg_dump.exe" }
  }
  # Secrets: only Administrators and SYSTEM may read the settings file
  & icacls $EnvFile /inheritance:r /grant:r '*S-1-5-32-544:F' '*S-1-5-18:F' /Q | Out-Null
  $sup = Join-Path $DataRoot 'postgres-superuser.txt'
  if (Test-Path $sup) { & icacls $sup /inheritance:r /grant:r '*S-1-5-32-544:F' '*S-1-5-18:F' /Q | Out-Null }

  $envMap = @{}
  foreach ($line in Get-Content $EnvFile) { if ($line -match '^\s*([A-Z0-9_]+)=(.*)$') { $envMap[$Matches[1]] = $Matches[2].Trim() } }
  $port = [int]$envMap.PORT

  # Non-secret info for the kiosk launcher (readable by the kiosk user)
  $cfgDir = Join-Path $AppDir 'config'
  New-Item -ItemType Directory -Force $cfgDir | Out-Null
  if (-not (Test-Path "$cfgDir\kiosk-url.txt")) { Set-Content "$cfgDir\kiosk-url.txt" "http://localhost:$port/kiosk" -Encoding ascii }
  Set-Content "$cfgDir\admin-url.txt" "http://localhost:$port/admin" -Encoding ascii

  # ------------------------------------------------------------ app service (WinSW)
  $svcExe = Join-Path $AppDir 'service\CRTLKioskServer.exe'
  $svcXml = Join-Path $AppDir 'service\CRTLKioskServer.xml'
  function X([string]$s) { [Security.SecurityElement]::Escape($s) }
  @"
<service>
  <id>$AppService</id>
  <name>CRTL Kiosk Server</name>
  <description>CRTL Canteen Kiosk web server (kiosk, admin, payments, printing, backups)</description>
  <executable>$(X "$AppDir\node\node.exe")</executable>
  <arguments>"$(X "$AppDir\app\server\dist\index.js")"</arguments>
  <workingdirectory>$(X $DataRoot)</workingdirectory>
  <depend>$DbService</depend>
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="5 sec"/>
  <onfailure action="restart" delay="15 sec"/>
  <onfailure action="restart" delay="60 sec"/>
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>15 sec</stoptimeout>
  <logpath>$(X $Logs)</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
  <env name="NODE_ENV" value="production"/>
</service>
"@ | Set-Content -Path $svcXml -Encoding utf8

  if (-not (Get-Service $AppService -ErrorAction SilentlyContinue)) {
    Say "Registering service $AppService"
    Run $svcExe @('install')
  }
  Say "Starting $AppService"
  Start-Service $AppService
  Wait-Until { (Invoke-RestMethod "http://localhost:$port/api/health" -TimeoutSec 5).ok } 120 'the kiosk server to start'
  Say "Kiosk server is up on port $port"

  # ------------------------------------------------------------ optional extras
  if ($opt.FIREWALL -eq '1') {
    Get-NetFirewallRule -DisplayName 'CRTL Kiosk' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName 'CRTL Kiosk' -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Domain, Private | Out-Null
    Say "Firewall: allowed TCP $port from private/domain networks"
  }
  if ($opt.NOSLEEP -eq '1') {
    & powercfg /change standby-timeout-ac 0
    & powercfg /change monitor-timeout-ac 0
    Say 'Power: sleep and screen-off disabled on AC power'
  }

  if ($ResultFile) {
    $needsSetup = $false
    try { $needsSetup = (Invoke-RestMethod "http://localhost:$port/api/admin/auth/setup/status" -TimeoutSec 5).needsSetup } catch { }
    $lines = @("PORT=$port")
    if ($needsSetup) { $lines += "SETUP_URL=http://localhost:$port/admin/setup#token=$($envMap.ADMIN_SETUP_TOKEN)" }
    Set-Content -Path $ResultFile -Value $lines -Encoding ascii
  }
  Say 'Done'
  Stop-Transcript | Out-Null
  exit 0
} catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host $_.ScriptStackTrace
  Stop-Transcript | Out-Null
  exit 1
}
