#!/usr/bin/env python3
"""deploy.ps1 step 5 stops being "the part no script can do for you".

Logan, 29 Aug: "i thought we automated pushing the watcher code???" We did not.
What was automated was the DETECTION -- deploy.ps1 noticed a real change to
gmail-watcher.gs and refused to continue until you typed y. That is a
checkpoint, not a deployment.

This makes it a deployment, via Google's clasp CLI, with the manual prompt kept
as the fallback for every case where the automated path is not available or does
not work. Nothing gets worse if clasp is not installed.

FOUR THINGS THAT WOULD HAVE BROKEN A NAIVE VERSION, and what is done instead:

1. FILENAME. clasp maps a local file to a script file of the same name, so
   pushing `gmail-watcher.gs` would create a SECOND file beside the project's
   existing `Code.gs` -- every function defined twice. Fixed by staging: the
   file is copied to `Code.gs` inside a scratch folder and pushed from there.

2. THE MANIFEST. `clasp push` sends appsscript.json too. Writing one from
   scratch would overwrite the project's real timezone, runtime and OAuth
   scopes. Fixed by `clasp pull` FIRST, so the live manifest is what gets
   pushed back, byte for byte.

3. THE URL. `clasp deploy` with no arguments creates a NEW deployment with a NEW
   /exec URL, and FlyerSnap would keep calling the old one -- a silent break
   that looks exactly like the watcher having stopped. Fixed by deploying with
   `-i <deploymentId>`, which updates the existing deployment in place and keeps
   the URL. The id is required config, not optional.

4. EXIT CODES. PowerShell 5.1: no `&&`, and $ErrorActionPreference is
   deliberately "Continue" in this script, so every clasp call checks
   $LASTEXITCODE for itself. Any failure falls through to the manual prompt
   rather than letting the push continue on an assumption.

CONFIG: watcher-deploy.json at the repo root, holding scriptId, deploymentId and
webAppUrl. No secrets -- these identify the project; access is your Google login.
Absent, the script behaves exactly as it does today and says how to create it.
"""
import sys

fail = []
buf = {}

def _get(path):
    if path not in buf:
        buf[path] = open(path).read()
    return buf[path]

def rep(path, o, n, c=1):
    src = _get(path)
    got = src.count(o)
    if got != c:
        fail.append(f'{path}: expected {c}x {o[:90]!r}, found {got}')
        return
    buf[path] = src.replace(o, n)

p = 'deploy.ps1'

OLD = """Step 5 "The part no script can do for you"
# ---------------------------------------------------------------------------
# Only prompt when gmail-watcher.gs has a REAL (non-whitespace) change vs HEAD.
# It kept tripping on line-ending (CRLF) noise alone: git lists the file as
# "changed" then, but there is nothing to re-paste at script.google.com.
# --ignore-all-space makes a CRLF-only (or indentation-only) diff count as none,
# so the prompt only appears when the watcher's code actually changed.
$watcherReal = @(git diff --ignore-all-space --name-only HEAD -- gmail-watcher.gs) | Where-Object { $_ }
if ($watcherReal) {
  Warn "gmail-watcher.gs changed - it does NOT deploy with this push."
  Warn "At script.google.com: open the project, select all, paste the new file,"
  Warn "save, then Deploy > Manage deployments > pencil > New version > Deploy."
  Write-Host ""
  $go = Read-Host "    Type y once that is done (anything else stops here)"
  if ($go -ne "y") { Stop-Here "Stopped so the watcher can be updated first." }
} else {
  Ok "gmail-watcher.gs unchanged (or line-endings only) - nothing to re-paste"
}"""

NEW = """Step 5 "The Gmail watcher"
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
    Say "  deploymentId = clasp deployments   (the AKfy... of the ACTIVE one)"
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
  finally { Pop-Location }

  # A green deploy is not proof the web app answers. Ask it.
  if ($cfg.webAppUrl) {
    try {
      $r = Invoke-RestMethod -Uri $cfg.webAppUrl -TimeoutSec 25 -ErrorAction Stop
      if ($r.error -eq "unauthorized") {
        Ok "Watcher deployed and answering (unauthorized without a token, as expected)."
      } elseif ($r.ok) {
        Ok "Watcher deployed and answering."
      } else {
        Warn "Watcher deployed but the reply was unexpected: $($r | ConvertTo-Json -Compress)"
      }
    } catch {
      Warn "Watcher deployed but the URL did not answer: $($_.Exception.Message)"
      Say  "Check it by hand before relying on it."
    }
  }
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
  return $true
}

if ($watcherReal) {
  $done = $false
  if (-not $NoVerify) { $done = Invoke-WatcherAuto }
  if ($done) { Ok "gmail-watcher.gs pushed and redeployed automatically" }
  else { Invoke-WatcherManual }
} else {
  Ok "gmail-watcher.gs unchanged (or line-endings only) - nothing to deploy"
}"""

rep(p, OLD, NEW)

# The header comment at the top of the file describes what each step does.
rep(p, """#   * gmail-watcher.gs changed and nobody re-pasted it at script.google.com""",
    """#   * gmail-watcher.gs changed and nobody deployed it to script.google.com
#     (step 5 now does this with clasp when watcher-deploy.json exists, and
#      falls back to the manual prompt when it does not)""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
for path, text in buf.items():
    open(path, 'w').write(text)
print('watcher deploy automated ->', ', '.join(sorted(buf)))
