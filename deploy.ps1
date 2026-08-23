# FlyerSnap deploy.
#
#   .\deploy.ps1 "what changed"
#   .\deploy.ps1 "what changed" -DryRun     # check everything, push nothing
#
# Files now arrive one at a time and get dropped straight into the repo folder,
# so there is no zip to find or extract. Save the files, then run this.
#
# It checks the things that have actually gone wrong on this project, and
# pushes only if every one of them passes:
#
#   * the tests do not end "N passed, 0 failed"
#   * index.html changed but APP_VERSION did not   <- installed phones would
#   * APP_VERSION moved but sw.js CACHE did not    <- keep the old app forever
#   * a changed file is OLDER than the last commit  <- another session wrote
#     it against a different base; committing it reverts what that commit added
#   * gmail-watcher.gs changed and nobody re-pasted it at script.google.com
#   * the push succeeded but the live site never picked it up
#
# v9.25 rewrite. The previous version hunted for a zip in Downloads and
# extracted it into FlyerAndScheduler\flyersnap-pwa -- a path that has not
# existed since the repo moved, so it could not have worked.

param(
  [Parameter(Position=0)][string]$Message = "",
  [string]$Repo = "C:\Users\Logan\Desktop\Repos\FlyerSnap",
  [switch]$DryRun,
  [switch]$NoVerify
)

# NOT "Stop". On Windows PowerShell 5.1, a native command writing ANY line to
# stderr becomes a terminating error under Stop -- node prints
# "save blocked: data is locked pending recovery" during a PASSING test run,
# and that alone killed the old script twice. Every step checks its own result.
$ErrorActionPreference = "Continue"

$LIVE    = "https://lfaley.github.io/FlyerScannerAndScheduler/"
$ACTIONS = "https://github.com/lfaley/FlyerScannerAndScheduler/actions"

function Ok   ($t) { Write-Host "OK  $t" -ForegroundColor Green }
function Warn ($t) { Write-Host "!   $t" -ForegroundColor Yellow }
function Bad  ($t) { Write-Host "X   $t" -ForegroundColor Red }
function Say  ($t) { Write-Host "    $t" }
function Step ($n, $t) { Write-Host ""; Write-Host "$n. $t" -ForegroundColor Cyan }

function Stop-Here ($why) {
  Write-Host ""
  Bad $why
  Bad "Nothing was committed and nothing was pushed."
  Write-Host ""
  exit 1
}

# Pull one captured group out of some text. Returns $null when the pattern is
# absent, so a renamed constant fails loudly instead of quietly comparing two
# empty strings and calling them equal.
function Get-Match ($text, $pattern) {
  $m = [regex]::Match($text, $pattern)
  if ($m.Success) { return $m.Groups[1].Value }
  return $null
}

Write-Host ""
Write-Host "FlyerSnap deploy" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
Step 1 "Repo"
# ---------------------------------------------------------------------------
if (-not (Test-Path $Repo)) { Stop-Here "No folder at $Repo. Pass -Repo <path>." }
Set-Location $Repo

git rev-parse --is-inside-work-tree | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-Here "$Repo is not a git repository." }

$branch = (git rev-parse --abbrev-ref HEAD)
if ($branch) { $branch = $branch.Trim() }
Ok "$Repo  (branch: $branch)"
if ($branch -ne "main") { Warn "Pages deploys from main. This branch will not go live." }

$tracked   = @(git diff --name-only HEAD)
$untracked = @(git ls-files --others --exclude-standard)
$all = @(@($tracked) + @($untracked) | Where-Object { $_ })

if ($all.Count -eq 0) {
  Write-Host ""
  Ok "Nothing has changed. Already up to date."
  Write-Host ""
  exit 0
}

Say "$($all.Count) file(s) changed:"
foreach ($f in $all) { Say "  $f" }

# ---------------------------------------------------------------------------
Step 2 "Version stamps"
# ---------------------------------------------------------------------------
# The rule (CLAUDE.md): bump BOTH the version in index.html and CACHE in sw.js
# with every release. Miss the CACHE bump and every installed phone keeps
# serving the old app, with no error anywhere -- the most expensive mistake
# available here, and the easiest one to make.
$version = ""

if ($all -notcontains "index.html") {
  Ok "index.html unchanged - no version bump needed"
} else {
  $nowHtml = Get-Content index.html -Raw
  $nowSw   = Get-Content sw.js -Raw
  $wasHtml = (git show HEAD:index.html) -join "`n"
  $wasSw   = (git show HEAD:sw.js) -join "`n"

  $vNow = Get-Match $nowHtml "APP_VERSION\s*=\s*'([^']+)'"
  $vWas = Get-Match $wasHtml "APP_VERSION\s*=\s*'([^']+)'"
  $cNow = Get-Match $nowSw   "CACHE\s*=\s*'([^']+)'"
  $cWas = Get-Match $wasSw   "CACHE\s*=\s*'([^']+)'"

  if (-not $vNow) { Stop-Here "Could not find APP_VERSION in index.html." }
  if (-not $cNow) { Stop-Here "Could not find CACHE in sw.js." }

  if ($vNow -eq $vWas) { Stop-Here "index.html changed but APP_VERSION is still $vNow. Bump it." }
  Ok "APP_VERSION  $vWas -> $vNow"

  if ($cNow -eq $cWas) {
    Stop-Here "APP_VERSION moved to $vNow but sw.js CACHE is still $cNow. Installed phones would keep the old app."
  }
  Ok "sw.js CACHE  $cWas -> $cNow"
  $version = $vNow
}

# ---------------------------------------------------------------------------
Step 3 "Is this build newer than the last commit?"
# ---------------------------------------------------------------------------
# 23 Aug 2026: two agent sessions wrote to this folder within minutes of each
# other. Each had its own working copy, neither could see the other's, and each
# overwrote index.html with a build made from its own base. The deploy passed at
# 529 tests, then failed at 486 with three drift errors and no edit in between,
# because the files underneath had changed. Two commits both called themselves
# v9.25.
#
# The tests catch the RESULT (a js/ file present but not inlined). This catches
# the CAUSE, earlier and by name: a file you are about to commit whose contents
# are older than the commit you are committing on top of was written against a
# different base, and almost certainly does not contain what is already in HEAD.
$headTime = git log -1 --format=%cI
if ($headTime) {
  $headStamp = [datetime]::Parse($headTime).ToUniversalTime()
  $stale = @()
  foreach ($f in $all) {
    if (-not (Test-Path $f)) { continue }        # a deletion has no mtime
    $m = (Get-Item $f).LastWriteTimeUtc
    if ($m -lt $headStamp) { $stale += ("{0}  (written {1}, HEAD is {2})" -f $f, $m.ToString("HH:mm:ss"), $headStamp.ToString("HH:mm:ss")) }
  }
  if ($stale.Count) {
    Write-Host ""
    Bad "These files are OLDER than the last commit:"
    foreach ($x in $stale) { Bad "  $x" }
    Write-Host ""
    Warn "Something committed after these were written -- another agent session,"
    Warn "another window, or a git operation. Committing them would silently"
    Warn "revert whatever that commit added."
    Warn ""
    Warn "Do NOT just re-run. Merge at the js/ layer and re-inline index.html:"
    Warn "  git log --oneline -3"
    Warn "  git diff HEAD -- <file>"
    Stop-Here "Stale build refused."
  }
  Ok "every changed file is newer than $(git log -1 --format=%h) ($($headStamp.ToString('HH:mm:ss')) UTC)"
}

# ---------------------------------------------------------------------------
Step 4 "Tests"
# ---------------------------------------------------------------------------
Say "node tests.js"

# Start-Process with per-stream files, NOT "2>&1". On 5.1 any stderr
# REDIRECTION wraps output in NativeCommandError records; Start-Process writes
# each stream straight to its own file and never touches PowerShell's error
# stream. This was debugged the hard way -- do not simplify it.
$tmp = $env:TEMP
if (-not $tmp) { $tmp = [System.IO.Path]::GetTempPath() }
$outFile = Join-Path $tmp "flyersnap-tests-out.txt"
$errFile = Join-Path $tmp "flyersnap-tests-err.txt"

$proc = Start-Process -FilePath "node" -ArgumentList "tests.js" `
          -NoNewWindow -Wait -PassThru `
          -RedirectStandardOutput $outFile -RedirectStandardError $errFile
$exit = $proc.ExitCode

$out = @()
if (Test-Path $outFile) { $out += Get-Content $outFile }
if (Test-Path $errFile) { $out += Get-Content $errFile }

$line = $out | Select-String -Pattern "^\d+ passed, \d+ failed$" | Select-Object -Last 1

# Belt and braces. The exit code and the printed summary must AGREE: a runner
# that dies before printing the summary must not pass, and a summary with
# failures in it must lose even if the exit code says zero.
if (-not $line) {
  Write-Host ""
  $out | Select-Object -Last 20
  Stop-Here "The tests printed no summary line - the run did not finish (node exited $exit)."
}
$summary = $line.ToString().Trim()

if ($summary -notmatch ", 0 failed$") {
  Write-Host ""
  $out | Select-String -Pattern "FAIL" | Select-Object -First 15
  Stop-Here $summary
}
if ($exit -ne 0) { Stop-Here "Tests printed '$summary' but node exited $exit." }
Ok $summary

# ---------------------------------------------------------------------------
Step 5 "The part no script can do for you"
# ---------------------------------------------------------------------------
if ($all -contains "gmail-watcher.gs") {
  Warn "gmail-watcher.gs changed - it does NOT deploy with this push."
  Warn "At script.google.com: open the project, select all, paste the new file,"
  Warn "save, then Deploy > Manage deployments > pencil > New version > Deploy."
  Write-Host ""
  $go = Read-Host "    Type y once that is done (anything else stops here)"
  if ($go -ne "y") { Stop-Here "Stopped so the watcher can be updated first." }
} else {
  Ok "gmail-watcher.gs unchanged - nothing to re-paste at script.google.com"
}

# ---------------------------------------------------------------------------
Step 6 "Commit and push"
# ---------------------------------------------------------------------------
if (-not $Message) {
  if ($version) { $Message = $version } else { $Message = "update" }
}

if ($DryRun) {
  Write-Host ""
  Warn "-DryRun: every check above passed. Nothing was committed or pushed."
  Say "Would commit as: $Message"
  Write-Host ""
  exit 0
}

# -A stages deletions as well. A file removed from the folder must leave the
# repo too, or a deleted module keeps shipping from the last commit.
git add -A
if ($LASTEXITCODE -ne 0) { Stop-Here "git add failed." }

git commit -m $Message | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-Here "git commit failed." }

$sha = (git rev-parse --short HEAD)
if ($sha) { $sha = $sha.Trim() }
Ok "committed $sha - $Message"

git push
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Bad "git push failed. The commit is local - fix the remote and push again."
  Write-Host ""
  exit 1
}
Ok "pushed to $branch"

# ---------------------------------------------------------------------------
Step 7 "Did it actually go live?"
# ---------------------------------------------------------------------------
# A green push is not a deploy. Pages builds afterwards and can lag or fail;
# without this, the first sign of trouble is the phone quietly showing the old
# app -- which is exactly the failure this project keeps hitting.
if ($NoVerify) { Write-Host ""; Warn "-NoVerify: skipping the live check."; Write-Host ""; exit 0 }
if (-not $version) { Write-Host ""; Ok "index.html unchanged - nothing to verify live."; Write-Host ""; exit 0 }

# curl.exe, not Invoke-WebRequest: on 5.1, IWR without -UseBasicParsing uses
# Internet Explorer's engine and raises a security prompt on a fresh machine.
$curl = "curl.exe"
if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { $curl = "curl" }

Say "Waiting for GitHub Pages (up to 3 minutes)..."
$found = $false
for ($i = 1; $i -le 18; $i++) {
  Start-Sleep -Seconds 10
  # Cache-bust: Pages sits behind a CDN that would happily serve the old copy
  # and make a good deploy look broken.
  $bust = [guid]::NewGuid().ToString("N")
  $body = & $curl -s "$LIVE`?deploycheck=$bust"
  $body = $body -join "`n"
  if ($body -match [regex]::Escape("APP_VERSION = '$version'")) { $found = $true; break }
  Say "  still the old build ($($i * 10)s)"
}

Write-Host ""
if ($found) {
  Ok "$version is live at $LIVE"
  Write-Host ""
  Say "On the phone: open FlyerSnap, close it fully, open it again."
  Say "Since v9.20 the worker paints from cache first, so a new build lands on"
  Say "the NEXT launch - or take the reload it offers you."
} else {
  Warn "$version has not appeared after 3 minutes."
  Warn "The push worked; the Pages build may still be running, or may have failed."
  Warn "Check $ACTIONS"
}
Write-Host ""
