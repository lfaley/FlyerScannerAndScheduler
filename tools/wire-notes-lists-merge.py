#!/usr/bin/env python3
"""v9.61 - Lists moves under the Notes tab. Back to five tabs.

Logan, 28 Aug: "Lets do a tab of notes that has a two areas. one is notes and
the other is lists. this gets us to give options and lists are a type of note."

He is right about the model. A shopping list and a note about uniform sizes are
the same kind of object -- something you jotted that is not a date -- and the
app already treated them that way: renderLists picks the `note` icon for any
list that is not obviously groceries (index.html, the `emoji` line).

WHAT THIS IS NOT

Nothing is removed. Every list function -- add, rename, open, add item, edit
item, check, clear checked, delete -- is untouched and reached in the same
number of taps as before: one tap on the tab, one tap on the segment. What
changes is which tab they hang off (CLAUDE.md rule 1).

Measured before deciding: at Logan's width (393px) six tabs were 65.5px wide
against five at 78.5px, and nothing clipped at any width down to 320px. So this
change is not a fix for a layout bug -- it buys back 13px per tab and returns
the bar to the 3-5 destinations both Apple's HIG and Material call for.

DESIGN NOTES

* The chosen area is REMEMBERED (`settings.notesArea`), so tapping the tab
  returns you to whichever half you were last using. A segment that always
  snaps back to "Notes" would tax the person who mostly uses lists, every time.
  It is a preference with a visible two-way control -- not a suppression flag,
  so it does not join the one-way doors in CODE-REVIEW-PLAN.md P6.

* `nav('lists')` still works. It is a name people use, the router emits it, and
  the a11y audit calls it; dropping it would land those callers on a blank
  screen, since `view.tab` would name a screen the `tabs` map no longer has.
  It is translated, not deleted.

* `open_screen` gains 'notes' as a target so "take me to my notes" validates.
  The enum is declared twice -- js/intents.js is the source, index.html carries
  the inlined copy -- and a drift test fails the build if they disagree.

* The header says which AREA you are in ("Notes" / "Lists") while the tab says
  Notes. The tab names the section; the header names the screen.

* The segment is <button>, not <span onclick>. The v9.12 review found bare
  spans-as-controls on Edit Event and they were a real defect; `.chip` gains
  `font-family:inherit` so a real button still looks like the existing chips.
"""
import sys

fail = []
buf = {}

def _get(path):
    if path not in buf:
        buf[path] = open(path).read()
    return buf[path]

# Buffered: NOTHING is written until every replacement has matched. A partial
# rewrite across three files is worse than no rewrite at all.
def rep_in(path, o, n, c=1):
    src = _get(path)
    got = src.count(o)
    if got != c:
        fail.append(f'{path}: expected {c}x {o[:80]!r}, found {got}')
        return
    buf[path] = src.replace(o, n)

p = 'index.html'

# ============================================== 0. a real button looks like a chip
rep_in('css/components.css',
"""    font-size:var(--t-sm);font-weight:600;margin:0 var(--s2) var(--s2) 0;""",
"""    font-size:var(--t-sm);font-weight:600;font-family:inherit;margin:0 var(--s2) var(--s2) 0;""")

# ============================================== 1. the remembered area
rep_in(p,
"""    aiEnabled:true, assistantTone:'professional', dismissedConflicts:[], theme:'dark' },""",
"""    aiEnabled:true, assistantTone:'professional', dismissedConflicts:[], theme:'dark',
    notesArea:'notes' },""")

# ============================================== 2. five tabs again
rep_in(p,
"""  {id:'lists',  label:'Lists',  ic:ico('cart'), title:'Lists'},
  {id:'notes',  label:'Notes',  ic:ico('note'), title:'Notes'},""",
"""  // Lists lives INSIDE Notes as of v9.61 -- see renderNotes. It keeps the slot
  // Lists held, so the muscle memory for "third tab" still lands in the right
  // place.
  {id:'notes',  label:'Notes',  ic:ico('note'), title:'Notes'},""")

rep_in(p,
"""  const tabs = {events:renderEvents, chores:renderChores, lists:renderLists,
    notes:renderNotes, meals:renderMeals, settings:renderSettings};""",
"""  const tabs = {events:renderEvents, chores:renderChores,
    notes:renderNotes, meals:renderMeals, settings:renderSettings};""")

# ============================================== 3. nav() keeps 'lists' working
rep_in(p,
"""function nav(tab){ closeSheet(); askOrigin = null; view = {tab, sub:null, data:null}; withTransition(render); }""",
"""function nav(tab){
  closeSheet(); askOrigin = null;
  // 'lists' was a tab of its own until v9.61 and is still the name people, the
  // router and the a11y audit use. Translate it instead of stranding the caller
  // on a view.tab that the `tabs` map no longer answers to.
  if(tab === 'lists'){
    if(S.settings) S.settings.notesArea = 'lists';
    tab = 'notes';
  }
  view = {tab, sub:null, data:null};
  withTransition(render);
}""")

# ============================================== 4. the assistant can say "notes"
for path in ('index.html', 'js/intents.js'):
    rep_in(path,
"""    params: { screen: { type:'enum', required:true,
                        values:['events','chores','lists','meals','settings'] } },""",
"""    params: { screen: { type:'enum', required:true,
                        values:['events','chores','lists','notes','meals','settings'] } },""")

rep_in(p,
"""  if(route.consequence === CONSEQUENCE.NAVIGATE){
    const target = route.params.screen;
    setTimeout(() => nav(target), 350);""",
"""  if(route.consequence === CONSEQUENCE.NAVIGATE){
    const target = route.params.screen;
    // Both halves of the Notes tab are addressable by name. Asking for notes
    // must not drop you on lists just because that is where you were last.
    if(target === 'notes' || target === 'lists'){
      S.settings.notesArea = target === 'lists' ? 'lists' : 'notes';
      save();
    }
    setTimeout(() => nav(target), 350);""")

# ============================================== 5. the two-area screen
rep_in(p,
"""function renderNotes(m){
  setHeader('Notes', false);
  const all = liveNotes();""",
"""function notesArea(){ return (S.settings && S.settings.notesArea === 'lists') ? 'lists' : 'notes'; }
function setNotesArea(a){
  S.settings.notesArea = (a === 'lists') ? 'lists' : 'notes';
  save(); render();
}

/**
 * The Notes tab: two areas, one tab. Lists ARE notes -- a jotted thing that is
 * not a date -- which is why renderLists already picked the `note` icon for any
 * list that was not obviously groceries.
 *
 * This function owns the header and the switcher; each area renders its own
 * body below. renderLists is unchanged apart from no longer setting the header,
 * so nothing about lists behaves differently.
 */
function renderNotes(m){
  const area = notesArea();
  setHeader(area === 'lists' ? 'Lists' : 'Notes', false);
  const seg = `<div class="filterbar" style="margin-bottom:10px">
    <button class="chip ${area === 'notes' ? 'on' : ''}" aria-pressed="${area === 'notes'}"
      onclick="setNotesArea('notes')">${ico('note')}Notes</button>
    <button class="chip ${area === 'lists' ? 'on' : ''}" aria-pressed="${area === 'lists'}"
      onclick="setNotesArea('lists')">${ico('cart')}Lists</button>
  </div>`;
  if(area === 'lists'){
    const inner = { innerHTML:'' };
    renderLists(inner);
    m.innerHTML = seg + inner.innerHTML;
    return;
  }
  const inner = { innerHTML:'' };
  renderNotesBoard(inner);
  m.innerHTML = seg + inner.innerHTML;
}

function renderNotesBoard(m){
  const all = liveNotes();""")

# The board no longer owns the header, and onNoteSearch must re-render the
# WHOLE tab -- rendering only the board would drop the switcher off the screen.
rep_in(p,
"""  renderNotes(document.getElementById('main'));
  const again = document.getElementById('noteSearch');""",
"""  renderNotes(document.getElementById('main'));   // whole tab: the switcher too
  const again = document.getElementById('noteSearch');""")

rep_in(p,
"""function renderLists(m){
  setHeader('Lists', false);
  const lists = S.lists.filter(l=>!l.deleted);""",
"""// The header is set by renderNotes, which owns this screen as of v9.61.
function renderLists(m){
  const lists = S.lists.filter(l=>!l.deleted);""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
for path, text in buf.items():
    open(path, 'w').write(text)
print('notes/lists merge wired ->', ', '.join(sorted(buf)))
