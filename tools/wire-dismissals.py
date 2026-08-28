#!/usr/bin/env python3
"""v9.66 - dismissing a warning stops being a one-way door.

Closes three findings from the Aug 2026 code review at once:

  P6-01  settings.dismissedConflicts -- written once, read twice, NEVER cleared.
         No undo, no listing, no way back. A single tap on an unlabelled x
         silenced that pair of events permanently.
  P6-02  settings.notDuplicates -- identical shape, via "Not duplicates".
  P7-01  dismissConflict() was reached from a bare x and from a big green
         "Keep both - this is fine". Same function, same permanent outcome, two
         names, neither of them the word "dismiss". That is the question Logan
         actually asked on 26 Aug.

THE STANDARD BEING APPLIED, and where it comes from

P6 established it from a case the app already gets right: settings.seenMsgs has
the same SHAPE as these two -- a list that grows and suppresses things -- and is
not a defect, because forgetImportedEmails() empties it and the button shows the
count. So:

    suppression is fine; suppression with no way back is the bug.

Three things every suppression now has:
  * an UNDO, immediately after the tap  (NN/g: user control and freedom)
  * a LISTING, so you can see what you silenced
  * a CLEAR, so a mis-tap is not forever

WHAT IS NOT CHANGED

Both existing controls keep working and keep their wording. "Keep both - this
is fine" still dismisses; the x still dismisses. Nothing is removed
(CLAUDE.md rule 1) -- the x simply gains the visible word it never had, and both
now offer a way back.
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

# ============================================================ 1. undo the dismiss
rep(p, """function dismissConflict(key){
  const list = S.settings.dismissedConflicts || (S.settings.dismissedConflicts = []);
  if(!list.includes(key)) list.push(key);
  save(); render();
}""",
"""/**
 * Silence one clash warning -- reversibly.
 *
 * Until v9.66 this pushed a key and that was that: no undo, no screen listing
 * what had been silenced, and nothing anywhere that could clear it. One tap on
 * an unlabelled x hid that pair of events for good (code review P6-01).
 */
function dismissConflict(key){
  const list = S.settings.dismissedConflicts || (S.settings.dismissedConflicts = []);
  if(list.includes(key)) return;                 // already silenced; nothing to undo
  list.push(key);
  save(); render();
  toast('Warning dismissed', { label:'Undo', fn:() => {
    restoreDismissedConflict(key);
    toast('Warning back');
  }});
}
function restoreDismissedConflict(key){
  S.settings.dismissedConflicts = (S.settings.dismissedConflicts || []).filter(k => k !== key);
  save(); render();
}
function clearDismissedConflicts(){
  const before = (S.settings.dismissedConflicts || []).slice();
  if(!before.length) return;
  S.settings.dismissedConflicts = [];
  save(); render();
  toast('Brought back ' + before.length + ' warning' + (before.length === 1 ? '' : 's'),
    { label:'Undo', fn:() => { S.settings.dismissedConflicts = before; save(); render(); } });
}""")

# ============================================================ 2. undo "not duplicates"
rep(p, """  save();
  toast('Marked as different events');
  if(!duplicateGroups().length){ view = { tab:'events', sub:null, data:null }; }
  render();""",
"""  save();
  // Reversible, like every other suppression as of v9.66 (code review P6-02).
  // `added` is only the keys THIS tap contributed, so an undo cannot remove a
  // decision made earlier about a different pair.
  toast('Marked as different events', { label:'Undo', fn:() => {
    S.settings.notDuplicates = (S.settings.notDuplicates || []).filter(k => !added.includes(k));
    save(); render();
    toast('Back in the duplicates list');
  }});
  if(!duplicateGroups().length){ view = { tab:'events', sub:null, data:null }; }
  render();""")

rep(p, """  if(!S.settings.notDuplicates) S.settings.notDuplicates = [];
  for(let x = 0; x < g.length; x++)
    for(let y = x + 1; y < g.length; y++){
      const k = pairKey(g[x], g[y]);
      if(S.settings.notDuplicates.indexOf(k) < 0) S.settings.notDuplicates.push(k);
    }
  save();
  // Reversible""",
"""  if(!S.settings.notDuplicates) S.settings.notDuplicates = [];
  const added = [];
  for(let x = 0; x < g.length; x++)
    for(let y = x + 1; y < g.length; y++){
      const k = pairKey(g[x], g[y]);
      if(S.settings.notDuplicates.indexOf(k) < 0){ S.settings.notDuplicates.push(k); added.push(k); }
    }
  save();
  // Reversible""")

rep(p, """function clearDismissedConflicts(){""",
"""function clearNotDuplicates(){
  const before = (S.settings.notDuplicates || []).slice();
  if(!before.length) return;
  S.settings.notDuplicates = [];
  save(); render();
  toast('Restored ' + before.length + ' pair' + (before.length === 1 ? '' : 's'),
    { label:'Undo', fn:() => { S.settings.notDuplicates = before; save(); render(); } });
}
function clearDismissedConflicts(){""")

# ============================================================ 3. the x gets a word
rep(p, """      <button class="linkbtn" aria-label="Dismiss this warning"
        onclick="event.stopPropagation();dismissConflict('${esc(conflictKey(c))}')">${ico('x')}</button>""",
"""      <button class="linkbtn" style="padding:4px 6px"
        onclick="event.stopPropagation();dismissConflict('${esc(conflictKey(c))}')">Dismiss</button>""")

# ...and the big green button says what it does as well as why.
rep(p, """${ico('check-circle')}${keepLabel} — this is fine</button>`""",
    """${ico('check-circle')}${keepLabel} — dismiss this warning</button>`""")

# ============================================================ 4. somewhere to see them
rep(p, """    setBackup:renderSetBackup, setTrouble:renderSetTrouble,""",
    """    setBackup:renderSetBackup, setTrouble:renderSetTrouble,
    setDismissed:renderSetDismissed,""")

rep(p, """    settingsRow('flask', 'When something goes wrong', trouble, 'setTrouble',""",
"""    settingsRow('history', 'Dismissed warnings', dismissedCount()
      ? dismissedCount() + ' silenced' : 'Nothing silenced', 'setDismissed') +
    settingsRow('flask', 'When something goes wrong', trouble, 'setTrouble',""")

rep(p, """function renderSetBackup(m){""",
"""function dismissedCount(){
  return ((S.settings.dismissedConflicts || []).length)
       + ((S.settings.notDuplicates || []).length);
}

/**
 * Everything the app has been told to stop mentioning, and the way back.
 *
 * Before v9.66 there was no such screen: two settings keys grew forever, were
 * read on every render, and nothing in the app could show or clear them. A
 * mis-tap was permanent and invisible (code review P6-01, P6-02).
 *
 * Each row names the events involved, resolved from their ids, so "restore" is
 * a decision about something you can read rather than about a hash.
 */
function renderSetDismissed(m){
  setHeader('Dismissed Warnings', true);
  const conflicts = S.settings.dismissedConflicts || [];
  const pairs = S.settings.notDuplicates || [];
  const nameOf = (id) => {
    const e = S.events.find(x => x.id === id);
    return e ? (e.title || 'Untitled') : 'a deleted event';
  };

  if(!conflicts.length && !pairs.length){
    m.innerHTML = `<div class="empty"><div class="et">Nothing is silenced</div>
      <div class="eb">When you dismiss a clash warning, or mark two events as
      "not duplicates", it shows up here so you can change your mind.</div></div>`;
    return;
  }

  let html = `<div class="help">These are the warnings you told FlyerSnap to stop
    showing. Bringing one back makes it appear again if it still applies.</div>`;

  if(conflicts.length){
    html += `<div class="sect">Clash warnings (${conflicts.length})</div>`;
    html += conflicts.map(k => {
      // key shape: type|date|id,id  -- see conflictKey()
      const bits = String(k).split('|');
      const ids = (bits[2] || '').split(',').filter(Boolean);
      const who = ids.map(nameOf).join(' and ') || 'events that are gone';
      return `<div class="card row">
        <div class="grow">
          <div class="title" style="font-size:15px">${esc(who)}</div>
          <div class="meta" style="font-size:12px">${esc(bits[0] || '')}${bits[1] ? ' · ' + friendly(bits[1]) : ''}</div>
        </div>
        <button class="linkbtn" onclick="restoreDismissedConflict('${esc(k)}')">Bring back</button>
      </div>`;
    }).join('');
    html += `<button class="btn alt" onclick="clearDismissedConflicts()">${ico('refresh')}Bring back all clash warnings</button>`;
  }

  if(pairs.length){
    html += `<div class="sect">Marked "not duplicates" (${pairs.length})</div>`;
    html += pairs.map(k => {
      const ids = String(k).split('~');
      return `<div class="card row">
        <div class="grow"><div class="title" style="font-size:15px">${esc(ids.map(nameOf).join(' and '))}</div>
        <div class="meta" style="font-size:12px">will not be offered as duplicates</div></div>
        <button class="linkbtn" onclick="restoreNotDuplicate('${esc(k)}')">Bring back</button>
      </div>`;
    }).join('');
    html += `<button class="btn alt" onclick="clearNotDuplicates()">${ico('refresh')}Offer all pairs again</button>`;
  }

  m.innerHTML = html;
}
function restoreNotDuplicate(key){
  S.settings.notDuplicates = (S.settings.notDuplicates || []).filter(k => k !== key);
  save(); render();
  toast('Back in the duplicates list');
}

function renderSetBackup(m){""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
for path, text in buf.items():
    open(path, 'w').write(text)
print('dismissals made reversible ->', ', '.join(sorted(buf)))
