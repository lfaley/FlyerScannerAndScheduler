#!/usr/bin/env python3
"""v9.62 -> v9.63 - the five fixes the code review said to make first.

Every one is recorded in CODE-REVIEW-FINDINGS.md with the evidence that found
it. Each gets a regression test that fails without the fix (CLAUDE.md rule 24).

  P5-07  applyDedupe destroys BOTH events in a group after another is dismissed
  P4-01  sign-out reports success it never checked
  P2-01  aiFallback:false is persisted for the length of two model calls
  P5-06  "Select all" on the export picker has never worked
  P5-01  unrelated events silently merge as duplicates

Nothing is removed; every control keeps the behaviour it advertises
(CLAUDE.md rule 1).
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
        fail.append(f'{path}: expected {c}x {o[:80]!r}, found {got}')
        return
    buf[path] = src.replace(o, n)

p = 'index.html'

# ===================================================================== P5-07
# dedupeKeep was keyed by the group's POSITION in duplicateGroups(). Dismissing
# a group re-runs that function and every later group shifts down one, while
# dedupeKeep still holds the id chosen for the group that used to be there. If
# that id is in no surviving group, `if(e.id !== keep)` is true for EVERY member
# and applyDedupe deletes the whole group.
#
# The fix is to key by something that survives the list changing shape: the
# group's own member ids, sorted. Same idea as pairKey(), one level up.
rep(p, """function openDedupe(){
  dedupeKeep = {};
  duplicateGroups().forEach((g, i) => { dedupeKeep[i] = bestOfGroup(g).id; });
  sub('dedupe');
}
function setDedupeKeep(i, id){ dedupeKeep[i] = id; render(); }""",
"""/**
 * A group's identity, independent of where it currently sits in the list.
 *
 * dedupeKeep used to be keyed by the group's INDEX. dismissGroup() removes a
 * group and duplicateGroups() is recomputed, so every later group shifts down
 * one -- while dedupeKeep still held the id chosen for whatever used to be at
 * that index. When that id belonged to no surviving group, `e.id !== keep` was
 * true for every member and applyDedupe deleted BOTH events instead of one.
 * Found by the Aug 2026 code review (P5-07).
 */
function dedupeGroupKey(g){ return g.map(e => e.id).sort().join('~'); }

function openDedupe(){
  dedupeKeep = {};
  duplicateGroups().forEach(g => { dedupeKeep[dedupeGroupKey(g)] = bestOfGroup(g).id; });
  sub('dedupe');
}
function setDedupeKeep(key, id){ dedupeKeep[key] = id; render(); }""")

rep(p, """  groups.forEach((g, i) => {
    const keep = dedupeKeep[i];
    if(!keep){""",
"""  groups.forEach(g => {
    const keep = dedupeKeep[dedupeGroupKey(g)];
    // Belt and braces: even with a stable key, an id that is not in THIS group
    // must never be treated as "keep this one" -- that is the shape that
    // deleted both events.
    if(!keep || !g.some(e => e.id === keep)){""")

rep(p, """      const on = dedupeKeep[i] === e.id;""",
    """      const on = dedupeKeep[dedupeGroupKey(g)] === e.id;""")
rep(p, """onclick="setDedupeKeep(${i}, '${e.id}')">""",
    """onclick="setDedupeKeep('${dedupeGroupKey(g)}', '${e.id}')">""")
rep(p, """onclick="setDedupeKeep(${i}, null)">${dedupeKeep[i] ? 'Keep both' : '✓ Keeping both'}</button>""",
    """onclick="setDedupeKeep('${dedupeGroupKey(g)}', null)">${dedupeKeep[dedupeGroupKey(g)] ? 'Keep both' : '✓ Keeping both'}</button>""")
rep(p, """  const removing = groups.reduce((n, g, i) => n + (dedupeKeep[i] ? g.length - 1 : 0), 0);""",
    """  const removing = groups.reduce((n, g) => n + (dedupeKeep[dedupeGroupKey(g)] ? g.length - 1 : 0), 0);""")

# ===================================================================== P4-01
# clearGordonSession() swallowed any error and gordonSignOutUI() then said
# "Signed out of Gordon" regardless. If removeItem throws -- private mode,
# storage access denied -- the user is told they are signed out while the
# Firebase ID token is still on the device. The app was asserting a security
# outcome it had not checked.
rep(p, """function clearGordonSession(){ try{ localStorage.removeItem(GORDON_SESSION_KEY); }catch(e){} }""",
"""/**
 * Remove the stored Gordon session. Returns TRUE only if the key is really gone.
 *
 * The old version swallowed the error and the caller announced success anyway.
 * A sign-out that fails silently leaves the ID token on the device while the
 * user is told it is gone -- the one place in the app that claimed a security
 * outcome without checking it (code review P4-01).
 */
function clearGordonSession(){
  try{
    localStorage.removeItem(GORDON_SESSION_KEY);
    return localStorage.getItem(GORDON_SESSION_KEY) === null;
  }catch(e){ return false; }
}""")

rep(p, """function gordonSignOutUI(){
  clearGordonSession();
  toast('Signed out of Gordon');
  sub('setAI');
}""",
"""function gordonSignOutUI(){
  const gone = clearGordonSession();
  if(gone){
    toast('Signed out of Gordon');
  }else{
    // Say what is actually true. Storage refused the write, so the token is
    // still here and the user needs to know that rather than be reassured.
    logProblem('Gordon', 'Sign-out could not clear the saved session',
      'storage refused the write; the token is still on this device');
    alert('Could not sign out.\\n\\nThis phone\\u2019s browser refused to clear the saved session, so you are still signed in. Try again, or clear this site\\u2019s data in Settings.');
  }
  sub('setAI');
}""")

# ===================================================================== P2-01
# compareProviders captured aiProvider/aiFallback, MUTATED THE SAVED SETTINGS
# for the length of two model calls, and restored them in a finally. Because
# recordAiCall() ends with save(), those temporary values reached localStorage:
# reproduced by tools/p2-repro-compare-provider.js. Kill the PWA in that window
# -- iOS does it to backgrounded apps routinely -- and the user is left with the
# Anthropic fallback switched OFF, silently.
#
# The fix is to stop touching saved settings at all. aiProvider() is a single
# read point; aiFallbackOn() becomes one for the fallback. The comparison sets
# an override that lives only in memory, so a finally that never runs leaves
# nothing wrong on disk.
rep(p, """function aiProvider(){ return S.settings.aiProvider === 'local' ? 'local' : 'anthropic'; }""",
"""/**
 * A provider forced for the current operation, or null. In memory ONLY -- never
 * saved, so nothing it does can outlive the call that set it.
 *
 * Before v9.63, compareProviders() forced a provider by writing S.settings and
 * restoring it in a finally. recordAiCall() saves on every AI call, so those
 * temporary values were persisted for the whole comparison; if the app died in
 * that window the finally never ran and the user kept an aiFallback of false
 * with nothing on screen saying so (code review P2-01, reproduced).
 */
let aiOverride = null;
function aiProvider(){
  if(aiOverride && aiOverride.provider) return aiOverride.provider;
  return S.settings.aiProvider === 'local' ? 'local' : 'anthropic';
}
// The single read point for "may this call fall back?", so an override has one
// place to apply and the four scattered reads become one.
function aiFallbackOn(){
  if(aiOverride && aiOverride.fallback !== undefined) return aiOverride.fallback;
  return !!S.settings.aiFallback;
}""")

rep(p, """  const original = S.settings.aiProvider;
  const originalFallback = S.settings.aiFallback;
  compareResult = { name: file.name || 'image', anthropic:null, local:null,
                    anthropicErr:null, localErr:null };""",
"""  compareResult = { name: file.name || 'image', anthropic:null, local:null,
                    anthropicErr:null, localErr:null };""")

rep(p, """    S.settings.aiFallback = false;   // never let one provider answer for the other""",
"""    // In memory only. Nothing here is saved, so an app that dies mid-comparison
    // leaves the user's real settings exactly as they were.
    aiOverride = { provider:null, fallback:false };   // never let one provider answer for the other""")

rep(p, """      S.settings.aiProvider = 'anthropic';""", """      aiOverride.provider = 'anthropic';""")
rep(p, """      S.settings.aiProvider = 'local';""", """      aiOverride.provider = 'local';""")

rep(p, """  }finally{
    S.settings.aiProvider = original;
    S.settings.aiFallback = originalFallback;
    save();
  }
  sub('compare');""",
"""  }finally{
    // Dropping the override IS the restore. There is nothing to put back,
    // because nothing was taken.
    aiOverride = null;
  }
  sub('compare');""")

# The two fallback reads inside the call path go through the new accessor.
rep(p, """      if(needAuth && !S.settings.aiFallback){""", """      if(needAuth && !aiFallbackOn()){""")
rep(p, """      if(S.settings.aiFallback){""", """      if(aiFallbackOn()){""")

# ===================================================================== P5-06
# JSON.stringify emits double quotes, and the attribute is double-quoted, so the
# browser truncated the handler at the first inner quote. "Select all" / "Clear
# all" on the export picker has never worked.
rep(p, """onclick="toggleAllExportPick(${JSON.stringify(evts.map(e=>e.id))})""",
    """onclick="toggleAllExportPick()""")

# ...and the handler derives the ids itself, from the same source the screen
# renders from, so there is nothing to serialise into an attribute at all.
rep(p, """function toggleAllExportPick(ids){
  exportPick = (exportPick.size === ids.length) ? new Set() : new Set(ids);
  renderPickExport(document.getElementById('main'));
}""",
"""function toggleAllExportPick(){
  // The ids used to be serialised into the onclick attribute with
  // JSON.stringify -- which emits double quotes, inside a double-quoted
  // attribute, so the browser truncated the handler and the control never
  // worked at all (code review P5-06). Read them from the same place the
  // screen does instead.
  const ids = exportCandidates().map(e => e.id);
  exportPick = (exportPick.size === ids.length) ? new Set() : new Set(ids);
  renderPickExport(document.getElementById('main'));
}""")

# One definition of "which events can be exported", used by the screen and by
# its own Select-all handler. Two copies of that filter is how they drift.
rep(p, """function renderPickExport(m){
  setHeader('Choose Events', true);
  const evts = S.events.filter(e=>!e.deleted && e.date>=todayISO())
    .sort((a,b)=> a.date===b.date ? String(a.time||'99').localeCompare(String(b.time||'99')) : a.date.localeCompare(b.date));""",
"""function exportCandidates(){
  return S.events.filter(e=>!e.deleted && e.date>=todayISO())
    .sort((a,b)=> a.date===b.date ? String(a.time||'99').localeCompare(String(b.time||'99')) : a.date.localeCompare(b.date));
}
function renderPickExport(m){
  setHeader('Choose Events', true);
  const evts = exportCandidates();""")

# ===================================================================== P5-01
# titleSimilarity counted A as a MULTISET while dividing by the shorter title's
# length, so one repeated word could reach 1.0. Verified: "Grade 3 and Grade 4
# and Grade 5 Swim" vs "Grade 6 Trip" on the same day scored as duplicates.
rep(p, """  const A = normTitle(a).split(' ').filter(Boolean);
  const B = normTitle(b).split(' ').filter(Boolean);""",
"""  // Compare SETS, not multisets. Counting repeats on the A side while dividing
  // by the shorter title's word count let one repeated word drive the score to
  // 1.0: "Grade 3 and Grade 4 and Grade 5 Swim" vs "Grade 6 Trip" on the same
  // day scored as duplicates. Verified against looksDuplicate before and after
  // (code review P5-01).
  const A = [...new Set(normTitle(a).split(' ').filter(Boolean))];
  const B = [...new Set(normTitle(b).split(' ').filter(Boolean))];""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
for path, text in buf.items():
    open(path, 'w').write(text)
print('review fixes wired ->', ', '.join(sorted(buf)))
