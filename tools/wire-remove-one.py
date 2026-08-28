#!/usr/bin/env python3
"""v9.69 - the clash screen can finally act on ONE event.

Logan, 28 Aug, with a screenshot of a BUSY-DAY warning holding four events:
"I still can't dismiss an Individual item!"

He is right, and the screenshot shows exactly why. Every action on that banner
operates on the WHOLE conflict:

  * "Keep both/all - dismiss this warning"  -> silences the entire group
  * "Keep only this - remove the others"    -> deletes every OTHER event
  * "Tap to reschedule"                     -> edits one, but resolves nothing

For an `overlap` (always exactly 2 events) those are sufficient: keeping one IS
removing the other. For a `busy-day` conflict they are not, and busy-day is what
findConflicts() emits at 4+ events on a date -- four unrelated things, of which
he wants to drop ONE. The only offered way to do that was "Keep only this" on
each of the other three in turn, which would have deleted the very events he
was trying to keep. There was no inverse.

THE ADDITION: "Remove just this one" on each row, beside the existing control.

  removeOneEvent(id, key) soft-deletes that single event with dirty=1 and an
  Undo, exactly as keepOnlyEvent() removes its losers -- same mechanism, same
  recoverability, opposite selection. No dismissConflict() call: findConflicts()
  re-derives from live events, so a busy day that drops below the threshold, or
  an overlap that loses a side, stops warning on its own. Writing the key into
  dismissedConflicts would leave a dead entry there forever and would silence
  the group if an Undo brought the event back.

NOTHING IS REMOVED (CLAUDE.md rule 1). "Keep only this" keeps its wording and
its behaviour; it is now one of two choices instead of the only one. On a
two-event overlap the pair reads as the complements they are.

WORDING. The label for the existing control gains the count it is really
acting on -- "remove the other 3" rather than "remove the others" -- because on
a four-event busy day "the others" understates it, and rule 26 says a
destructive control must wear its consequence on its face.
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

# ------------------------------------------------------------------ the markup
rep(p, """        const others = c.events.length - 1;""",
"""        const others = c.events.length - 1;
        // TWO directions, not one. Until v9.69 the only per-event action was
        // "keep only this", which on a busy day of four means deleting three
        // events to be rid of one. Both are offered now, and both name the
        // number of events they will actually remove.""")

rep(p, """          <button class="linkbtn red" style="align-self:flex-end;font-size:12px;padding:2px 4px"
            aria-label="Keep only ${esc(ev.title || 'Untitled')} and remove the other ${others === 1 ? 'event' : others + ' events'}"
            onclick="event.stopPropagation();keepOnlyEvent('${esc(ev.id)}','${esc(key)}')">
            Keep only this — remove the other${others === 1 ? '' : 's'}</button>
        </div>`;""",
"""          <div class="row" style="justify-content:flex-end;gap:10px;flex-wrap:wrap">
            <button class="linkbtn red" style="font-size:12px;padding:2px 4px"
              aria-label="Remove ${esc(ev.title || 'Untitled')} and keep the other ${others === 1 ? 'event' : others + ' events'}"
              onclick="event.stopPropagation();removeOneEvent('${esc(ev.id)}','${esc(key)}')">
              Remove just this one</button>
            <button class="linkbtn red" style="font-size:12px;padding:2px 4px"
              aria-label="Keep only ${esc(ev.title || 'Untitled')} and remove the other ${others === 1 ? 'event' : others + ' events'}"
              onclick="event.stopPropagation();keepOnlyEvent('${esc(ev.id)}','${esc(key)}')">
              Keep only this — remove the other${others === 1 ? '' : ' ' + others}</button>
          </div>
        </div>`;""")

# The line introducing the per-event controls described only one of them.
rep(p, """    + `<div class="meta" style="font-size:11px;color:var(--muted)">Or pick one — move it, or keep only it:</div>`""",
    """    + `<div class="meta" style="font-size:11px;color:var(--muted)">Or pick one — move it, remove just it, or keep only it:</div>`""")

# ------------------------------------------------------------------ the handler
rep(p, """// The real field, set here and read by findConflicts. Undoable, like every
// other state change in the app.
function markHandled(id){""",
"""/**
 * Resolve a clash by removing ONE of its events and keeping the rest (v9.69).
 *
 * The exact inverse of keepOnlyEvent(), and the action the banner was missing.
 * Every control on that screen acted on the whole conflict: dismiss silenced
 * the group, "keep only this" deleted every other member. That is fine for an
 * `overlap`, which always holds exactly two events -- keeping one IS removing
 * the other -- and wrong for a `busy-day`, which holds four or more. Logan hit
 * it on 28 Aug with four events on one date and no way to drop a single one
 * without destroying the three he wanted.
 *
 * Soft delete plus `dirty`, with an Undo that restores the prior flags rather
 * than assuming they were unset -- the same mechanism keepOnlyEvent() uses on
 * its losers, so a removal made from either direction is recoverable the same
 * way.
 *
 * No dismissConflict() here, for the reason recorded on keepOnlyEvent():
 * findConflicts() re-derives from live events, so an overlap that loses a side
 * or a busy day that drops below the threshold stops warning by itself. A key
 * written into dismissedConflicts would outlive the events it names and would
 * silence the group if the Undo brought this one back.
 */
function removeOneEvent(evId, key){
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
}

// The real field, set here and read by findConflicts. Undoable, like every
// other state change in the app.
function markHandled(id){""")

# ------------------------------------------------------------------ the bridge
# Inline onclick handlers resolve against global scope. A function missing from
# this list is a control that throws on tap and looks simply dead.
rep(p, """  keepOnlyEvent,""", """  keepOnlyEvent, removeOneEvent,""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
for path, text in buf.items():
    open(path, 'w').write(text)
print('per-event removal wired ->', ', '.join(sorted(buf)))
