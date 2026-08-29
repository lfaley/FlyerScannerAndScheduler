#!/usr/bin/env python3
"""v9.72 - checklists, sort, colour, archive (NOTES-PLAN.md phase 2).

CHECKLISTS, AND WHY THEY LIVE IN THE BODY TEXT

Apple and Keep store checklist items as structured rows. FlyerSnap already has
a table shaped exactly like that -- S.listItems -- so copying it was the obvious
move, and it is the wrong one here.

Markdown lines inside the existing body ("- [ ] item" / "- [x] item") keep the
body as the SINGLE source of truth. Autosave, undo, soft delete, export, search
and the AI read path all keep working with no change and no second table to keep
in step. There are no orphan rows when a note is deleted, no migration for the
notes that have none, and a note survives a round trip through anything that
treats it as text. Bear does exactly this.

The cost, stated plainly: you cannot drag to reorder, and a malformed line
renders as text rather than a checkbox. Both are fine for "who is bringing
what", and Lists is still there for anything that needs more.

The toggle rewrites ONE line by index and touches nothing else on it -- not the
text, not the indentation, not the other lines. A checklist toggle that
reformats your note is a checklist toggle nobody trusts.

SORT is a saved setting (S.settings.noteSort), because Apple and Samsung both
treat it as one -- a preference, not a per-visit choice. Pinned still floats to
the top of whatever order is chosen; that is what pinning means.

ARCHIVE is a third state, distinct from delete. Keep's model. Delete keeps its
undo and its 'deleted' flag; archive just takes a note off the board and puts it
behind a count you can open. Archived notes are still searched when you ask for
them by name -- a note you archived is a note you kept.

COLOUR reuses KID_COLORS rather than inventing a second palette, so the app has
one set of accent colours and a note tinted like a person reads as related to
them rather than as a clash.
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

# ==================================================================== model
rep(p, """function liveNotes(){ return (S.notes || []).filter(n => !n.deleted); }""",
"""function liveNotes(){ return (S.notes || []).filter(n => !n.deleted); }
function boardNotes(){ return liveNotes().filter(n => !n.archived); }
function archivedNotes(){ return liveNotes().filter(n => n.archived); }

// ---- checklists, stored as lines in the body -----------------------------
// "- [ ] thing" / "- [x] thing", the markdown every notes app that uses text
// already understands. Leading whitespace is allowed and preserved.
const CHECK_LINE = /^(\\s*)-\\s\\[( |x|X)\\]\\s?(.*)$/;

function noteChecklist(n){
  const out = [];
  String((n && n.body) || '').split('\\n').forEach((line, i) => {
    const m = line.match(CHECK_LINE);
    if(m) out.push({ index:i, done: m[2].toLowerCase() === 'x', text: m[3] });
  });
  return out;
}
function noteCheckProgress(n){
  const items = noteChecklist(n);
  if(!items.length) return null;
  return { done: items.filter(i => i.done).length, total: items.length };
}

/**
 * Flip one checkbox, by LINE INDEX, touching nothing else.
 *
 * Rewriting the whole body from a parsed model would silently reformat
 * everything around the item -- indentation, blank lines, the paragraph above
 * it. This replaces exactly one line's marker and leaves its text, its leading
 * whitespace and every other line byte-identical.
 */
function toggleNoteCheck(noteId, lineIndex){
  const n = (S.notes || []).find(x => x.id === noteId);
  if(!n) return;
  const lines = String(n.body || '').split('\\n');
  const line = lines[lineIndex];
  if(line === undefined) return;
  const m = line.match(CHECK_LINE);
  if(!m) return;                       // the body moved under us; change nothing
  lines[lineIndex] = m[1] + '- [' + (m[2].toLowerCase() === 'x' ? ' ' : 'x') + '] ' + m[3];
  n.body = lines.join('\\n');
  n.updated = new Date().toISOString();
  save();
  renderNoteDetail(document.getElementById('main'));
}

/** Append an empty checkbox line and put the caret in the body after it. */
function addNoteCheckItem(noteId){
  const n = (S.notes || []).find(x => x.id === noteId);
  if(!n) return;
  flushNote();                         // do not let a pending autosave overwrite this
  const body = String(n.body || '');
  n.body = body + (body && !body.endsWith('\\n') ? '\\n' : '') + '- [ ] ';
  n.updated = new Date().toISOString();
  save();
  renderNoteDetail(document.getElementById('main'));
  const b = document.getElementById('noteBody');
  if(b){ b.focus(); try{ b.setSelectionRange(b.value.length, b.value.length); }catch(e){} }
}

// ---- sort -----------------------------------------------------------------
// A SAVED setting, not view state: Apple and Samsung both treat sort order as a
// preference rather than something you re-choose each visit.
const NOTE_SORTS = [
  { key:'edited',  label:'Last edited' },
  { key:'created', label:'Date added' },
  { key:'title',   label:'Title' },
];
function noteSort(){
  const k = S.settings && S.settings.noteSort;
  return NOTE_SORTS.some(s => s.key === k) ? k : 'edited';
}
function setNoteSort(k){
  S.settings.noteSort = NOTE_SORTS.some(s => s.key === k) ? k : 'edited';
  save(); render();
}
function noteSorter(){
  const k = noteSort();
  if(k === 'created') return (a, b) => String(b.created || '').localeCompare(String(a.created || ''));
  if(k === 'title') return (a, b) => noteTitleOf(a).toLowerCase().localeCompare(noteTitleOf(b).toLowerCase());
  return (a, b) => String(b.updated || '').localeCompare(String(a.updated || ''));
}

// ---- archive --------------------------------------------------------------
/**
 * A third state, between "on the board" and "deleted".
 *
 * Delete keeps its own flag and its own undo; this one only takes a note off
 * the board. Nothing is destroyed, so the toast offers a way back rather than
 * a warning -- the note is exactly where you left it, behind a count.
 */
function toggleArchiveNote(id){
  const n = (S.notes || []).find(x => x.id === id);
  if(!n) return;
  n.archived = !n.archived;
  n.updated = new Date().toISOString();
  save(); render();
  toast(n.archived ? 'Archived' : 'Back on the board',
    { label:'Undo', fn:() => { n.archived = !n.archived; save(); render(); } });
}

// ---- colour ---------------------------------------------------------------
// KID_COLORS, not a second palette: one set of accent colours in the app, and a
// note tinted like a person reads as related to them rather than as a clash.
function setNoteColor(id, color){
  const n = (S.notes || []).find(x => x.id === id);
  if(!n) return;
  n.color = KID_COLORS.includes(color) ? color : '';
  n.updated = new Date().toISOString();
  save();
  renderNoteDetail(document.getElementById('main'));
}""")

# ==================================================================== board
rep(p, """  const all = liveNotes();
  const shown = all.filter(n => noteMatches(n) && notePassesFilter(n));""",
"""  // The board shows live, un-archived notes. Archived ones are reachable from
  // their own row below, and a SEARCH still reaches them -- a note you archived
  // is a note you kept, and looking for it by name must find it.
  const all = boardNotes();
  const archived = archivedNotes();
  const shown = (noteSearch ? liveNotes() : all)
    .filter(n => noteMatches(n) && notePassesFilter(n));""")

rep(p, """  const byRecent = (a, b) => String(b.updated || '').localeCompare(String(a.updated || ''));
  const pinned = shown.filter(n => n.pinned).sort(byRecent);
  const rest   = shown.filter(n => !n.pinned).sort(byRecent);""",
"""  // Pinned floats to the top of WHATEVER order is chosen -- that is what
  // pinning means. The sort applies within each group.
  const by = noteSorter();
  const pinned = shown.filter(n => n.pinned).sort(by);
  const rest   = shown.filter(n => !n.pinned).sort(by);""")

rep(p, """  const card = (n) => {
    const preview = notePreviewOf(n);
    const who = eventPeople(n);
    return `<div class="card row" onclick="openNote('${n.id}')">""",
"""  const card = (n) => {
    const preview = notePreviewOf(n);
    const who = eventPeople(n);
    const prog = noteCheckProgress(n);
    return `<div class="card row" onclick="openNote('${n.id}')"${n.color ? ` style="border-left:5px solid ${esc(n.color)}"` : ''}>""")

rep(p, """        ${preview ? `<div class="meta" style="font-size:12px">${esc(preview)}</div>` : ''}""",
"""        ${preview ? `<div class="meta" style="font-size:12px">${esc(preview)}</div>` : ''}
        ${prog ? `<div class="meta" style="font-size:11px;color:var(--accent)">${ico('check-circle')}${prog.done} of ${prog.total}</div>` : ''}""")

# Sort control, and the way into the archive. Both go under the filter bar so
# the board's own controls sit together rather than scattered.
rep(p, """  html += `<div class="row" style="justify-content:flex-end;gap:10px;margin-bottom:8px">
    ${noteFiltersOn() ? `<button class="linkbtn" onclick="clearNoteFilters()">Clear filters</button>` : ''}
    <button class="linkbtn" onclick="sub('noteGroups')">Manage folders &amp; labels</button>
  </div>`;
  return html;""",
"""  html += `<div class="row" style="justify-content:flex-end;gap:10px;margin-bottom:8px">
    ${noteFiltersOn() ? `<button class="linkbtn" onclick="clearNoteFilters()">Clear filters</button>` : ''}
    <button class="linkbtn" onclick="sub('noteGroups')">Manage folders &amp; labels</button>
  </div>`;
  return html;""")

rep(p, """  html += noteFilterBar(all);
""",
"""  html += noteFilterBar(all);

  // Sort, and the way into the archive. Only once there is enough to sort.
  if(all.length > 2 || archived.length){
    html += `<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px">
      <span class="filterbar" style="margin:0">${NOTE_SORTS.map(s =>
        `<button class="chip ${noteSort() === s.key ? 'on' : ''}" aria-pressed="${noteSort() === s.key}"
          onclick="setNoteSort('${s.key}')">${esc(s.label)}</button>`).join('')}</span>
      ${archived.length ? `<button class="linkbtn" onclick="sub('noteArchive')">Archived (${archived.length})</button>` : ''}
    </div>`;
  }
""")

# ==================================================================== note
rep(p, """      <div class="help" style="font-size:12px">Saved as you type. No title? The first line becomes one.</div>
    </div>""",
"""      <div class="help" style="font-size:12px">Saved as you type. No title? The first line becomes one.</div>
      <div class="row" style="justify-content:flex-end;margin-top:6px">
        <button class="linkbtn" onclick="addNoteCheckItem('${n.id}')">${ico('plus')}Add a checkbox</button>
      </div>
    </div>
    ${checks.length ? `<div class="card">
      <div class="label" style="margin-bottom:6px">Checklist — ${checks.filter(c => c.done).length} of ${checks.length}</div>
      ${checks.map(c => `<div class="row" role="checkbox" aria-checked="${c.done}" tabindex="0"
        style="padding:6px 0;cursor:pointer"
        onclick="toggleNoteCheck('${n.id}',${c.index})"
        onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();toggleNoteCheck('${n.id}',${c.index})}">
        <span class="check ${c.done ? 'on' : ''}" aria-hidden="true" style="width:22px;height:22px;border-radius:11px">${c.done ? '✓' : ''}</span>
        <span class="grow" style="${c.done ? 'opacity:.6;text-decoration:line-through' : ''}">${esc(c.text) || '<span class="meta">empty</span>'}</span>
      </div>`).join('')}
      <div class="help" style="font-size:12px">These are lines in the note itself —
        <code>- [ ] thing</code>. Edit them like any other text.</div>
    </div>` : ''}""")

rep(p, """  setHeader(noteTitleOf(n), true);
  const people = allPeople();""",
"""  setHeader(noteTitleOf(n), true);
  const people = allPeople();
  const checks = noteChecklist(n);""")

rep(p, """    <div class="card row">
      <div class="grow meta" style="font-size:12px">${n.updated ? 'Last edited ' + friendly(String(n.updated).slice(0,10)) : ''}</div>
      <button class="linkbtn" onclick="togglePinNote('${n.id}')">${n.pinned ? 'Unpin' : 'Pin to top'}</button>
    </div>
    <button class="btn alt" style="border-color:var(--red-accent);color:var(--red-accent)"
      onclick="delNote('${n.id}')">${ico('trash')}Delete note</button>""",
"""    <div class="card">
      <div class="label" style="margin-bottom:6px">Colour</div>
      <div class="filterbar">
        <button class="chip ${!n.color ? 'on' : ''}" aria-pressed="${!n.color}"
          onclick="setNoteColor('${n.id}','')">None</button>
        ${KID_COLORS.map(c => `<button class="chip" aria-label="Colour ${esc(c)}"
          aria-pressed="${n.color === c}"
          style="background:${c};border-color:${c};color:var(--on-accent)${n.color === c ? ';outline:2px solid var(--ink)' : ''}"
          onclick="setNoteColor('${n.id}','${c}')">${n.color === c ? '✓' : '&nbsp;&nbsp;'}</button>`).join('')}
      </div>
    </div>
    <div class="card row">
      <div class="grow meta" style="font-size:12px">${n.updated ? 'Last edited ' + friendly(String(n.updated).slice(0,10)) : ''}</div>
      <button class="linkbtn" onclick="togglePinNote('${n.id}')">${n.pinned ? 'Unpin' : 'Pin to top'}</button>
      <button class="linkbtn" onclick="toggleArchiveNote('${n.id}')">${n.archived ? 'Unarchive' : 'Archive'}</button>
    </div>
    <div class="help" style="font-size:12px">Archiving takes a note off the board and keeps it.
      Deleting removes it — with an undo.</div>
    <button class="btn alt" style="border-color:var(--red-accent);color:var(--red-accent)"
      onclick="delNote('${n.id}')">${ico('trash')}Delete note</button>""")

# ==================================================================== archive
rep(p, """    noteGroups:renderNoteGroups,""",
    """    noteGroups:renderNoteGroups, noteArchive:renderNoteArchive,""")

rep(p, """function renderNoteGroups(m){""",
"""/**
 * Notes taken off the board but kept. Nothing here is deleted, so the only
 * control that needs to exist is the way back.
 */
function renderNoteArchive(m){
  setHeader('Archived Notes', true);
  const rows = archivedNotes().sort(noteSorter());
  if(!rows.length){
    m.innerHTML = `<div class="empty"><div class="et">Nothing archived</div>
      <div class="eb">Archiving takes a note off the board without deleting it —
      for the ones you are finished with but want to keep.</div></div>`;
    return;
  }
  m.innerHTML = `<div class="help">These are off the board but still here, and
    still turn up when you search by name.</div>` + rows.map(n => `<div class="card row"
      onclick="openNote('${n.id}')"${n.color ? ` style="border-left:5px solid ${esc(n.color)}"` : ''}>
      <div class="grow">
        <div class="title">${esc(noteTitleOf(n))}</div>
        <div class="meta" style="font-size:11px">${n.updated ? 'edited ' + friendly(String(n.updated).slice(0,10)) : ''}</div>
      </div>
      <button class="linkbtn" onclick="event.stopPropagation();toggleArchiveNote('${n.id}')">Unarchive</button>
    </div>`).join('');
}

function renderNoteGroups(m){""")

# ==================================================================== bridge
rep(p, """  addNoteGroup,
  clearNoteFilters,""",
"""  addNoteCheckItem,
  addNoteGroup,
  clearNoteFilters,""")

rep(p, """  setNoteFolder,
  setNoteFolderFilter,
  toggleNoteLabel,""",
"""  setNoteColor,
  setNoteFolder,
  setNoteFolderFilter,
  setNoteSort,
  toggleArchiveNote,
  toggleNoteCheck,
  toggleNoteLabel,""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
for path, text in buf.items():
    open(path, 'w').write(text)
print('notes phase 2 wired ->', ', '.join(sorted(buf)))
