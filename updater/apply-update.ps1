# Applies a downloaded Notenpult update after the app has quit, then starts it again.
# Started by updater/index.js (copied next to the download in %TEMP%).
#   -Mode asar  Source = new app.asar        -> replaces resources\app.asar
#   -Mode full  Source = extracted app folder -> mirrors it into the installation
# User data lives in Documents\Notenpult and is never touched.
param(
  [int]$AppPid = 0,
  [ValidateSet('asar', 'full')][string]$Mode,
  [string]$Source,
  [string]$Target,
  [string]$Exe,
  [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'
$log = Join-Path (Split-Path -Parent $PSCommandPath) 'apply-update.log'
function Write-Log([string]$Message) {
  Add-Content -LiteralPath $log -Value ('{0:HH:mm:ss} {1}' -f (Get-Date), $Message)
}

try {
  # Safety first: only ever write into a Notenpult installation.
  if (-not (Test-Path -LiteralPath (Join-Path $Target 'Notenpult.exe'))) {
    throw "Target is not a Notenpult installation: $Target"
  }
  if ($Mode -eq 'full' -and -not (Test-Path -LiteralPath (Join-Path $Source 'Notenpult.exe'))) {
    throw "Source is not a Notenpult build: $Source"
  }
  if ($Mode -eq 'asar' -and -not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "Missing app.asar: $Source"
  }

  if ($AppPid -gt 0) { Wait-Process -Id $AppPid -Timeout 60 -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 800

  $done = $false
  for ($i = 1; $i -le 15 -and -not $done; $i++) {
    try {
      if ($Mode -eq 'asar') {
        Copy-Item -LiteralPath $Source -Destination (Join-Path $Target 'resources\app.asar') -Force
      } else {
        # /IS /IT: copy every file, even if size and time stamp happen to match the old one.
        & robocopy $Source $Target /MIR /IS /IT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy exit code $LASTEXITCODE" }
      }
      $done = $true
      Write-Log "update applied ($Mode)"
    } catch {
      Write-Log "attempt $i failed: $_"
      Start-Sleep -Seconds 1
    }
  }
  if (-not $done) { throw 'could not apply the update' }
} catch {
  Write-Log "ERROR: $_"
}

if (-not $NoRestart -and $Exe -and (Test-Path -LiteralPath $Exe)) {
  try {
    Start-Process -FilePath $Exe -WorkingDirectory (Split-Path -Parent $Exe)
    Write-Log 'restarted'
  } catch {
    Write-Log "restart failed: $_"
  }
}
