#!/usr/bin/env python3
"""v9.59 - the clash banner gains "keep only this one".

Logan, 26 Aug: "the clashing events window is good. it is only missing a way to
choose one and delete the other. do not remove any functionality, just add the
ability to choose only one as well."

WHAT WAS THERE, AND STAYS THERE UNTOUCHED

  * "Keep both / Keep all - this is fine"  -> dismissConflict(key)
  * the per-event buttons under "Or move one:" -> openEventEdit(ev.id)
  * the x in the corner, the "See next clash" pager, the different-people note
  * markHandled() on the missed-deadline branch

Nothing above is altered. The only edits are additive: one new line of text,
one new link under each event button, and one new handler.

WHY IT IS A SEPARATE LINK RATHER THAN A THIRD LIST

The banner already lists the clashing events once. Listing them a second time
under a "keep just one" heading would double the height of a warning that is
supposed to be glanceable. So the destructive choice hangs off the row it
applies to, where the event it names is already on screen.

WHY IT CONFIRMS *AND* UNDOES

The app's own convention is split: eventActions() and bulkDelete() confirm
before removing an event, softDelete() offers an undo instead. This one does
both, deliberately, because it is the only control in the app where tapping a
row labelled with event A deletes event B -- the thing that disappears is not
the thing you tapped. The confirm names exactly what will go; the undo is the
way back if the names did not register.

The same shape as the duplicates screen (applyDedupe, index.html ~:7593):
`deleted = true; dirty = 1`. Soft delete, so the event is recoverable, and
`dirty` marks it for whatever reads that flag, exactly as a bulk delete does.

WHY THE CONFLICT IS RE-DERIVED FROM THE KEY

conflictBanner() renders from a live findConflicts() call and an index into it.
By the time a tap arrives, that index may point somewhere else (another tab
saved an event; the pager moved). The handler therefore looks the conflict up
by its key and refuses if it no longer exists, rather than trusting a captured
position -- the same reason stepConflict() re-derives the list.
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

# ------------------------------------------------------------------ the UI
rep("""    + `<div class="meta" style="font-size:11px;color:var(--muted)">Or move one:</div>`
    + c.events.slice(0, 5).map(ev => {
        const t = fmtTimeRange(ev) || (ev.time ? fmt12(ev.time)
          : (ev.kind === 'deadline' ? 'due (no time)' : 'all day'));
        const who = (ev.personIds || [])
          .map(id => nameOf(id)).filter(Boolean).join(', ');
        const meta = [t, ev.location || '', who].filter(Boolean).join(' · ');
        return `<button class="btn alt sm" style="width:100%;text-align:left;white-space:normal;padding:10px 12px"
          onclick="openEventEdit('${esc(ev.id)}')">
          <span style="font-weight:700;display:block">${esc(ev.title || 'Untitled')}${ev.kind === 'deadline' ? ' · deadline' : ''}</span>
          <span class="meta" style="font-size:12px;display:block;margin-top:2px">${esc(meta)}</span>
          <span class="meta" style="font-size:11px;display:block;margin-top:3px;color:var(--accent)">${ico('edit')}Tap to reschedule</span>
        </button>`;
      }).join('')""",
"""    + `<div class="meta" style="font-size:11px;color:var(--muted)">Or pick one — move it, or keep only it:</div>`
    + c.events.slice(0, 5).map(ev => {
        const t = fmtTimeRange(ev) || (ev.time ? fmt12(ev.time)
          : (ev.kind === 'deadline' ? 'due (no time)' : 'all day'));
        const who = (ev.personIds || [])
          .map(id => nameOf(id)).filter(Boolean).join(', ');
        const meta = [t, ev.location || '', who].filter(Boolean).join(' · ');
        // The reschedule button is unchanged. The "keep only this" link is new,
        // and sits UNDER the row it belongs to so the event it keeps is the one
        // named directly above it.
        const others = c.events.length - 1;
        return `<div style="display:flex;flex-direction:column;gap:2px">
          <button class="btn alt sm" style="width:100%;text-align:left;white-space:normal;padding:10px 12px"
            onclick="openEventEdit('${esc(ev.id)}')">
            <span style="font-weight:700;display:block">${esc(ev.title || 'Untitled')}${ev.kind === 'deadline' ? ' · deadline' : ''}</span>
            <span class="meta" style="font-size:12px;display:block;margin-top:2px">${esc(meta)}</span>
            <span class="meta" style="font-size:11px;display:block;margin-top:3px;color:var(--accent)">${ico('edit')}Tap to reschedule</span>
          </button>
          <button class="linkbtn red" style="align-self:flex-end;font-size:12px;padding:2px 4px"
            aria-label="Keep only ${esc(ev.title || 'Untitled')} and remove the other ${others === 1 ? 'event' : others + ' events'}"
            onclick="event.stopPropagation();keepOnlyEvent('${esc(ev.id)}','${esc(key)}')">
            Keep only this — remove the other${others === 1 ? '' : 's'}</button>
        </div>`;
      }).join('')""")

# ------------------------------------------------------------- the handler
rep("""// The real field, set here and read by findConflicts. Undoable, like every
// other state change in the app.
function markHandled(id){""",
"""/**
 * Resolve a clash by keeping ONE of its events and removing the rest (v9.59).
 *
 * The banner could already say "these are fine" (dismiss) or "let me move one"
 * (edit). It could not say "this one wins" -- the one answer a double-booking
 * usually has -- so the only way to act on it was to leave the banner, find the
 * loser in the list, and delete it by hand.
 *
 * Soft delete plus `dirty`, exactly as applyDedupe() and bulkDelete() do, so
 * the removed events are recoverable and are marked the same way any other
 * bulk removal marks them.
 *
 * No dismissConflict() call is needed or wanted: eventsClash() returns false
 * the moment either side is deleted, so the warning goes on its own. Writing
 * the key into dismissedConflicts as well would leave a dead entry there
 * forever, and would silence the pair if an undo brought them both back.
 */
function keepOnlyEvent(keepId, key){
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
}

// The real field, set here and read by findConflicts. Undoable, like every
// other state change in the app.
function markHandled(id){""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
open(p, 'w').write(src)
print('clash keep-one wired')
