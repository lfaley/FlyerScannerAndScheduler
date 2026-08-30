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
#   * gmail-watcher.gs changed and nobody deployed it to script.google.com
#     (step 5 now does this with clasp when watcher-deploy.json exists, and
#      falls back to the manual prompt when it does not)
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
    # -Force, because Get-Item WITHOUT it silently skips hidden and system
    # files while Test-Path above happily finds them. Visual Studio's
    # .vs\...\.wsuo is hidden, so this threw ItemNotFound and then called a
    # method on the null it left behind (Logan, 29 Aug). SilentlyContinue plus
    # the null check means an unreadable file is skipped, not fatal: this gate
    # exists to catch a stale BUILD, and a file it cannot stat is not evidence
    # of one.
    $item = Get-Item -Force -LiteralPath $f -ErrorAction SilentlyContinue
    if (-not $item) { continue }
    $m = $item.LastWriteTimeUtc
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
Step 5 "The Gmail watcher"
# ---------------------------------------------------------------------------
# gmail-watcher.gs does NOT ship with this push -- it lives in an Apps Script
# project at script.google.com. Until now this step could only NOTICE that and
# stop; it now deploys the file itself when clasp is set up, and falls back to
# the old prompt when it is not.
#
# Only act when the file has a REAL (non-whitespace) change vs HEAD. It kept
# tripping on line-ending (CRLF) noise alone: git lists the file as "changed"
# then, but there is nothing to deploy. --ignore-all-space makes a CRLF-only
# (or indentation-only) diff count as none.
$watcherReal = @(git diff --ignore-all-space --name-only HEAD -- gmail-watcher.gs) | Where-Object { $_ }

function Invoke-WatcherManual {
  Warn "gmail-watcher.gs changed - it does NOT deploy with this push."
  Warn "At script.google.com: open the project, select all, paste the new file,"
  Warn "save, then Deploy > Manage deployments > pencil > New version > Deploy."
  Write-Host ""
  $go = Read-Host "    Type y once that is done (anything else stops here)"
  if ($go -ne "y") { Stop-Here "Stopped so the watcher can be updated first." }
}

# Returns $true only if the watcher was really pushed AND redeployed.
function Invoke-WatcherAuto {
  $cfgPath = Join-Path $Repo "watcher-deploy.json"
  if (-not (Test-Path $cfgPath)) {
    Say "No watcher-deploy.json - using the manual step."
    Say "To automate: npm i -g @google/clasp; clasp login; then create"
    Say "watcher-deploy.json with scriptId, deploymentId and webAppUrl."
    Say "  scriptId     = script.google.com > Project Settings > IDs"
    Say "  deploymentId = script.google.com > Deploy > Manage deployments >"
    Say "                 click the ACTIVE web app > the Deployment ID shown there"
    Say "                 (NOT 'clasp deployments' - that needs a .clasp.json first)"
    return $false
  }

  $clasp = Get-Command clasp -ErrorAction SilentlyContinue
  if (-not $clasp) {
    Warn "watcher-deploy.json exists but clasp is not on PATH (npm i -g @google/clasp)."
    return $false
  }

  try { $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json }
  catch { Warn "watcher-deploy.json is not valid JSON."; return $false }

  if (-not $cfg.scriptId -or -not $cfg.deploymentId) {
    Warn "watcher-deploy.json needs both scriptId and deploymentId."
    Say  "Without deploymentId, clasp deploy would mint a NEW /exec URL and the"
    Say  "app would keep calling the old one - a silent break. Refusing."
    return $false
  }

  # A scratch folder, rebuilt every run. clasp pushes a DIRECTORY, and it maps
  # local filenames onto script filenames -- so the file has to arrive as
  # Code.gs, or the project ends up with gmail-watcher.gs beside Code.gs and
  # every function defined twice.
  $stage = Join-Path $Repo ".clasp-stage"
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  New-Item -ItemType Directory -Path $stage | Out-Null
  # rootDir "." keeps clasp inside the scratch folder and away from the repo.
  '{"scriptId":"' + $cfg.scriptId + '","rootDir":"."}' | Set-Content (Join-Path $stage ".clasp.json") -Encoding ascii

  Push-Location $stage
  try {
    # PULL FIRST. push sends appsscript.json as well, and a manifest written
    # from scratch would overwrite the project's real timezone, runtime and
    # OAuth scopes. Pulling means the manifest we push back is the live one.
    Say "clasp pull (fetching the live manifest)..."
    clasp pull 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Warn "clasp pull failed (not logged in? Apps Script API off?)."
      Say  "Enable it at script.google.com/home/usersettings, then: clasp login"
      return $false
    }
    if (-not (Test-Path (Join-Path $stage "appsscript.json"))) {
      Warn "clasp pull returned no appsscript.json - refusing to push a manifest we did not read."
      return $false
    }

    Copy-Item (Join-Path $Repo "gmail-watcher.gs") (Join-Path $stage "Code.gs") -Force

    Say "clasp push..."
    clasp push -f 2>&1 | ForEach-Object { Say $_ }
    if ($LASTEXITCODE -ne 0) { Warn "clasp push failed."; return $false }

    # -i updates the EXISTING deployment, so the /exec URL the app calls does
    # not change. Without it clasp mints a new one and the app breaks silently.
    $desc = "FlyerSnap $version"
    Say "clasp deploy -i $($cfg.deploymentId)..."
    clasp deploy -i $cfg.deploymentId -d $desc 2>&1 | ForEach-Object { Say $_ }
    if ($LASTEXITCODE -ne 0) { Warn "clasp deploy failed - the code is pushed but NOT live."; return $false }
  }
  finally {
    Pop-Location
    # ALWAYS, not only on success. A failed deploy used to leave .clasp-stage in
    # the repo, and step 6's `git add -A` would then commit a scratch folder
    # holding a .clasp.json with the script id. Found by running the failure
    # paths rather than reading them.
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
  }

  # A green deploy is not proof the web app answers. Ask it.
  #
  # curl.exe, not Invoke-RestMethod, for the reason this script already gives
  # further down: on PowerShell 5.1 the built-in web cmdlets lean on Internet
  # Explorer's engine and raise a security prompt on a fresh machine. -L because
  # an /exec URL redirects to googleusercontent before it answers.
  if ($cfg.webAppUrl) {
    $c = "curl.exe"
    if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { $c = "curl" }
    $reply = (& $c -sL --max-time 25 $cfg.webAppUrl) -join "`n"
    if ($LASTEXITCODE -ne 0 -or -not $reply) {
      Warn "Watcher deployed but the URL did not answer. Check it by hand before relying on it."
    } elseif ($reply -match '"error"\s*:\s*"unauthorized"') {
      # No token on this request, so "unauthorized" is the CORRECT answer and
      # proves the new code is live and running doGet.
      Ok "Watcher deployed and answering (unauthorized without a token, as expected)."
    } elseif ($reply -match '"ok"\s*:\s*true') {
      Ok "Watcher deployed and answering."
    } else {
      Warn "Watcher deployed but the reply was unexpected:"
      Say  $reply.Substring(0, [Math]::Min(200, $reply.Length))
    }
  }
  return $true
}

if ($watcherReal) {
  $done = $false
  if (-not $NoVerify) { $done = Invoke-WatcherAuto }
  if ($done) { Ok "gmail-watcher.gs pushed and redeployed automatically" }
  else { Invoke-WatcherManual }
} else {
  Ok "gmail-watcher.gs unchanged (or line-endings only) - nothing to deploy"
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
