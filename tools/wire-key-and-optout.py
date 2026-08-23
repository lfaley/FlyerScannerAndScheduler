#!/usr/bin/env python3
"""v9.29 - FLYERSNAP-FIXES-PLAN Phases 2 and 3.

Three controls, all in Settings spokes rather than the hub, so the
"hub is a menu" test stays green by construction:

  FS-UI-02  Remove key      -- there was no way to delete a stored API key.
  FS-UI-05  First-run nudge -- nothing told a keyless user why scanning fails.
  FS-UI-03  Reporting toggle -- S.settings.errorReportsOff was honoured in code
                               and settable only by hand-editing localStorage.

AMENDMENT APPLIED (from the plan review): all three handlers are registered in
the `mustSurvive` list in tests-modules.js. That list is an ALLOWLIST -- adding
a control does not break it -- which is exactly why a new control that is not
added to it gets no protection from the one test that exists to stop controls
vanishing in a reorganisation.

Note on the nudge, changed from the plan: v9.28 shipped manual event entry, so
a keyless user is no longer stuck. The nudge is now a signpost to a faster path
rather than the only way out, and it says so -- it points at the typing row
below it instead of implying the app is unusable without a key.
"""
import sys

p = 'index.html'
src = open(p).read()
fail = []

def rep(o, n, c=1):
    global src
    got = src.count(o)
    if got != c:
        fail.append(f'expected {c}x {o[:80]!r}, found {got}')
        return
    src = src.replace(o, n)

# ============================================================ FS-UI-02
rep("""    <div class="formrow">
      <input type="password" id="apiKey" aria-label="Anthropic API key" placeholder="sk-ant-...">
      <button class="btn sm" onclick="saveKey()">Save</button>
    </div>""",
"""    <div class="formrow">
      <input type="password" id="apiKey" aria-label="Anthropic API key" placeholder="sk-ant-...">
      <button class="btn sm" onclick="saveKey()">Save</button>
    </div>
    ${S.settings.apiKey ? `<button class="btn alt" style="margin-top:8px;border-color:var(--red-accent);color:var(--red-accent)"
      onclick="removeKey()">${ico('trash')}Remove key from this device</button>` : ''}""")

rep("""function saveKey(){""",
"""/**
 * Delete the stored key. There was no way to do this before v9.29 -- a key
 * could be replaced but never removed, so "I am selling this phone" or "that
 * key leaked" had no answer inside the app.
 *
 * A plain confirm, not the undo-toast pattern the app uses for deletes. Undo
 * works by keeping the deleted thing around long enough to restore it, and the
 * entire point here is that the value stops existing -- an undoable key
 * deletion would be a key that is still on the device.
 *
 * The security action is emptying it out of the PERSISTED blob, which is what
 * save() writes; clearing the input alone would leave the key in localStorage.
 */
function removeKey(){
  if(!S.settings.apiKey) return;
  if(!confirm('Remove the API key from this device?\\n\\nAnthropic features stop working until you paste a new one. This cannot be undone.')) return;
  S.settings.apiKey = '';
  save();
  const box = document.getElementById('apiKey');
  if(box) box.value = '';
  render();
  toast('API key removed from this device');
}

function saveKey(){""")

# ============================================================ FS-UI-05
# Above the source rows, because tapping one of them with no key produces an
# alert -- the explanation has to arrive before the dead end, not after it.
rep("""    <div class="card row" onclick="document.getElementById('fCam').click()">
      ${ico('camera', {cls:'rowicon'})}""",
"""    ${(!S.settings.apiKey && aiProvider() === 'anthropic' && aiEnabled()) ? `
    <div class="card" style="border-left:5px solid var(--amber-accent)">
      <div style="font-weight:700">Reading flyers needs an AI key</div>
      <div class="meta">Every option below sends the page to Claude to be read. Setting a
        key takes about two minutes — or scroll down and type the event in yourself.</div>
      <button class="btn alt" style="margin-top:10px;width:auto" onclick="nav('settings');sub('setAI')">${ico('sparkles')}Set up the key</button>
    </div>` : ''}
    <div class="card row" onclick="document.getElementById('fCam').click()">
      ${ico('camera', {cls:'rowicon'})}""")

# The key help text should make the low-cap workspace the default posture a new
# user lands on, per the plan's Phase 1.
rep("""          : 'FlyerSnap sends your photos to the Claude API to read them. Create a key at console.anthropic.com and paste it here. It is stored only in this phone\\u2019s browser.')}</div>""",
"""          : 'FlyerSnap sends your photos to the Claude API to read them. Create a key at console.anthropic.com and paste it here. It is stored only in this phone\\u2019s browser.')}</div>
    <div class="help" style="margin-top:6px">Recommended: create the key inside its own
      <b>workspace</b> with a low monthly spend limit. The key on a phone can then only ever
      spend up to that cap, and can be revoked without touching anything else.</div>""")

# ============================================================ FS-UI-03
rep("""    <div class="help" style="font-size:12px">Copy pastes straight into any email or
      message, if the share sheet does not offer the app you want.</div>`;""",
"""    <div class="help" style="font-size:12px">Copy pastes straight into any email or
      message, if the share sheet does not offer the app you want.</div>

    <div class="sect">Send error reports</div>
    <div class="card row">
      <div class="grow">
        <div class="title" style="font-size:15px">Send anonymized error reports</div>
        <div class="meta" style="font-size:12px">Diagnostics only — model names, versions and
          error types. Never your events, notes, email contents, or API key.</div>
      </div>
      <input type="checkbox" id="errRep" aria-label="Send anonymized error reports"
        ${S.settings.errorReportsOff ? '' : 'checked'} onchange="setErrorReports(this.checked)">
    </div>
    <div class="help" style="font-size:12px">Reports go to the shared log Logan reads in the
      Admin Console. Turning this off keeps every problem on this phone — the Problem Log and
      the diagnostics file above still work.</div>`;""")

rep("""function mealPlanDiagnostic(){""",
"""/**
 * The opt-out had no control until v9.29: the flag was honoured in two places
 * and set nowhere, so the only way to stop automatic reporting was to edit
 * localStorage by hand.
 *
 * The help text beside it is a STANDARD, not a description -- "never your
 * events, notes, email contents, or API key" is guaranteed by the ruling in
 * ERROR-LOGGING-RULINGS-REPLY.md (every field of an automatic report is
 * diagnostics-only) and enforced by isThirdPartyContent() in js/errorReport.js.
 * Do not soften that wording without changing the standard first.
 *
 * Stored INVERTED (`errorReportsOff`) so that an absent value means reporting
 * is on, which is what every install before v9.24 already assumed.
 */
function setErrorReports(on){
  S.settings.errorReportsOff = !on;
  save();
  toast(on ? 'Error reports on' : 'Error reports off — problems stay on this phone');
}

function mealPlanDiagnostic(){""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
open(p, 'w').write(src)
print('key management + onboarding + opt-out wired')
