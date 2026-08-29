#!/usr/bin/env python3
"""v9.71 part 2 - the screens for folders and labels.

Three places change:

  1. THE BOARD gets a filter bar: a folder row (single choice, plus "Unfiled")
     and a label row (multi, ANDed). Bergman et al. measured that navigating a
     visible structure costs less attention than typing into a search box and
     is ~3x faster, so the groups have to be TAPPABLE, not just searchable.
     They only render once there is something to tap -- a filter bar over an
     empty vocabulary is chrome.

  2. THE NOTE gets a Folder row and a label chip row, both with an inline
     "+ New" so a folder can be created at the moment it is first needed rather
     than in a settings screen first. That is the whole cost difference Civan
     et al. measured between the two models, and it is the one thing that
     decides whether either gets used.

  3. A MANAGE screen renames and deletes both kinds, with the count of notes
     each holds, so a delete is a decision about something you can see.

Cards show where a note lives and what it is about, because a group you cannot
see on the item is a group you stop trusting.
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

# ============================================================ 1. the board
rep(p, """  const all = liveNotes();
  const shown = all.filter(noteMatches);""",
"""  const all = liveNotes();
  const shown = all.filter(n => noteMatches(n) && notePassesFilter(n));""")

rep(p, """  if(!shown.length){
    html += `<div class="empty"><div class="eb">Nothing matches “${esc(noteSearch)}”.</div></div>`;
    m.innerHTML = html; return;
  }""",
"""  if(!shown.length){
    // Two different dead ends, and telling them apart matters: a search that
    // found nothing is the user's word; a filter that found nothing is a
    // control they can see and switch off.
    html += noteSearch
      ? `<div class="empty"><div class="eb">Nothing matches “${esc(noteSearch)}”.</div></div>`
      : `<div class="empty"><div class="et">Nothing here yet</div>
         <div class="eb">No notes match the folder and labels you picked.</div>
         <button class="btn alt" onclick="clearNoteFilters()">Show all notes</button></div>`;
    m.innerHTML = html; return;
  }""")

# The filter bar itself, above the list and below the search box.
rep(p, """  if(!all.length){
    html += emptyState('note', 'No notes yet',""",
"""  html += noteFilterBar(all);

  if(!all.length){
    html += emptyState('note', 'No notes yet',""")

# Cards carry their folder and labels.
rep(p, """        <div class="meta" style="font-size:11px">${n.updated ? 'edited ' + friendly(String(n.updated).slice(0,10)) : ''}${who.length ? ' · ' + esc(who.map(p=>p.name).join(', ')) : ''}</div>""",
"""        <div class="meta" style="font-size:11px">${n.updated ? 'edited ' + friendly(String(n.updated).slice(0,10)) : ''}${who.length ? ' · ' + esc(who.map(p=>p.name).join(', ')) : ''}</div>
        ${(noteFolderName(n.folderId) || noteLabelsOf(n).length) ? `<div class="meta" style="font-size:11px;margin-top:3px">
          ${noteFolderName(n.folderId) ? `${ico('folder')}${esc(noteFolderName(n.folderId))}` : ''}
          ${noteLabelsOf(n).map(l => `<span style="color:var(--accent)">#${esc(l.name)}</span>`).join(' ')}
        </div>` : ''}""")

rep(p, """function renderNotesBoard(m){""",
"""/**
 * The folder row and the label row above the board.
 *
 * Rendered only once there is a vocabulary to render -- a filter bar over zero
 * folders and zero labels is chrome that teaches nothing. "Unfiled" appears
 * only when something is actually unfiled, so it cannot become a permanent
 * accusation on a tidy collection.
 */
function noteFilterBar(all){
  const folders = noteFolders();
  const labels = noteLabels();
  if(!folders.length && !labels.length) return '';

  const inFolder = (id) => all.filter(n => (n.folderId || null) === id).length;
  const unfiled = inFolder(null);
  let html = '';

  if(folders.length){
    html += `<div class="filterbar" style="margin-bottom:6px">
      <button class="chip ${noteFolderFilter === null ? 'on' : ''}"
        aria-pressed="${noteFolderFilter === null}"
        onclick="clearNoteFilters()">All (${all.length})</button>`
      + folders.map(f => `<button class="chip ${noteFolderFilter === f.id ? 'on' : ''}"
          aria-pressed="${noteFolderFilter === f.id}"
          onclick="setNoteFolderFilter('${esc(f.id)}')">${ico('folder')}${esc(f.name)} (${inFolder(f.id)})</button>`).join('')
      + (unfiled ? `<button class="chip ${noteFolderFilter === '' ? 'on' : ''}"
          aria-pressed="${noteFolderFilter === ''}"
          onclick="setNoteFolderFilter('')">Unfiled (${unfiled})</button>` : '')
      + `</div>`;
  }

  if(labels.length){
    html += `<div class="filterbar" style="margin-bottom:6px">`
      + labels.map(l => `<button class="chip ${noteLabelFilter.has(l.id) ? 'on' : ''}"
          aria-pressed="${noteLabelFilter.has(l.id)}"
          onclick="toggleNoteLabelFilter('${esc(l.id)}')">#${esc(l.name)}</button>`).join('')
      + `</div>`;
  }

  html += `<div class="row" style="justify-content:flex-end;gap:10px;margin-bottom:8px">
    ${noteFiltersOn() ? `<button class="linkbtn" onclick="clearNoteFilters()">Clear filters</button>` : ''}
    <button class="linkbtn" onclick="sub('noteGroups')">Manage folders &amp; labels</button>
  </div>`;
  return html;
}

function renderNotesBoard(m){""")

# ============================================================ 2. the note
rep(p, """    ${people.length ? `<div class="card">
      <div class="label" style="margin-bottom:6px">Who is this about?</div>""",
"""    <div class="card">
      <div class="label" style="margin-bottom:6px">Folder</div>
      <div class="filterbar">
        <button class="chip ${!n.folderId ? 'on' : ''}" aria-pressed="${!n.folderId}"
          onclick="setNoteFolder('${n.id}', null)">Unfiled</button>
        ${noteFolders().map(f => `<button class="chip ${n.folderId === f.id ? 'on' : ''}"
          aria-pressed="${n.folderId === f.id}"
          onclick="setNoteFolder('${n.id}','${esc(f.id)}')">${ico('folder')}${esc(f.name)}</button>`).join('')}
        <button class="chip" onclick="newNoteGroupFor('noteFolders','${n.id}')">+ New folder</button>
      </div>
      <div class="label" style="margin:10px 0 6px">Labels</div>
      <div class="filterbar">
        ${noteLabels().map(l => `<button class="chip ${(n.labelIds||[]).includes(l.id) ? 'on' : ''}"
          aria-pressed="${(n.labelIds||[]).includes(l.id)}"
          onclick="toggleNoteLabel('${n.id}','${esc(l.id)}')">#${esc(l.name)}</button>`).join('')}
        <button class="chip" onclick="newNoteGroupFor('noteLabels','${n.id}')">+ New label</button>
      </div>
      <div class="help" style="font-size:12px;margin-top:8px">A note sits in one folder.
        Labels can be as many as you like — use them for anything that cuts across folders.</div>
    </div>
    ${people.length ? `<div class="card">
      <div class="label" style="margin-bottom:6px">Who is this about?</div>""")

# Creating a group from the note itself. The whole cost difference Civan et al.
# measured is the moment of filing; sending the user to a settings screen to
# make a folder first is how a filing feature goes unused.
rep(p, """function openNote(id){ sub('noteDetail', {id}); }""",
"""function openNote(id){ sub('noteDetail', {id}); }

/**
 * Make a folder or a label from inside the note that needs it, and apply it.
 *
 * prompt() rather than a screen, deliberately: the point of this control is
 * that filing costs one gesture. A duplicate name returns the existing row
 * (see addNoteGroup), so tapping "+ New folder" and typing a name that already
 * exists files the note there instead of forking the group in two.
 */
function newNoteGroupFor(coll, noteId){
  const isFolder = coll === 'noteFolders';
  const name = prompt(isFolder ? 'Name for the new folder' : 'Name for the new label');
  if(name === null) return;                       // cancelled -- change nothing
  const row = addNoteGroup(coll, name);
  if(!row){ toast('That needs a name'); return; }
  const n = (S.notes || []).find(x => x.id === noteId);
  if(n){
    if(isFolder) n.folderId = row.id;
    else if(!(n.labelIds || []).includes(row.id)) (n.labelIds = n.labelIds || []).push(row.id);
    n.updated = new Date().toISOString();
    save();
  }
  renderNoteDetail(document.getElementById('main'));
}""")

# ============================================================ 3. manage screen
rep(p, """    listDetail:renderListDetail, noteDetail:renderNoteDetail,""",
    """    listDetail:renderListDetail, noteDetail:renderNoteDetail,
    noteGroups:renderNoteGroups,""")

rep(p, """function renderNoteDetail(m){""",
"""/**
 * Rename and remove folders and labels, with the note count each one holds.
 *
 * The count is the point. Deleting a container is only a safe decision if you
 * can see what is in it -- and the screen says out loud that the notes survive,
 * because "delete folder" is exactly the phrase a user expects to mean "and
 * everything in it".
 */
function renderNoteGroups(m){
  setHeader('Folders & Labels', true);
  const all = liveNotes();
  const rowsFor = (coll, rows, countOf, kind) => rows.length
    ? rows.map(r => `<div class="card row" style="padding:12px">
        <div class="grow">
          <div style="font-weight:600">${kind === 'folder' ? ico('folder') : '#'}${esc(r.name)}</div>
          <div class="meta" style="font-size:12px">${countOf(r.id)} note${countOf(r.id) === 1 ? '' : 's'}</div>
        </div>
        <button class="linkbtn" onclick="renameNoteGroupUI('${coll}','${esc(r.id)}')">Rename</button>
        <button class="linkbtn red" onclick="delNoteGroup('${coll}','${esc(r.id)}')">Remove</button>
      </div>`).join('')
    : `<div class="help">None yet.</div>`;

  m.innerHTML = `<div class="help">Removing a folder or a label never removes the
      notes in it — they go back to Unfiled, and the removal can be undone.</div>
    <div class="sect">Folders</div>
    ${rowsFor('noteFolders', noteFolders(),
       id => all.filter(n => n.folderId === id).length, 'folder')}
    <button class="btn alt" onclick="newNoteGroup('noteFolders')">${ico('plus')}New folder</button>
    <div class="sect">Labels</div>
    ${rowsFor('noteLabels', noteLabels(),
       id => all.filter(n => (n.labelIds || []).includes(id)).length, 'label')}
    <button class="btn alt" onclick="newNoteGroup('noteLabels')">${ico('plus')}New label</button>`;
}
function newNoteGroup(coll){
  const name = prompt(coll === 'noteFolders' ? 'Name for the new folder' : 'Name for the new label');
  if(name === null) return;
  if(!addNoteGroup(coll, name)){ toast('That needs a name'); return; }
  render();
}
function renameNoteGroupUI(coll, id){
  const row = (S[coll] || []).find(x => x.id === id);
  if(!row) return;
  const name = prompt('Rename “' + row.name + '” to', row.name);
  if(name === null) return;                       // cancelled
  // An empty rename CANCELS. It never blanks the name -- the same rule the list
  // rename follows, and for the same reason: a blank is never what was meant.
  if(!renameNoteGroup(coll, id, name)){ toast('A name cannot be empty'); return; }
  render();
}

function renderNoteDetail(m){""")

# ============================================================ 4. the bridge
rep(p, """  keepOnlyEvent,
  keepOnlyInClash,""",
"""  addNoteGroup,
  clearNoteFilters,
  delNoteGroup,
  keepOnlyEvent,
  keepOnlyInClash,""")

rep(p, """  removeSelectedClash,
  selectAllClash,""",
"""  newNoteGroup,
  newNoteGroupFor,
  removeSelectedClash,
  renameNoteGroupUI,
  selectAllClash,
  setNoteFolder,
  setNoteFolderFilter,
  toggleNoteLabel,
  toggleNoteLabelFilter,""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
for path, text in buf.items():
    open(path, 'w').write(text)
print('notes folders+labels UI wired ->', ', '.join(sorted(buf)))
