#!/usr/bin/env python3
"""v9.39 - the Problem Log gets multi-select, bulk resolve, bulk delete, Clear all.

Before this, the Problem Log had exactly two verbs: "Done" on one row at a time,
and "Clear resolved", which only ever removed rows already marked done. There was
no way to delete an OPEN problem at all -- so a burst of forty identical failures
(a model offline for an afternoon, the Gmail watcher swallowing mail) had to be
tapped away one row at a time, and anything you did not want to mark "Done"
because it was not actually fixed simply stayed forever.

DESIGN NOTES

* Select mode is a MODE, held in `problemSel` (a Set of ids, or null). Null means
  not selecting, which is the normal state -- so the screen looks exactly as it
  did until you ask for it. It is reset in openProblems() so the mode never
  survives a trip away from the screen and back.

* Deletes are UNDOABLE via the toast pattern the app already uses (toast with an
  action), not a confirm(). Unlike an API key, a problem entry is a record of
  something that already happened -- there is nothing dangerous about it coming
  back, and a burst delete is exactly the case where you want a way out. The one
  exception is "Clear all", which additionally confirms, because it is the only
  control that touches rows scrolled off screen.

* The undo restores the ORIGINAL ARRAY, captured before the splice, rather than
  re-pushing the removed rows. Re-pushing would reorder the log, and the log is
  read newest-first -- an undo that shuffles history is not an undo.

* Rows stay operable one at a time. Select mode adds a checkbox and makes the
  card body toggle it; it does not take away the per-row Done/Reopen button,
  because the single-row case is still the common one.
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

# ------------------------------------------------------------------ handlers
rep("""function openProblems(){ sub('problems'); }""",
"""// Select mode for the Problem Log. `null` = not selecting (the normal state);
// a Set of problem ids = selecting. Held outside S because it is view state,
// not data -- it must never be saved or reach a backup.
let problemSel = null;

function openProblems(){ problemSel = null; sub('problems'); }

function toggleProblemSelect(){
  problemSel = problemSel ? null : new Set();
  render();
}
function toggleProblemPick(id){
  if(!problemSel) return;
  if(problemSel.has(id)) problemSel.delete(id); else problemSel.add(id);
  render();
}
function selectAllProblems(){
  const all = (S.problems || []).map(p => p.id);
  // One control, both directions: if everything is already picked it clears,
  // which is the only sane meaning of tapping "Select all" a second time.
  problemSel = (problemSel && problemSel.size === all.length) ? new Set() : new Set(all);
  render();
}
function selectedProblems(){
  if(!problemSel) return [];
  return (S.problems || []).filter(p => problemSel.has(p.id));
}
function resolveSelectedProblems(){
  const picked = selectedProblems();
  if(!picked.length) return;
  const now = new Date().toISOString();
  picked.forEach(p => { p.done = true; p.resolved = now; });
  problemSel = null;
  save();
  toast('Marked ' + picked.length + ' done');
  render();
}
/**
 * Remove the picked rows outright. Undoable: `before` is the whole array as it
 * stood, so restoring puts every row back in its original position -- the log
 * is read newest-first and an undo that reorders it is not an undo.
 */
function deleteSelectedProblems(){
  if(!problemSel || !problemSel.size) return;
  const before = (S.problems || []).slice();
  const n = problemSel.size;
  S.problems = before.filter(p => !problemSel.has(p.id));
  problemSel = null;
  save();
  render();
  toast('Deleted ' + n + ' problem' + (n === 1 ? '' : 's'), { label:'Undo', fn:() => {
    S.problems = before; save(); render(); toast('Restored');
  }});
}
/**
 * Empty the log. The only control here that touches rows you cannot see, which
 * is why it confirms as well as offering the undo.
 */
function clearAllProblems(){
  const before = (S.problems || []).slice();
  if(!before.length) return;
  if(!confirm('Clear all ' + before.length + ' entries from the Problem Log?\\n\\nThis only clears the list — it does not fix anything, and new problems will still be recorded.')) return;
  S.problems = [];
  problemSel = null;
  save();
  render();
  toast('Problem Log cleared', { label:'Undo', fn:() => {
    S.problems = before; save(); render(); toast('Restored');
  }});
}

""")

# -------------------------------------------------------------------- render
rep("""  const row = (p) => `<div class="card" style="border-left:5px solid ${p.done?'var(--line)':'var(--amber)'}">
    <div class="row">
      <div class="grow">
        <div style="font-weight:700;font-size:var(--t-sm)">${esc(p.message)}</div>
        <div class="meta" style="font-size:var(--t-cap)">
          ${esc(p.where)}${p.count>1?' · happened '+p.count+' times':''} · last ${esc(String(p.last).slice(0,10))}
        </div>
        ${p.detail?`<div class="meta" style="font-size:var(--t-cap);opacity:.75;word-break:break-word">${esc(p.detail)}</div>`:''}
      </div>
      <button class="linkbtn" onclick="${p.done?"reopenProblem('"+p.id+"')":"resolveProblem('"+p.id+"')"}">${p.done?'Reopen':'Done'}</button>
    </div></div>`;

  let html = '';
  if(open.length){
    html += `<div class="help">${open.length} thing${open.length===1?'':'s'} to look at. Repeats are grouped, so a count means it keeps happening.</div>`;
    html += open.map(row).join('');
  } else {
    html += `<div class="help">Nothing outstanding.</div>`;
  }
  if(done.length){
    html += `<div class="sect">Resolved (${done.length})</div>` + done.slice(0,10).map(row).join('');
    html += `<button class="btn alt" onclick="clearResolvedProblems()">Clear resolved</button>`;
  }
  m.innerHTML = html;""",
"""  const picking = !!problemSel;
  const nPicked = problemSel ? problemSel.size : 0;

  const row = (p) => `<div class="card" style="border-left:5px solid ${p.done?'var(--line)':'var(--amber)'}">
    <div class="row">
      ${picking ? `<input type="checkbox" style="margin-right:10px;flex:none"
        aria-label="Select: ${esc(p.message)}"
        ${problemSel.has(p.id)?'checked':''}
        onclick="event.stopPropagation();toggleProblemPick('${p.id}')">` : ''}
      <div class="grow" ${picking?`role="button" tabindex="0"
        onclick="toggleProblemPick('${p.id}')"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleProblemPick('${p.id}')}"`:''}>
        <div style="font-weight:700;font-size:var(--t-sm)">${esc(p.message)}</div>
        <div class="meta" style="font-size:var(--t-cap)">
          ${esc(p.where)}${p.count>1?' · happened '+p.count+' times':''} · last ${esc(String(p.last).slice(0,10))}
        </div>
        ${p.detail?`<div class="meta" style="font-size:var(--t-cap);opacity:.75;word-break:break-word">${esc(p.detail)}</div>`:''}
      </div>
      <button class="linkbtn" onclick="${p.done?"reopenProblem('"+p.id+"')":"resolveProblem('"+p.id+"')"}">${p.done?'Reopen':'Done'}</button>
    </div></div>`;

  let html = '';

  // The select bar. Kept at the TOP so the count and the escape hatch are
  // visible without scrolling back up from a long log.
  if(picking){
    html += `<div class="card" style="padding:12px;border-left:5px solid var(--accent)">
      <div class="row">
        <div class="grow" style="font-weight:700;font-size:var(--t-sm)">${nPicked} selected</div>
        <button class="linkbtn" onclick="selectAllProblems()">${nPicked === all.length ? 'Select none' : 'Select all'}</button>
        <button class="linkbtn" onclick="toggleProblemSelect()">Cancel</button>
      </div>
      <div class="formrow" style="margin-top:10px">
        <button class="btn sm" ${nPicked?'':'disabled'} onclick="resolveSelectedProblems()">Mark done</button>
        <button class="btn sm alt" ${nPicked?'':'disabled'}
          style="border-color:var(--red-accent);color:var(--red-accent)"
          onclick="deleteSelectedProblems()">Delete</button>
      </div>
    </div>`;
  } else {
    html += `<div class="row" style="justify-content:flex-end">
      <button class="linkbtn" onclick="toggleProblemSelect()">Select</button></div>`;
  }

  if(open.length){
    html += `<div class="help">${open.length} thing${open.length===1?'':'s'} to look at. Repeats are grouped, so a count means it keeps happening.</div>`;
    html += open.map(row).join('');
  } else {
    html += `<div class="help">Nothing outstanding.</div>`;
  }
  if(done.length){
    html += `<div class="sect">Resolved (${done.length})</div>` + done.slice(0,10).map(row).join('');
    html += `<button class="btn alt" onclick="clearResolvedProblems()">Clear resolved</button>`;
  }

  html += `<div style="height:12px"></div>
    <button class="btn alt" style="border-color:var(--red-accent);color:var(--red-accent)"
      onclick="clearAllProblems()">${ico('trash')}Clear all (${all.length})</button>
    <div class="help" style="font-size:12px">Clearing only empties the list. It does not fix
      anything, and it does not stop new problems being recorded.</div>`;

  m.innerHTML = html;""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
open(p, 'w').write(src)
print('problem log multi-select wired')
