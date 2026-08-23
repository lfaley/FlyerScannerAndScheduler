#!/usr/bin/env python3
"""v9.28 - an event can be typed in by hand.

FLYERSNAP-FIXES-PLAN.md left FS-UI-04 behind a decision gate: does manual event
entry exist, or is it only undiscoverable? Verified on disk at f60f09a, the
answer was that it does not exist at all:

  * `S.events.push` occurs at exactly ONE site (the review/save flow for
    AI-extracted `pendingEvents`), so every event in the app came from the AI.
  * `openEventEdit(id)` does `S.events.find(x => x.id === id)` and immediately
    dereferences `e.title` -- it REQUIRES an existing event, and its one caller
    is an "Edit event" action on a row that already exists.
  * Chores have `saveChoreForm()` and lists have their own add box. Events were
    the only one of the three with no hand-entry path.

And it compounds. A fresh install defaults to `aiProvider:'anthropic'` with an
empty `localBaseUrl`, so with no API key a new user could not create an event by
scanning (needs AI), by asking Gordon (add_event routes through the model), or
by typing (no form). The app's primary object was unreachable.

Logan approved building it, 23 Aug.

DESIGN NOTES

`eventForm.saved` was a two-state flag: true = editing a saved event, false =
editing an extracted one. A third mode is added as its OWN boolean rather than
by overloading that flag, because `if(f.saved)` would treat a string like 'new'
as truthy and send it into `S.events.find(x => x.id === null)`.

Two entry points, both reusing patterns already in the app rather than adding a
mechanism:
  1. The "Add Paperwork" screen, as a final row after the AI-powered sources --
     it is already the "add something" screen, and typing it in is just another
     source. Placed LAST so it does not compete with the primary action.
  2. The Events empty state's `cta` slot, which was going unused. NN/g's
     empty-state guidance is that a first-use empty state should teach the
     primary action; with no key the AI path is not available, so this is the
     only action that works.
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

# --------------------------------------------------------------- 1. the opener
rep("""function openPendingEdit(i){""",
"""/**
 * A blank event, typed by hand. The one path to an event that needs no AI.
 *
 * `isNew` is its own flag rather than a third value for `saved`, which is a
 * boolean the save and cancel handlers already branch on -- 'new' would be
 * truthy there and would look up an event id that does not exist.
 *
 * The date defaults to today because that is overwhelmingly what a hand-typed
 * event is for, and the field shows the value plainly so it cannot be saved
 * unnoticed. The validator still refuses an empty or malformed one.
 */
function openNewEvent(){
  eventForm = { isNew:true, saved:false, ref:null, title:'', date:todayISO(),
    time:'', endTime:'', location:'', notes:'', kind:'event', personIds:[] };
  sub('eventEdit');
}

function openPendingEdit(i){""")

# --------------------------------------------------------------- 2. the header
rep("""    + `<h1 class="htitle">Edit Event</h1>`""",
"""    + `<h1 class="htitle">${eventForm && eventForm.isNew ? 'New Event' : 'Edit Event'}</h1>`""")

# ----------------------------------------------------------------- 3. the save
# Checked FIRST. `isNew` forms carry saved:false, so without this branch they
# would fall through to the pendingEvents path and write into index null.
rep("""  if(f.saved){
    const e = S.events.find(x=>x.id===f.ref);""",
"""  if(f.isNew){
    // The same shape the review flow writes (index.html's only other
    // S.events.push), so a hand-typed event is indistinguishable downstream --
    // reminders, conflict detection, calendar export and duplicate matching all
    // treat it identically. `source` says where it came from, and `aiSource` is
    // null because no model touched it.
    S.events.push(Object.assign({ id:uid(), source:'Typed in', from:null,
      aiSource:null, exported:false, unread:false, deleted:false }, fields));
    save();
    eventForm = null;
    view = {tab:'events', sub:null, data:null}; render();
    toast('Event added');
  } else if(f.saved){
    const e = S.events.find(x=>x.id===f.ref);""")

# --------------------------------------------------------------- 4. the cancel
rep("""function cancelEventEdit(){
  const wasSaved = eventForm && eventForm.saved;
  eventForm = null;
  if(wasSaved){ view = {tab:'events', sub:null, data:null}; render(); }
  else sub('review');
}""",
"""function cancelEventEdit(){
  // A new event has nothing to go back to -- there is no review queue behind
  // it -- so it returns to Events like a saved one does.
  const toEvents = eventForm && (eventForm.saved || eventForm.isNew);
  eventForm = null;
  if(toEvents){ view = {tab:'events', sub:null, data:null}; render(); }
  else sub('review');
}""")

# ------------------------------------------------------- 5. entry: Add Paperwork
rep("""    <div class="help">Tip: on ParentSquare links, long-press the link in your email and pick "Open in Safari" — otherwise iOS opens the app instead of the flyer.</div>`;""",
"""    <div class="sect">No paperwork?</div>
    <div class="card row" role="button" tabindex="0"
        onclick="openNewEvent()"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openNewEvent()}">
      ${ico('pen', {cls:'rowicon'})}
      <div class="grow"><div class="title">Type it in myself</div><div class="meta">A blank event — no photo, no AI</div></div></div>
    <div class="help">Tip: on ParentSquare links, long-press the link in your email and pick "Open in Safari" — otherwise iOS opens the app instead of the flyer.</div>`;""")

# ------------------------------------------------------ 6. entry: empty state
# The cta slot emptyState() already has, and was not using here. With no API key
# this is the ONLY action on the screen that actually works.
rep("""      html += emptyState('camera', 'Nothing tracked yet',
        'Snap a flyer or import a PDF and FlyerSnap will pull out the dates for you.');""",
"""      html += emptyState('camera', 'Nothing tracked yet',
        'Snap a flyer or import a PDF and FlyerSnap will pull out the dates for you.',
        `<button class="btn alt" style="width:auto" onclick="openNewEvent()">${ico('pen')}Type one in instead</button>`);""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
open(p, 'w').write(src)
print('manual event entry wired')
