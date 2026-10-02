# Applies a downloaded Notenpult update after the app has quit, then starts it again.
# Started by updater/index.js (copied next to the download in %TEMP%).
#   -Mode asar  Source = new app.asar        -> replaces resources\app.asar
#   -Mode full  Source = extracted app folder -> mirrors it into the installation
# If the installation is in a protected folder (e.g. C:\Program Files), the script asks
# Windows for administrator rights (UAC) and starts Notenpult afterwards as normal user.
# Everything goes into apply-update.log next to this script; the app reports errors from
# it after the restart (updater/result.js). ASCII only: Windows PowerShell 5.1 reads this file as ANSI. User data in Documents\Notenpult is never touched.
param(
  [int]$AppPid = 0,
  [ValidateSet('asar', 'full')][string]$Mode,
  [string]$Source,
  [string]$Target,
  [string]$Exe,
  [switch]$NoRestart,
  [switch]$NoElevate,   # tests: never show a UAC prompt
  [switch]$Elevated     # set when the script restarted itself with administrator rights
)

$ErrorActionPreference = 'Stop'
$log = Join-Path (Split-Path -Parent $PSCommandPath) 'apply-update.log'
function Write-Log([string]$Message) {
  Add-Content -LiteralPath $log -Value ('{0:HH:mm:ss} {1}' -f (Get-Date), $Message)
}

function Test-Writable([string]$Dir) {
  $probe = Join-Path $Dir ('.notenpult-write-test-' + [guid]::NewGuid().ToString('N'))
  try {
    [IO.File]::WriteAllText($probe, '')
    Remove-Item -LiteralPath $probe -Force
    return $true
  } catch [UnauthorizedAccessException] {
    return $false
  } catch {
    # "File not found" while creating a file: Windows ransomware protection (controlled folder
    # access) or a virus scanner blocks this program - administrator rights do not help here.
    throw "Windows blockiert das Schreiben in $Target (Ransomware-Schutz / Ueberwachter Ordnerzugriff?): $($_.Exception.Message)"
  }
}

function Start-Notenpult {
  if ($NoRestart -or -not $Exe -or -not (Test-Path -LiteralPath $Exe)) { return }
  try {
    if ($Elevated) {
      # Not as administrator: Explorer starts it as the signed-in user.
      Start-Process -FilePath "$env:SystemRoot\explorer.exe" -ArgumentList ('"{0}"' -f $Exe)
    } else {
      Start-Process -FilePath $Exe -WorkingDirectory (Split-Path -Parent $Exe)
    }
    Write-Log 'restarted'
  } catch {
    Write-Log "restart failed: $_"
  }
}

try {
  if ($Elevated) { Write-Log 'running with administrator rights' }
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

  # Wait until Notenpult has quit - the main process and all its helper processes.
  if ($AppPid -gt 0) { Wait-Process -Id $AppPid -Timeout 60 -ErrorAction SilentlyContinue }
  for ($i = 0; $i -lt 40; $i++) {
    $left = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Exe })
    if ($left.Count -eq 0) { break }
    Start-Sleep -Milliseconds 500
  }
  Start-Sleep -Milliseconds 500

  # Protected folder: ask for administrator rights once and let the elevated copy do the work.
  $resources = Join-Path $Target 'resources'
  if (-not (Test-Writable $resources)) {
    if ($Elevated -or $NoElevate) { throw "Zugriff verweigert: keine Schreibrechte in $Target" }
    Write-Log 'no write access - asking for administrator rights'
    $quote = { param($s) '"{0}"' -f $s }
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', (& $quote $PSCommandPath),
      '-Mode', $Mode, '-Source', (& $quote $Source), '-Target', (& $quote $Target), '-Exe', (& $quote $Exe), '-Elevated')
    if ($NoRestart) { $argList += '-NoRestart' }
    try {
      Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -Verb RunAs -WindowStyle Hidden -ArgumentList $argList
      exit 0
    } catch {
      throw "Administratorrechte wurden nicht erteilt - Notenpult liegt in einem geschuetzten Ordner ($Target)."
    }
  }

  $done = $false
  $lastError = ''
  for ($i = 1; $i -le 20 -and -not $done; $i++) {
    try {
      if ($Mode -eq 'asar') {
        $dest = Join-Path $resources 'app.asar'
        Copy-Item -LiteralPath $Source -Destination $dest -Force
        if ((Get-FileHash -LiteralPath $dest).Hash -ne (Get-FileHash -LiteralPath $Source).Hash) {
          throw 'app.asar differs from the download after copying'
        }
      } else {
        # /IS /IT: copy every file, even if size and time stamp happen to match the old one.
        & robocopy $Source $Target /MIR /IS /IT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy exit code $LASTEXITCODE" }
      }
      $done = $true
      Write-Log "update applied ($Mode)"
    } catch {
      $lastError = "$_"
      Write-Log "attempt $i failed: $_"
      Start-Sleep -Seconds 1
    }
  }
  if (-not $done) { throw "Dateien liessen sich nicht ersetzen: $lastError" }
} catch {
  Write-Log "ERROR: $_"
}

Start-Notenpult
