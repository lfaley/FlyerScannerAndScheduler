# FlyerSnap deploy helper.
#
#   .\deploy.ps1 75
#
# Finds the zip, extracts it, verifies the version stamp changed, runs the
# tests, and pushes only if everything passes. One command, checked at each
# step, so a half-finished deploy cannot reach GitHub.

param(
  [Parameter(Mandatory=$true)][string]$Version,
  [string]$Message = ""
)

# NOTE: deliberately NOT setting $ErrorActionPreference = "Stop".
# On Windows PowerShell 5.1, redirecting a native command's stderr (2>&1) wraps
# that output in NativeCommandError records, and with Stop in force ANY stderr
# line aborts the script -- even a harmless one. node prints
# "save blocked: data is locked pending recovery" during a PASSING test, which
# killed this script twice. PowerShell 7.1 changed this behaviour; 5.1 did not.
# Every step below checks its own result instead.
$ErrorActionPreference = "Continue"
$repo = "C:\Users\Logan\Desktop\Repos\FlyerSnap"

Write-Host ""
Write-Host "FlyerSnap deploy - v$Version" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# 1. Find the zip. Browsers rename duplicates to "name (1).zip" and sometimes
#    save outside Downloads, which has caused failed deploys before -- so look
#    properly rather than assuming one exact path.
# ---------------------------------------------------------------------------
$zip = $null

$candidates = Get-ChildItem -Path (Join-Path $HOME "Downloads") `
                -Filter "flyersnap-v$Version*.zip" -ErrorAction SilentlyContinue |
              Sort-Object LastWriteTime -Descending

if ($candidates) {
  $zip = $candidates[0]
  if ($candidates.Count -gt 1) {
    Write-Host "!  $($candidates.Count) copies found; using the newest:" -ForegroundColor Yellow
    Write-Host "   $($zip.Name)  ($($zip.LastWriteTime))" -ForegroundColor Yellow
  }
} else {
  Write-Host "   Not in Downloads - searching the rest of your user folder..." -ForegroundColor Yellow
  $zip = Get-ChildItem -Path $HOME -Filter "flyersnap-v$Version*.zip" -Recurse `
           -ErrorAction SilentlyContinue |
         Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

if (-not $zip) {
  Write-Host "X  Could not find flyersnap-v$Version.zip anywhere under $HOME" -ForegroundColor Red
  Write-Host "   The download did not complete. Click the zip link again, then re-run this."
  exit 1
}

Write-Host "OK Found: $($zip.FullName)" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 1b. Self-update. Fixes to this script travel inside the zip, but the copy
#     PowerShell is executing was loaded from disk before extraction -- so a
#     fixed script would not take effect until the NEXT deploy. Pull just
#     deploy.ps1 out first, and if it differs, replace ourselves and re-run.
# ---------------------------------------------------------------------------
$self = $MyInvocation.MyCommand.Path
if (-not $env:FLYERSNAP_DEPLOY_RELAUNCHED) {
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zip.FullName)
    $entry = $archive.Entries | Where-Object { $_.Name -eq "deploy.ps1" } | Select-Object -First 1
    if ($entry) {
      $tmp = Join-Path $env:TEMP "flyersnap-deploy-new.ps1"
      if (Test-Path $tmp) { Remove-Item $tmp -Force }
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $tmp, $true)
      $archive.Dispose()

      $newHash = (Get-FileHash $tmp -Algorithm SHA256).Hash
      $oldHash = if (Test-Path $self) { (Get-FileHash $self -Algorithm SHA256).Hash } else { "" }

      if ($newHash -ne $oldHash) {
        Write-Host "!  deploy.ps1 has been updated - switching to the new one" -ForegroundColor Yellow
        Copy-Item $tmp $self -Force
        Remove-Item $tmp -Force
        $env:FLYERSNAP_DEPLOY_RELAUNCHED = "1"
        & $self @PSBoundParameters
        $code = $LASTEXITCODE
        Remove-Item Env:FLYERSNAP_DEPLOY_RELAUNCHED -ErrorAction SilentlyContinue
        exit $code
      }
      Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    } else {
      $archive.Dispose()
    }
  } catch {
    Write-Host "!  Could not check for a script update ($($_.Exception.Message)) - carrying on" -ForegroundColor Yellow
  }
}

# Refuse a zip that is obviously incomplete rather than extracting garbage.
if ($zip.Length -lt 20000) {
  Write-Host "X  That file is only $($zip.Length) bytes - the download was truncated." -ForegroundColor Red
  Write-Host "   Delete it and download again."
  exit 1
}

# ---------------------------------------------------------------------------
# 2. Extract, remembering the version we had so we can prove it changed.
# ---------------------------------------------------------------------------
Set-Location $repo

$before = ""
if (Test-Path index.html) {
  $m = Select-String -Path index.html -Pattern "FlyerSnap v[0-9.]+" | Select-Object -First 1
  if ($m) { $before = $m.Matches.Value }
}

$watcherBefore = ""
if (Test-Path gmail-watcher.gs) {
  $watcherBefore = (Get-FileHash gmail-watcher.gs -Algorithm SHA256).Hash
}

Expand-Archive -Path $zip.FullName -DestinationPath . -Force
Write-Host "OK Extracted" -ForegroundColor Green

$watcherChanged = $false
if (Test-Path gmail-watcher.gs) {
  $watcherAfter = (Get-FileHash gmail-watcher.gs -Algorithm SHA256).Hash
  $watcherChanged = ($watcherBefore -ne $watcherAfter)
}

$after = (Select-String -Path index.html -Pattern "FlyerSnap v[0-9.]+" |
          Select-Object -First 1).Matches.Value

if ($before -eq $after) {
  Write-Host "!  Version is still $after - the extract may not have changed anything." -ForegroundColor Yellow
  Write-Host "   If you expected v$Version, check you downloaded the right zip." -ForegroundColor Yellow
} else {
  Write-Host "OK $before  ->  $after" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 3. Tests gate the push.
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Running tests..." -ForegroundColor Cyan

# node prints ordinary progress lines to stderr -- notably
# "save blocked: data is locked pending recovery", which is a PASSING test
# proving a locked app refuses to overwrite good data.
#
# On Windows PowerShell 5.1 any stderr REDIRECTION (2>&1 or 2>file) wraps that
# output in NativeCommandError records; combined with a Stop preference, one
# harmless line aborts the whole script. PowerShell 7.1 changed this; 5.1 did
# not. So we do not redirect at all: Start-Process writes each stream straight
# to its own file, which never touches PowerShell's error stream.
$outFile = Join-Path $env:TEMP "flyersnap-tests-out.txt"
$errFile = Join-Path $env:TEMP "flyersnap-tests-err.txt"

$proc = Start-Process -FilePath "node" -ArgumentList "tests.js" `
          -NoNewWindow -Wait -PassThru `
          -RedirectStandardOutput $outFile -RedirectStandardError $errFile
$exit = $proc.ExitCode

$out = @()
if (Test-Path $outFile) { $out += Get-Content $outFile }
if (Test-Path $errFile) { $out += Get-Content $errFile }

$line = $out | Select-String -Pattern "passed, .* failed" | Select-Object -Last 1
$summary = if ($line) { $line.ToString().Trim() } else { "no test summary found" }

if ($exit -ne 0 -and $summary -eq "no test summary found") {
  Write-Host ""
  $out | Select-Object -Last 20
  Write-Host ""
  Write-Host "X  node exited with code $exit and produced no summary." -ForegroundColor Red
  Write-Host "   Nothing was pushed."
  exit 1
}

if ($summary -notmatch "0 failed") {
  Write-Host ""
  $out | Select-String -Pattern "FAIL" -Context 0,2
  Write-Host ""
  Write-Host "X  $summary" -ForegroundColor Red
  Write-Host "   Nothing was pushed."
  exit 1
}
Write-Host "OK $summary" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 4. Commit and push.
# ---------------------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($Message)) { $Message = "deploy $after" }

git add -A
$status = git status --porcelain
if ([string]::IsNullOrWhiteSpace($status)) {
  Write-Host "!  Nothing to commit - the repo already matches this zip." -ForegroundColor Yellow
} else {
  git commit -m $Message | Out-Null
  git push
  Write-Host ""
  Write-Host "OK Pushed. $after will be live in a minute." -ForegroundColor Green
}

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
if ($watcherChanged) {
  Write-Host "  1. gmail-watcher.gs CHANGED - this step is required:" -ForegroundColor Yellow
  Write-Host "     script.google.com > FlyerSnap Watcher > click the code > Ctrl+A > Delete"
  Write-Host "     Paste the new gmail-watcher.gs from this folder, click save,"
  Write-Host "     then Deploy > Manage deployments > pencil > New version > Deploy."
  Write-Host "  2. On your phone: swipe FlyerSnap fully closed, reopen, wait 10s,"
  Write-Host "     then close and reopen once more. Settings should read $after."
} else {
  Write-Host "  gmail-watcher.gs did not change - nothing to do at script.google.com."
  Write-Host "  On your phone: swipe FlyerSnap fully closed, reopen, wait 10s, then"
  Write-Host "  close and reopen once more. Settings should read $after."
}
Write-Host ""
