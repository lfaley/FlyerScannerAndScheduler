# FlyerSnap deploy helper.
# Usage:  .\deploy.ps1 72   ("72" = the version number of the zip you downloaded)
#
# This exists because pasting several commands at once is easy to get wrong --
# a stray prompt or banner in the clipboard produces confusing errors. One
# command, checked at each step, stops on the first real problem.

param(
  [Parameter(Mandatory=$true)][string]$Version,
  [string]$Message = ""
)

$ErrorActionPreference = "Stop"
$repo = "C:\Users\Logan\Desktop\Repos\FlyerAndScheduler\flyersnap-pwa"
$zip  = Join-Path $HOME "Downloads\flyersnap-v$Version.zip"

Write-Host ""
Write-Host "FlyerSnap deploy - v$Version" -ForegroundColor Cyan
Write-Host ""

# 1. Is the download actually there?
if (-not (Test-Path $zip)) {
  Write-Host "X  Cannot find $zip" -ForegroundColor Red
  Write-Host "   The download did not land. Click the zip link again and save it to Downloads."
  $alt = Get-ChildItem -Path $HOME -Filter "flyersnap-v$Version*" -Recurse -ErrorAction SilentlyContinue |
         Select-Object -First 1
  if ($alt) { Write-Host "   Found a copy here instead: $($alt.FullName)" -ForegroundColor Yellow }
  exit 1
}
Write-Host "OK Found the zip" -ForegroundColor Green

# 2. Extract over the repo.
Set-Location $repo
Expand-Archive -Path $zip -DestinationPath . -Force
Write-Host "OK Extracted" -ForegroundColor Green

# 3. Confirm the version stamp really changed.
$stamp = (Select-String -Path index.html -Pattern "FlyerSnap v[0-9.]+" |
          Select-Object -First 1).Matches.Value
Write-Host "OK Version in index.html: $stamp" -ForegroundColor Green

# 4. Tests must pass before anything is pushed.
Write-Host ""
Write-Host "Running tests..." -ForegroundColor Cyan
$out = & node tests.js 2>&1
$summary = ($out | Select-String -Pattern "passed, .* failed" | Select-Object -Last 1).ToString().Trim()
if ($summary -notmatch "0 failed") {
  Write-Host ""
  $out | Select-String -Pattern "FAIL" -Context 0,2
  Write-Host "X  Tests failed: $summary" -ForegroundColor Red
  Write-Host "   Nothing was pushed."
  exit 1
}
Write-Host "OK $summary" -ForegroundColor Green

# 5. Commit and push.
if ([string]::IsNullOrWhiteSpace($Message)) { $Message = "deploy $stamp" }
git add -A
git commit -m $Message | Out-Null
git push
Write-Host ""
Write-Host "OK Pushed. $stamp is live in a minute or so." -ForegroundColor Green
Write-Host "   Next: on your phone, swipe FlyerSnap fully closed, reopen, then close and reopen once more."
Write-Host ""
