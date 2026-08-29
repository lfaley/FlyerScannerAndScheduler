#!/usr/bin/env python3
"""v9.71 - notes get folders AND labels (NOTES-PLAN.md phase 1).

Logan asked for grouping in notes, the research went to nine apps, and he chose
Apple's model: ONE folder says where a note lives, ANY NUMBER of labels say what
it is about. See NOTES-RESEARCH.md for the sources and NOTES-PLAN.md for the
shape being built.

WHY ENTITIES AND NOT STRINGS

  S.noteFolders = [{ id, name, deleted }]
  S.noteLabels  = [{ id, name, deleted }]
  note.folderId = id | null        note.labelIds = [id, ...]

Storing the NAME on the note would make a rename a rewrite of every note that
used it, and a typo would silently fork one group into two. Ids make a rename
free and make orphaning impossible to express. It is the same reasoning the app
already applies to people, and reusing that shape means one mental model rather
than two.

DELETING A CONTAINER NEVER DELETES ITS CONTENTS

A folder delete sets its notes back to Unfiled; a label delete drops the id from
every note. Both are reversible, and neither touches n.deleted. This is CLAUDE.md
rule 26 read forwards: an action whose name says "folder" must not turn out to
have meant "and the eleven notes in it".

SCHEMA 8 -> 9. The migration only ensures shapes -- it invents no folders and no
labels, so every existing note lands as Unfiled with none, which is exactly what
it is today. js/migrate.js and the inlined copy both change; the drift test is
what makes sure they stay the same.
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

# ==================================================================== schema
rep(p, """const SCHEMA_VERSION = 8;""", """const SCHEMA_VERSION = 9;""")

MIGRATION = """  if(from < 9){
    // Notes gained folders and labels (v9.71). Apple's model: one folder says
    // WHERE a note lives, any number of labels say WHAT IT IS ABOUT.
    //
    // This block invents nothing. It creates no folders and no labels, so every
    // existing note lands as Unfiled with none -- which is precisely what it is
    // today. All it does is guarantee the shapes every reader now assumes, so
    // that a hand-edited file or a restore from an older export cannot reach
    // the render path with `labelIds` as a string.
    if(!Array.isArray(s.noteFolders)) s.noteFolders = [];
    if(!Array.isArray(s.noteLabels)) s.noteLabels = [];
    (s.notes || []).forEach(n => {
      if(!n) return;
      if(typeof n.folderId !== 'string') n.folderId = null;
      if(!Array.isArray(n.labelIds)) n.labelIds = [];
      if(typeof n.color !== 'string') n.color = '';
      if(typeof n.archived !== 'boolean') n.archived = false;
    });
  }

"""
rep(p, """  s.schemaVersion = SCHEMA_VERSION;
  return s;
}""", MIGRATION + """  s.schemaVersion = SCHEMA_VERSION;
  return s;
}""")

rep(p, """  redemptions:[], lists:[], listItems:[], notes:[], ask:{ turns:[] }, aiLog:[],""",
    """  redemptions:[], lists:[], listItems:[], notes:[], noteFolders:[], noteLabels:[],
  ask:{ turns:[] }, aiLog:[],""")

# ==================================================================== model
rep(p, """function liveNotes(){ return (S.notes || []).filter(n => !n.deleted); }""",
"""function liveNotes(){ return (S.notes || []).filter(n => !n.deleted); }

// ---- folders (one per note) and labels (many per note) --------------------
// Two collections, one shape, so every helper below is written once and reads
// which one it is working on. `coll` is 'noteFolders' or 'noteLabels'.
function noteFolders(){ return (S.noteFolders || []).filter(f => !f.deleted); }
function noteLabels(){ return (S.noteLabels || []).filter(l => !l.deleted); }
function noteFolderName(id){
  const f = (S.noteFolders || []).find(x => x.id === id);
  return f && !f.deleted ? f.name : '';
}
function noteLabelsOf(n){
  const ids = (n && n.labelIds) || [];
  return noteLabels().filter(l => ids.includes(l.id));
}

/**
 * Add a folder or a label. Returns the row, or the EXISTING row when the name
 * is already taken -- case- and space-insensitively.
 *
 * Silently reusing rather than creating a near-duplicate is the one mitigation
 * that matters for the failure mode every long-term tag user reports: "school"
 * and "School " sitting side by side, splitting a group in half. Nothing else
 * in the app can prevent that, because nothing else sees both names at once.
 */
function addNoteGroup(coll, name){
  const clean = String(name || '').trim().slice(0, 40);
  if(!clean) return null;
  if(!Array.isArray(S[coll])) S[coll] = [];
  const key = clean.toLowerCase();
  const dup = S[coll].find(x => String(x.name || '').trim().toLowerCase() === key);
  if(dup){
    if(dup.deleted){ dup.deleted = false; save(); }   // a re-add un-deletes
    return dup;
  }
  const row = { id:uid(), name:clean, deleted:false };
  S[coll].push(row);
  save();
  return row;
}
function renameNoteGroup(coll, id, name){
  const clean = String(name || '').trim().slice(0, 40);
  const row = (S[coll] || []).find(x => x.id === id);
  if(!row || !clean) return false;    // an empty rename CANCELS; it never blanks
  row.name = clean;
  save();
  return true;
}

/**
 * Remove a folder or a label WITHOUT removing anything it contained.
 *
 * A folder delete puts its notes back to Unfiled; a label delete drops the id.
 * Neither touches n.deleted -- deleting a container must never turn out to have
 * meant "and everything in it" (CLAUDE.md rule 26, read forwards). The undo
 * restores both the row and every note's membership.
 */
function delNoteGroup(coll, id){
  const row = (S[coll] || []).find(x => x.id === id);
  if(!row || row.deleted) return;
  const isFolder = coll === 'noteFolders';
  const touched = (S.notes || []).filter(n => isFolder
    ? n.folderId === id
    : Array.isArray(n.labelIds) && n.labelIds.includes(id));

  row.deleted = true;
  touched.forEach(n => {
    if(isFolder) n.folderId = null;
    else n.labelIds = n.labelIds.filter(x => x !== id);
  });
  if(noteFolderFilter === id) noteFolderFilter = null;
  noteLabelFilter.delete(id);
  save(); render();
  const what = isFolder ? 'Folder' : 'Label';
  toast(what + ' “' + row.name + '” removed'
        + (touched.length ? ' — ' + touched.length + ' note' + (touched.length === 1 ? '' : 's') + ' kept' : ''),
    { label:'Undo', fn:() => {
      row.deleted = false;
      touched.forEach(n => {
        if(isFolder) n.folderId = id;
        else if(!n.labelIds.includes(id)) n.labelIds.push(id);
      });
      save(); render(); toast('Put back');
    }});
}

function setNoteFolder(noteId, folderId){
  const n = (S.notes || []).find(x => x.id === noteId);
  if(!n) return;
  n.folderId = folderId || null;
  n.updated = new Date().toISOString();
  save();
  renderNoteDetail(document.getElementById('main'));
}
function toggleNoteLabel(noteId, labelId){
  const n = (S.notes || []).find(x => x.id === noteId);
  if(!n) return;
  if(!Array.isArray(n.labelIds)) n.labelIds = [];
  const at = n.labelIds.indexOf(labelId);
  if(at >= 0) n.labelIds.splice(at, 1); else n.labelIds.push(labelId);
  n.updated = new Date().toISOString();
  save();
  // Same caret-preserving re-render as toggleNotePerson: labelling mid-sentence
  // must not throw away where you were.
  const b = document.getElementById('noteBody');
  const caret = b ? b.selectionStart : null;
  renderNoteDetail(document.getElementById('main'));
  const again = document.getElementById('noteBody');
  if(again && caret !== null){ again.focus(); try{ again.setSelectionRange(caret, caret); }catch(e){} }
}

// ---- the board filter -----------------------------------------------------
// View state, never on S: a Set would serialise to {} and ship in a backup, and
// "which folder am I looking at" is not the user's data. Same rule as
// problemSel (v9.39) and clashSel (v9.70).
let noteFolderFilter = null;          // null = every folder; '' = Unfiled only
let noteLabelFilter = new Set();

function setNoteFolderFilter(id){
  noteFolderFilter = (noteFolderFilter === id) ? null : id;
  render();
}
function toggleNoteLabelFilter(id){
  if(noteLabelFilter.has(id)) noteLabelFilter.delete(id); else noteLabelFilter.add(id);
  render();
}
function clearNoteFilters(){ noteFolderFilter = null; noteLabelFilter = new Set(); render(); }
function noteFiltersOn(){ return noteFolderFilter !== null || noteLabelFilter.size > 0; }

/**
 * Does this note pass the folder and label filters?
 *
 * Labels are ANDed. Two labels ticked means "notes about both", which is the
 * only reading that lets a filter NARROW as you add to it -- an OR would make
 * every extra tap return more, which reads as the control not working.
 */
function notePassesFilter(n){
  if(noteFolderFilter !== null){
    const want = noteFolderFilter || null;
    if((n.folderId || null) !== want) return false;
  }
  if(noteLabelFilter.size){
    const has = new Set(n.labelIds || []);
    for(const id of noteLabelFilter) if(!has.has(id)) return false;
  }
  return true;
}""")

# Search reaches folder and label names too -- a name you can see on the card is
# a name you will type into the box.
rep(p, """  const who = (n.personIds || []).map(id => (allPeople().find(p => p.id === id) || {}).name)
    .filter(Boolean).join(' ');
  return [n.title, n.body, who].filter(Boolean).join(' ').toLowerCase().includes(q);""",
"""  const who = (n.personIds || []).map(id => (allPeople().find(p => p.id === id) || {}).name)
    .filter(Boolean).join(' ');
  // Folder and label names are searchable too. They are on the card, and a name
  // you can read is a name you will type into the box expecting it to work.
  const where = noteFolderName(n.folderId);
  const what = noteLabelsOf(n).map(l => l.name).join(' ');
  return [n.title, n.body, who, where, what].filter(Boolean).join(' ')
    .toLowerCase().includes(q);""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
for path, text in buf.items():
    open(path, 'w').write(text)
print('notes folders+labels model wired ->', ', '.join(sorted(buf)))
