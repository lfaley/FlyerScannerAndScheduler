#!/usr/bin/env python3
"""v9.70 - the clash banner gets real selection: one event, or several.

Logan, 28 Aug: "I should be able to choose one or multiple. that's not what you
gave me. and no guessing come up with a better way for the layout."

WHAT WAS WRONG WITH v9.69

I bolted a second red link under every row. On the four-event busy day in his
screenshot that is EIGHT destructive controls stacked down the card, every one
of them acting on a single event, and still no way to say "these two". The
count was wrong and the layout was worse.

THE PATTERN, WHICH THE APP ALREADY HAS

The Problem Log solved this exact problem in v9.39 and its shape is proven
here: a "Select" link that puts the list into select mode, a checkbox on each
row, a count bar at the top carrying "Select all" and "Cancel", and the bulk
actions in one place. Reusing it means the clash banner behaves like a screen
Logan has already used, and it is the shape he chose when asked.

  DEFAULT VIEW  -- back to being readable. Title, meta, "Tap to reschedule",
                   and ONE "Select..." link. All eight red links are gone; the
                   only destructive control on screen is the group dismiss.
  SELECT MODE   -- every event becomes a checkbox row (tapping the row toggles
                   it rather than opening the editor), a bar counts what is
                   picked, and TWO buttons act on the selection:
                     "Remove selected (2)"
                     "Keep only selected -- remove the other 2"

Rule 26: both buttons carry the number of events they will actually remove, so
neither can be tapped without seeing the size of it.

NOTHING IS REMOVED (CLAUDE.md rule 1)

keepOnlyEvent() and removeOneEvent() keep their names, signatures and every
guarantee their tests pin -- they are now one-line wrappers over the general
handlers, so there is ONE implementation of "remove these, keep those" instead
of three. The per-event keep-only choice still exists; it lives inside select
mode with one event ticked, which is also the only place it can honestly show
its own count.

SELECTION IS VIEW STATE, and is keyed to the conflict it was made in
(clashSelKey). findConflicts() re-derives on every render, so a selection made
against one conflict must never act on another -- the same failure P5-07 found
in dedupeKeep, which was keyed by list position.
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

p = 'index.html'

# ============================================================ 1. the state
rep(p, """// Which of several live conflicts the banner is currently showing. Lets the
// user page through them (Logan's request) instead of having to dismiss one to
// see the next. Reset/clamped whenever the live list shrinks.
let conflictViewIndex = 0;""",
"""// Which of several live conflicts the banner is currently showing. Lets the
// user page through them (Logan's request) instead of having to dismiss one to
// see the next. Reset/clamped whenever the live list shrinks.
let conflictViewIndex = 0;

/**
 * Select mode on the clash banner (v9.70). `null` = not selecting (the normal
 * state); a Set of event ids = selecting. Same shape as problemSel, and held
 * outside S for the same reason: it is view state, so it must never be saved
 * or reach a backup, and a Set would serialise to {} if it were.
 *
 * clashSelKey pins the selection to the conflict it was made in. findConflicts()
 * re-derives on every render, so without it a selection made on one clash could
 * act on whatever the banner happens to be showing after a dismiss, a page, or
 * an undo -- which is exactly the failure P5-07 found in dedupeKeep, where the
 * key was the group's position in a list that changes shape.
 */
let clashSel = null;
let clashSelKey = null;

function clashSelecting(key){ return !!clashSel && clashSelKey === key; }

function toggleClashSelect(key){
  if(clashSelecting(key)){ clashSel = null; clashSelKey = null; }
  else { clashSel = new Set(); clashSelKey = key; }
  render();
}
function toggleClashPick(id, key){
  if(!clashSelecting(key)) return;
  if(clashSel.has(id)) clashSel.delete(id); else clashSel.add(id);
  render();
}
function selectAllClash(key){
  const c = findConflicts(S.events, todayISO()).find(x => conflictKey(x) === key);
  if(!c) return;
  const ids = c.events.map(e => e.id);
  // One control, both directions: tapping it again when everything is picked
  // clears, which is the only sane second meaning of "Select all".
  const all = clashSel && ids.every(id => clashSel.has(id)) && clashSel.size === ids.length;
  clashSel = all ? new Set() : new Set(ids);
  clashSelKey = key;
  render();
}
function clearClashSel(){ clashSel = null; clashSelKey = null; }""")

# ============================================================ 2. the handlers
# One implementation of "remove these, keep those". keepOnlyEvent and
# removeOneEvent become the single-id cases of it.
rep(p, """function keepOnlyEvent(keepId, key){
  // Re-derive rather than trusting a rendered index -- see stepConflict().
  const c = findConflicts(S.events, todayISO()).find(x => conflictKey(x) === key);
  if(!c){ toast('That clash is already resolved'); render(); return; }

  const keep = c.events.find(e => e.id === keepId);
  const losers = c.events.filter(e => e.id !== keepId && !e.deleted);
  if(!keep || !losers.length){ render(); return; }

  const names = losers.map(e => '“' + (e.title || 'Untitled') + '”').join(', ');
  if(!confirm('Keep “' + (keep.title || 'Untitled') + '” and remove ' + names + '?'
    + '\\n\\nThey are removed from your list. Anything already added to your calendar stays there — delete those in the Calendar app.')) return;

  // Remember each row's prior flags so the undo restores the state that was
  // actually there, rather than assuming both were unset.
  const before = losers.map(e => ({ e, deleted: e.deleted, dirty: e.dirty }));
  losers.forEach(e => { e.deleted = true; e.dirty = 1; });
  save();
  render();
  toast('Kept “' + (keep.title || 'Untitled') + '” — removed ' + losers.length,
    { label:'Undo', fn:() => {
      before.forEach(b => { b.e.deleted = b.deleted; b.e.dirty = b.dirty; });
      save(); render(); toast('Put back');
    }});
}""",
"""/**
 * THE one implementation of "remove these events from this clash" (v9.70).
 *
 * Everything else on the banner routes through here: keeping one, removing one,
 * removing a selection, keeping a selection. Before v9.70 there were three
 * near-copies of this loop and they had already drifted in what they confirmed
 * and what their undo restored.
 *
 * Soft delete plus `dirty`, exactly as applyDedupe() and bulkDelete() do, and
 * an undo that restores each row's PRIOR flags rather than assuming they were
 * unset.
 *
 * No dismissConflict() call is needed or wanted: eventsClash() returns false
 * the moment either side is deleted, and a busy day that drops below the
 * threshold stops being one, so the warning goes on its own. Writing the key
 * into dismissedConflicts as well would leave a dead entry there forever, and
 * would silence the group if an undo brought the events back.
 */
function removeFromClash(ids, key, opts){
  // Re-derive rather than trusting a rendered index -- see stepConflict().
  const c = findConflicts(S.events, todayISO()).find(x => conflictKey(x) === key);
  if(!c){ toast('That clash is already resolved'); render(); return; }

  const set = new Set(ids || []);
  const losers = c.events.filter(e => set.has(e.id) && !e.deleted);
  if(!losers.length){ render(); return; }
  const staying = c.events.filter(e => !set.has(e.id) && !e.deleted).length;

  const names = losers.map(e => '“' + (e.title || 'Untitled') + '”').join(', ');
  const lead = (opts && opts.lead) || ('Remove ' + names + '?');
  if(!confirm(lead
    + (staying ? '\\n\\nThe other ' + staying + (staying === 1 ? ' event stays' : ' events stay') + '.' : '')
    + '\\n\\n' + (losers.length === 1 ? 'It is' : 'They are')
    + ' removed from your list. Anything already added to your calendar stays there — delete those in the Calendar app.')) return;

  const before = losers.map(e => ({ e, deleted: e.deleted, dirty: e.dirty }));
  losers.forEach(e => { e.deleted = true; e.dirty = 1; });
  clearClashSel();
  save();
  render();
  toast((opts && opts.toast) || ('Removed ' + losers.length + ' event' + (losers.length === 1 ? '' : 's')),
    { label:'Undo', fn:() => {
      before.forEach(b => { b.e.deleted = b.deleted; b.e.dirty = b.dirty; });
      save(); render(); toast('Put back');
    }});
}

/**
 * Keep the named events and remove the rest of the clash. The inverse selection
 * of removeFromClash, expressed through it so there is one code path.
 */
function keepOnlyInClash(keepIds, key){
  const c = findConflicts(S.events, todayISO()).find(x => conflictKey(x) === key);
  if(!c){ toast('That clash is already resolved'); render(); return; }
  const keepSet = new Set(keepIds || []);
  const keeping = c.events.filter(e => keepSet.has(e.id));
  const losers = c.events.filter(e => !keepSet.has(e.id) && !e.deleted);
  if(!keeping.length || !losers.length){ render(); return; }

  const kept = keeping.map(e => '“' + (e.title || 'Untitled') + '”').join(', ');
  const gone = losers.map(e => '“' + (e.title || 'Untitled') + '”').join(', ');
  removeFromClash(losers.map(e => e.id), key, {
    lead: 'Keep ' + kept + ' and remove ' + gone + '?',
    toast: 'Kept ' + keeping.length + ' — removed ' + losers.length
  });
}

/**
 * Keep exactly one event and remove the rest (v9.59). Unchanged in name,
 * signature and behaviour -- it is now the one-id case of keepOnlyInClash, so
 * the loop it used to own lives in a single place.
 */
function keepOnlyEvent(keepId, key){ keepOnlyInClash([keepId], key); }""")

rep(p, """function removeOneEvent(evId, key){
  // Re-derive rather than trusting a rendered index -- see stepConflict().
  const c = findConflicts(S.events, todayISO()).find(x => conflictKey(x) === key);
  if(!c){ toast('That clash is already resolved'); render(); return; }

  const ev = c.events.find(e => e.id === evId);
  if(!ev || ev.deleted){ render(); return; }
  const keeping = c.events.filter(e => e.id !== evId && !e.deleted).length;

  if(!confirm('Remove “' + (ev.title || 'Untitled') + '”?'
    + (keeping ? '\\n\\nThe other ' + keeping + (keeping === 1 ? ' event stays' : ' events stay') + '.' : '')
    + '\\n\\nIt is removed from your list. Anything already added to your calendar stays there — delete those in the Calendar app.')) return;

  const before = { deleted: ev.deleted, dirty: ev.dirty };
  ev.deleted = true; ev.dirty = 1;
  save();
  render();
  toast('Removed “' + (ev.title || 'Untitled') + '”',
    { label:'Undo', fn:() => {
      ev.deleted = before.deleted; ev.dirty = before.dirty;
      save(); render(); toast('Put back');
    }});
}""",
"""/** Remove exactly one event and keep the rest. The one-id case. */
function removeOneEvent(evId, key){ removeFromClash([evId], key); }

/** The two select-mode actions. Both refuse an empty selection. */
function removeSelectedClash(key){
  if(!clashSelecting(key) || !clashSel.size) return;
  removeFromClash([...clashSel], key);
}
function keepOnlySelectedClash(key){
  if(!clashSelecting(key) || !clashSel.size) return;
  keepOnlyInClash([...clashSel], key);
}""")

# A selection belongs to the clash it was made in; paging away drops it.
rep(p, """function stepConflict(){
  const dismissed = new Set(S.settings.dismissedConflicts || []);""",
"""function stepConflict(){
  clearClashSel();          // a selection belongs to the clash it was made in
  const dismissed = new Set(S.settings.dismissedConflicts || []);""")

# ...and so does dismissing one.
rep(p, """function dismissConflict(key){
  const list = S.settings.dismissedConflicts || (S.settings.dismissedConflicts = []);
  if(list.includes(key)) return;                 // already silenced; nothing to undo""",
"""function dismissConflict(key){
  const list = S.settings.dismissedConflicts || (S.settings.dismissedConflicts = []);
  if(list.includes(key)) return;                 // already silenced; nothing to undo
  clearClashSel();""")

# ============================================================ 3. the layout
rep(p, """    + `<div class="meta" style="font-size:11px;color:var(--muted)">Or pick one — move it, remove just it, or keep only it:</div>`
    + c.events.slice(0, 5).map(ev => {""",
"""    + `<div class="meta" style="font-size:11px;color:var(--muted)">${picking
        ? 'Tick the ones you mean:'
        : 'Or tap one to move it:'}</div>`
    + c.events.slice(0, 5).map(ev => {""")

rep(p, """  const keepLabel = c.events.length > 2 ? 'Keep all' : 'Keep both';""",
"""  const keepLabel = c.events.length > 2 ? 'Keep all' : 'Keep both';
  // v9.70: select mode, the same shape the Problem Log has used since v9.39.
  // The default view carries NO per-event destructive control -- v9.69 put two
  // red links under every row, which on a four-event busy day is eight of them
  // and still could not express "these two".
  const picking = clashSelecting(key);
  const nPicked = picking ? clashSel.size : 0;
  const nTotal = c.events.length;""")

rep(p, """        const others = c.events.length - 1;
        // TWO directions, not one. Until v9.69 the only per-event action was
        // "keep only this", which on a busy day of four means deleting three
        // events to be rid of one. Both are offered now, and both name the
        // number of events they will actually remove.
        return `<div style="display:flex;flex-direction:column;gap:2px">
          <button class="btn alt sm" style="width:100%;text-align:left;white-space:normal;padding:10px 12px"
            onclick="openEventEdit('${esc(ev.id)}')">
            <span style="font-weight:700;display:block">${esc(ev.title || 'Untitled')}${ev.kind === 'deadline' ? ' · deadline' : ''}</span>
            <span class="meta" style="font-size:12px;display:block;margin-top:2px">${esc(meta)}</span>
            <span class="meta" style="font-size:11px;display:block;margin-top:3px;color:var(--accent)">${ico('edit')}Tap to reschedule</span>
          </button>
          <div class="row" style="justify-content:flex-end;gap:10px;flex-wrap:wrap">
            <button class="linkbtn red" style="font-size:12px;padding:2px 4px"
              aria-label="Remove ${esc(ev.title || 'Untitled')} and keep the other ${others === 1 ? 'event' : others + ' events'}"
              onclick="event.stopPropagation();removeOneEvent('${esc(ev.id)}','${esc(key)}')">
              Remove just this one</button>
            <button class="linkbtn red" style="font-size:12px;padding:2px 4px"
              aria-label="Keep only ${esc(ev.title || 'Untitled')} and remove the other ${others === 1 ? 'event' : others + ' events'}"
              onclick="event.stopPropagation();keepOnlyEvent('${esc(ev.id)}','${esc(key)}')">
              Keep only this — remove the other${others === 1 ? '' : ' ' + others}</button>
          </div>
        </div>`;
      }).join('')""",
"""        // In select mode the row IS the checkbox -- tapping it toggles rather
        // than opening the editor, so the whole card is the target on a phone.
        // Out of select mode it is exactly what it always was.
        if(picking){
          const on = clashSel.has(ev.id);
          return `<button class="btn alt sm" role="checkbox" aria-checked="${on ? 'true' : 'false'}"
            style="width:100%;text-align:left;white-space:normal;padding:10px 12px;display:flex;align-items:flex-start;gap:10px${on ? ';border-color:var(--accent)' : ''}"
            onclick="event.stopPropagation();toggleClashPick('${esc(ev.id)}','${esc(key)}')">
            <span class="check ${on ? 'on' : ''}" style="width:22px;height:22px;border-radius:11px;margin-top:1px" aria-hidden="true">${on ? '✓' : ''}</span>
            <span class="grow">
              <span style="font-weight:700;display:block">${esc(ev.title || 'Untitled')}${ev.kind === 'deadline' ? ' · deadline' : ''}</span>
              <span class="meta" style="font-size:12px;display:block;margin-top:2px">${esc(meta)}</span>
            </span>
          </button>`;
        }
        return `<button class="btn alt sm" style="width:100%;text-align:left;white-space:normal;padding:10px 12px"
          onclick="openEventEdit('${esc(ev.id)}')">
          <span style="font-weight:700;display:block">${esc(ev.title || 'Untitled')}${ev.kind === 'deadline' ? ' · deadline' : ''}</span>
          <span class="meta" style="font-size:12px;display:block;margin-top:2px">${esc(meta)}</span>
          <span class="meta" style="font-size:11px;display:block;margin-top:3px;color:var(--accent)">${ico('edit')}Tap to reschedule</span>
        </button>`;
      }).join('')""")

# The select bar goes ABOVE the rows, where the count and the escape hatch are
# visible without scrolling -- the same placement, and the same reason, as the
# Problem Log's. The two actions sit with it rather than under each row.
rep(p, """    + `<button class="btn sm" style="width:100%" onclick="event.stopPropagation();dismissConflict('${esc(key)}')">${ico('check-circle')}${keepLabel} — dismiss this warning</button>`
    + `<div class="meta" style="font-size:12px;margin:2px 0 4px">${esc(note)}</div>`""",
"""    + (picking ? '' : `<button class="btn sm" style="width:100%" onclick="event.stopPropagation();dismissConflict('${esc(key)}')">${ico('check-circle')}${keepLabel} — dismiss this warning</button>`)
    + (picking ? '' : `<div class="meta" style="font-size:12px;margin:2px 0 4px">${esc(note)}</div>`)
    + (picking ? `<div class="card" style="padding:10px;margin:0 0 6px;border-left:4px solid var(--accent)">
        <div class="row">
          <div class="grow" style="font-weight:700;font-size:var(--t-sm)">${nPicked} selected</div>
          <button class="linkbtn" onclick="event.stopPropagation();selectAllClash('${esc(key)}')">${nPicked === nTotal ? 'Select none' : 'Select all'}</button>
          <button class="linkbtn" onclick="event.stopPropagation();toggleClashSelect('${esc(key)}')">Cancel</button>
        </div>
        <div class="formrow" style="margin-top:8px">
          <button class="btn sm alt" ${nPicked ? '' : 'disabled'}
            style="border-color:var(--red-accent);color:var(--red-accent)"
            onclick="event.stopPropagation();removeSelectedClash('${esc(key)}')">Remove selected${nPicked ? ' (' + nPicked + ')' : ''}</button>
          <button class="btn sm alt" ${nPicked && nPicked < nTotal ? '' : 'disabled'}
            style="border-color:var(--red-accent);color:var(--red-accent)"
            onclick="event.stopPropagation();keepOnlySelectedClash('${esc(key)}')">Keep only ${nPicked === 1 ? 'this' : 'these'}${nPicked && nPicked < nTotal ? ' — remove ' + (nTotal - nPicked) : ''}</button>
        </div>
      </div>` : '')""")

# The one link that starts it, and the way out.
rep(p, """    + (c.events.length > 5 ? `<div class="meta" style="font-size:12px">and ${c.events.length - 5} more overlapping</div>` : '')
    + `</div>`;""",
"""    + (c.events.length > 5 ? `<div class="meta" style="font-size:12px">and ${c.events.length - 5} more overlapping</div>` : '')
    + (picking ? '' : `<div class="row" style="justify-content:flex-end;margin-top:2px">
        <button class="linkbtn" onclick="event.stopPropagation();toggleClashSelect('${esc(key)}')">Select…</button>
      </div>`)
    + `</div>`;""")

# ============================================================ 4. the bridge
# Inline onclick handlers resolve against global scope. A function missing from
# this list is a control that throws on tap and reads as simply dead.
rep(p, """  keepOnlyEvent,
  removeOneEvent,""",
"""  keepOnlyEvent,
  keepOnlyInClash,
  keepOnlySelectedClash,
  removeFromClash,
  removeOneEvent,
  removeSelectedClash,
  selectAllClash,
  toggleClashPick,
  toggleClashSelect,""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
for path, text in buf.items():
    open(path, 'w').write(text)
print('clash select mode wired ->', ', '.join(sorted(buf)))
