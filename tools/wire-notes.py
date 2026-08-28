#!/usr/bin/env python3
"""v9.60 part 2 - Notes. A sixth tab, shaped like Lists.

Logan, 27 Aug: "need a menu like lists but its 'notes' ... note taking/note app
functionality on the internet. scaffold and code."

RESEARCH (what the feature set is based on, not invented)

  * Google Keep, mechanics confirmed from Computerworld's cheat sheet and
    arekore's guide: no save button (closing saves); a title line above the
    body; a pin that "prioritizes the note toward the top", with pinned and
    unpinned shown as "two clearly separated groups"; search across "the titles
    and body text of all your notes at once"; archive and Trash as SEPARATE
    states, trash purging after 7 days.
  * NN/g, "User Control and Freedom": a user "should be able to easily undo"
    a change, and needs "a clearly marked emergency exit".
  * Apple Notes, from the same teardown: folders and search; its organising
    idea is structure where Keep's is labels.

WHAT WAS TAKEN, AND WHAT WAS DELIBERATELY LEFT OUT

Taken: quick capture, autosave with no save button, optional title with the
first body line as the fallback, pin-to-top as two separated groups, search over
title and body, and a recoverable delete.

Left out, on purpose:

  * ARCHIVE. Keep has archive AND delete -- two suppression states with
    different rules. FlyerSnap already has exactly one (`deleted`, soft, pruned,
    undoable). Adding a second would be two truths for "not on the board", which
    is the defect class CODE-REVIEW-PLAN.md P3 exists to remove. Pin covers the
    "keep this prominent" half; delete covers the other half.
  * A 7-DAY TRASH SCREEN. Same reason: the app's deletion story is softDelete +
    an Undo toast + manualPrune, and it is already tested. A notes-only trash
    would be a second deletion mechanism.
  * LABELS. FlyerSnap already has an organising axis used on every other object
    -- people. A note reuses `personIds` and the existing chips, so a note about
    Braelyn filters the same way an event about Braelyn does. Inventing a
    parallel tag system would be the same two-truths mistake.
  * SENDING NOTES TO THE MODEL. buildAskPrompt receives events, chores, lists
    and star balances. Notes are deliberately NOT added: they are the most
    likely place in the app for something private, and quietly shipping them to
    a model -- even a local one -- is not a decision to make silently. If Logan
    wants Gordon to read notes, that is a separate, opted-in change.

DESIGN NOTES

  * Autosave, not a Save button. Keep has none. The body writes on a 400ms
    debounce and flushes on blur and on Done, so a note is never lost by tapping
    back. render() is NOT called on keystroke -- it replaces #main and would
    destroy focus and the caret mid-word.
  * Title falls back to the first non-empty body line, so quick capture needs no
    title at all and the list still reads properly.
  * Delete uses softDelete(), giving NN/g's undo for free.
  * A sixth tab, rather than a segment inside Lists. Logan asked for "a menu
    like lists" -- a peer, not a child -- and burying it inside Lists is exactly
    the discoverability defect the watched-senders screen already demonstrated.
    Reversible in one line if the tab bar proves too tight on a phone.
"""
import sys

p = 'index.html'
src = open(p).read()
fail = []

def rep(o, n, c=1):
    global src
    got = src.count(o)
    if got != c:
        fail.append(f'expected {c}x {o[:90]!r}, found {got}')
        return
    src = src.replace(o, n)

# ============================================================ 1. saved shape
rep("""  redemptions:[], lists:[], listItems:[], ask:{ turns:[] }, aiLog:[],""",
"""  redemptions:[], lists:[], listItems:[], notes:[], ask:{ turns:[] }, aiLog:[],""")

# ============================================================ 2. migration
MIG_OLD = """  s.schemaVersion = SCHEMA_VERSION;
  return s;
}"""
MIG_NEW = """  if(from < 8){
    // Notes arrived in v9.60. blank() already provides `notes: []` and load()
    // merges onto blank(), so an old save gets the empty array for free -- this
    // block exists for the case blank() cannot cover: a save whose `notes` key
    // exists but is not an array (hand-edited file, a truncated import, a
    // restore from a future version). Coercing here is cheaper than making
    // every reader defensive, and it destroys nothing that was ever usable.
    if(!Array.isArray(s.notes)) s.notes = [];
  }

  s.schemaVersion = SCHEMA_VERSION;
  return s;
}"""
rep(MIG_OLD, MIG_NEW)
rep("const SCHEMA_VERSION = 7;", "const SCHEMA_VERSION = 8;")

# ============================================================ 3. the tab
rep("""  {id:'lists',  label:'Lists',  ic:ico('cart'), title:'Lists'},""",
"""  {id:'lists',  label:'Lists',  ic:ico('cart'), title:'Lists'},
  {id:'notes',  label:'Notes',  ic:ico('note'), title:'Notes'},""")

rep("""  const tabs = {events:renderEvents, chores:renderChores, lists:renderLists,
    meals:renderMeals, settings:renderSettings};""",
"""  const tabs = {events:renderEvents, chores:renderChores, lists:renderLists,
    notes:renderNotes, meals:renderMeals, settings:renderSettings};""")

rep("""    listDetail:renderListDetail, recipeBox:renderRecipeBox, recipeForm:renderRecipeForm,""",
"""    listDetail:renderListDetail, noteDetail:renderNoteDetail,
    recipeBox:renderRecipeBox, recipeForm:renderRecipeForm,""")

# ============================================================ 4. pruning
rep("""  S.listItems = S.listItems.filter(i => !i.deleted);          // no date; drop on prune""",
"""  S.listItems = S.listItems.filter(i => !i.deleted);          // no date; drop on prune
  S.notes = (S.notes || []).filter(n => !n.deleted);          // ditto""")
rep("""  const before = S.events.length + S.listItems.length + S.lists.length +
                 S.chores.length + S.rewards.length + S.kids.length;""",
"""  const before = S.events.length + S.listItems.length + S.lists.length +
                 (S.notes || []).length +
                 S.chores.length + S.rewards.length + S.kids.length;""")
rep("""  removed += before - (S.events.length + S.listItems.length + S.lists.length +
                       S.chores.length + S.rewards.length + S.kids.length);""",
"""  removed += before - (S.events.length + S.listItems.length + S.lists.length +
                       (S.notes || []).length +
                       S.chores.length + S.rewards.length + S.kids.length);""")

# ============================================================ 5. the screens
rep("""// ---------- Cross-app exchange (recipe app) ----------""",
"""// ---------- Notes (v9.60) ----------
// Shaped like Lists on purpose: a board of cards, tap to open, one input at the
// top to add. See tools/wire-notes.py for what was taken from Keep and Apple
// Notes and, more importantly, what was deliberately left out.

let noteSearch = '';
let noteSaveTimer = null;

/**
 * What the board and the header call a note.
 *
 * Keep gives a note a dedicated title line; Apple Notes derives one from the
 * first line of the body. Doing BOTH means quick capture needs no title at all
 * and the board still reads properly -- an explicit title wins when there is
 * one, otherwise the first non-empty body line stands in.
 */
function noteTitleOf(n){
  const t = String((n && n.title) || '').trim();
  if(t) return t;
  const first = String((n && n.body) || '').split('\\n').map(s => s.trim()).find(Boolean);
  return first || 'Untitled note';
}
function notePreviewOf(n){
  const body = String((n && n.body) || '');
  const lines = body.split('\\n').map(s => s.trim()).filter(Boolean);
  // If the title was borrowed from line one, previewing line one again would
  // print the same words twice.
  const rest = (n && String(n.title || '').trim()) ? lines : lines.slice(1);
  return rest.join(' ').slice(0, 120);
}
function liveNotes(){ return (S.notes || []).filter(n => !n.deleted); }

// Keep searches "the titles and body text of all your notes at once". People
// are included because they are this app's labels.
function noteMatches(n){
  const q = noteSearch.trim().toLowerCase();
  if(!q) return true;
  const who = (n.personIds || []).map(id => (allPeople().find(p => p.id === id) || {}).name)
    .filter(Boolean).join(' ');
  return [n.title, n.body, who].filter(Boolean).join(' ').toLowerCase().includes(q);
}

function renderNotes(m){
  setHeader('Notes', false);
  const all = liveNotes();
  const shown = all.filter(noteMatches);
  // Newest edit first inside each group; pinned and unpinned are rendered as
  // two clearly separated groups, which is how Keep presents them.
  const byRecent = (a, b) => String(b.updated || '').localeCompare(String(a.updated || ''));
  const pinned = shown.filter(n => n.pinned).sort(byRecent);
  const rest   = shown.filter(n => !n.pinned).sort(byRecent);

  let html = `<div class="card"><div class="formrow" style="margin:0">
    <input type="text" id="newNote" aria-label="Take a note" placeholder="Take a note…"
      onkeydown="if(event.key==='Enter')newNote()">
    <button class="btn sm" onclick="newNote()">Add</button></div></div>`;

  // Search only earns its space once there is enough to sift through -- the
  // same threshold the events screen uses.
  if(all.length > 5 || noteSearch){
    html += `<div class="formrow" style="margin-bottom:10px">
      <input type="text" id="noteSearch" aria-label="Search notes" placeholder="Search notes"
        value="${esc(noteSearch)}" oninput="onNoteSearch(this.value)" autocapitalize="none">
      ${noteSearch ? `<button class="btn alt" style="width:auto" onclick="clearNoteSearch()">Clear</button>` : ''}
    </div>`;
  }

  if(!all.length){
    html += emptyState('note', 'No notes yet',
      'Anything that is not a date and not a shopping list — the school office number, what the coach said, sizes for uniforms.');
    m.innerHTML = html; return;
  }
  if(!shown.length){
    html += `<div class="empty"><div class="eb">Nothing matches “${esc(noteSearch)}”.</div></div>`;
    m.innerHTML = html; return;
  }

  const card = (n) => {
    const preview = notePreviewOf(n);
    const who = eventPeople(n);
    return `<div class="card row" onclick="openNote('${n.id}')">
      <div class="grow">
        <div class="title">${esc(noteTitleOf(n))}</div>
        ${preview ? `<div class="meta" style="font-size:12px">${esc(preview)}</div>` : ''}
        <div class="meta" style="font-size:11px">${n.updated ? 'edited ' + friendly(String(n.updated).slice(0,10)) : ''}${who.length ? ' · ' + esc(who.map(p=>p.name).join(', ')) : ''}</div>
      </div>
      <button class="linkbtn" style="padding:4px" onclick="event.stopPropagation();togglePinNote('${n.id}')">${n.pinned ? 'Unpin' : 'Pin'}</button>
    </div>`;
  };

  if(pinned.length){
    html += `<div class="sect">Pinned</div>` + pinned.map(card).join('');
    if(rest.length) html += `<div class="sect">Others</div>`;
  }
  html += rest.map(card).join('');
  m.innerHTML = html;
}

// Same caret-preserving pattern as onEventSearch: render() replaces #main, so
// the field has to be found again and the selection restored, or typing loses
// its place after every character.
function onNoteSearch(v){
  noteSearch = v;
  const box = document.getElementById('noteSearch');
  const caret = box ? box.selectionStart : null;
  renderNotes(document.getElementById('main'));
  const again = document.getElementById('noteSearch');
  if(again){
    again.focus();
    if(caret !== null){ try{ again.setSelectionRange(caret, caret); }catch(e){} }
  }
}
function clearNoteSearch(){ noteSearch = ''; render(); }

function newNote(){
  const box = document.getElementById('newNote');
  const seed = box ? box.value.trim() : '';
  const now = new Date().toISOString();
  const n = { id:uid(), title:'', body:seed, pinned:false, personIds:[],
    created:now, updated:now, deleted:false };
  if(!S.notes) S.notes = [];
  S.notes.unshift(n);
  save();
  sub('noteDetail', {id:n.id});
}
function openNote(id){ sub('noteDetail', {id}); }

function togglePinNote(id){
  const n = (S.notes || []).find(x => x.id === id);
  if(!n) return;
  n.pinned = !n.pinned;
  save(); render();
  toast(n.pinned ? 'Pinned to the top' : 'Unpinned');
}

function delNote(id){
  const n = (S.notes || []).find(x => x.id === id);
  if(!n) return null;
  flushNote();                       // do not let a pending autosave resurrect it
  const undo = softDelete('notes', id, '“' + noteTitleOf(n) + '”');
  view = {tab:'notes', sub:null, data:null};
  render();
  return undo;
}

/**
 * Autosave. Keep has no save button -- closing a note saves it -- so neither
 * does this.
 *
 * render() is NOT called here: it replaces #main, which would destroy focus and
 * the caret in the middle of a word. The board picks the new text up on the
 * next real navigation.
 */
function noteEdited(id){
  if(noteSaveTimer) clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(() => { noteSaveTimer = null; writeNote(id); }, 400);
}
function writeNote(id){
  const n = (S.notes || []).find(x => x.id === id);
  if(!n) return;
  const t = document.getElementById('noteTitle');
  const b = document.getElementById('noteBody');
  if(!t && !b) return;               // the screen is gone; nothing to read
  const title = t ? t.value : n.title;
  const body  = b ? b.value : n.body;
  if(title === n.title && body === n.body) return;
  n.title = title; n.body = body;
  n.updated = new Date().toISOString();
  save();
}
// Called on blur and on Done. A debounce that has not fired yet is a write that
// has not happened, and tapping back must not be how a note is lost.
function flushNote(){
  if(noteSaveTimer){ clearTimeout(noteSaveTimer); noteSaveTimer = null; }
  if(view && view.sub === 'noteDetail' && view.data) writeNote(view.data.id);
}
function doneNote(){ flushNote(); view = {tab:'notes', sub:null, data:null}; render(); }

function toggleNotePerson(id, personId){
  const n = (S.notes || []).find(x => x.id === id);
  if(!n) return;
  if(!Array.isArray(n.personIds)) n.personIds = [];
  const at = n.personIds.indexOf(personId);
  if(at >= 0) n.personIds.splice(at, 1); else n.personIds.push(personId);
  n.updated = new Date().toISOString();
  save();
  // Re-render just this screen and put the caret back, so tagging mid-sentence
  // does not throw away where you were.
  const b = document.getElementById('noteBody');
  const caret = b ? b.selectionStart : null;
  renderNoteDetail(document.getElementById('main'));
  const again = document.getElementById('noteBody');
  if(again && caret !== null){ again.focus(); try{ again.setSelectionRange(caret, caret); }catch(e){} }
}

function renderNoteDetail(m){
  const n = (S.notes || []).find(x => x.id === (view.data || {}).id);
  if(!n || n.deleted){
    // The note was deleted from another surface, or an undo was not taken.
    // A missing note is a state to handle, not a crash.
    setHeader('Notes', true);
    m.innerHTML = `<div class="empty"><div class="et">That note is gone</div>
      <div class="eb">It was deleted. Nothing else was changed.</div></div>`;
    return;
  }
  setHeader(noteTitleOf(n), true);
  const people = allPeople();
  m.innerHTML = `
    <div class="card">
      <input type="text" id="noteTitle" aria-label="Note title" placeholder="Title (optional)"
        value="${esc(n.title || '')}" oninput="noteEdited('${n.id}')" onblur="flushNote()"
        style="font-weight:700;margin-bottom:8px">
      <textarea id="noteBody" aria-label="Note" rows="12" placeholder="Write anything…"
        oninput="noteEdited('${n.id}')" onblur="flushNote()"
        style="width:100%;resize:vertical">${esc(n.body || '')}</textarea>
      <div class="help" style="font-size:12px">Saved as you type. No title? The first line becomes one.</div>
    </div>
    ${people.length ? `<div class="card">
      <div class="label" style="margin-bottom:6px">Who is this about?</div>
      ${people.map(p => `<span class="chip" style="${(n.personIds||[]).includes(p.id)?`background:${p.color};border-color:${p.color};color:var(--on-accent)`:''}"
        onclick="toggleNotePerson('${n.id}','${p.id}')">${esc(p.name)}</span>`).join('')}
    </div>` : ''}
    <div class="card row">
      <div class="grow meta" style="font-size:12px">${n.updated ? 'Last edited ' + friendly(String(n.updated).slice(0,10)) : ''}</div>
      <button class="linkbtn" onclick="togglePinNote('${n.id}')">${n.pinned ? 'Unpin' : 'Pin to top'}</button>
    </div>
    <button class="btn alt" style="border-color:var(--red-accent);color:var(--red-accent)"
      onclick="delNote('${n.id}')">${ico('trash')}Delete note</button>
    <div style="height:8px"></div>
    <button class="btn" onclick="doneNote()">Done</button>`;
}

// ---------- Cross-app exchange (recipe app) ----------""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
open(p, 'w').write(src)
print('notes wired')
