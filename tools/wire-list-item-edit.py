#!/usr/bin/env python3
"""v9.60 part 1 - a list item can be edited, and a list can be renamed.

Logan, 27 Aug: "need to add the ability to edit items on a list."

WHAT WAS MISSING, verified on disk at v9.59

`renderListDetail` (index.html:8721) rendered each item as a single row whose
only interaction was `toggleItem`. There was no rename and no per-item delete.
The only way to fix a typo was: check the item, tap "Clear checked items", and
type it again -- which also cleared every other checked item on the list.

The same dead end existed one level up: `renderLists` could add a list and
delete a list, but not rename one. That is the same defect, so it is fixed in
the same pass rather than waiting to be reported separately.

WHAT IS NOT CHANGED

Tapping the row still toggles the checkbox. That is the primary action on a
shopping list and it stays the primary action -- edit is a labelled secondary
control, not a replacement (CLAUDE.md rule 1).

DESIGN NOTES

* Edit mode is a MODE held in `listEditId` / `listRenameId`, both module-level
  view state, never on S. A selection is not the user's data, and anything
  parked on S is written by save() and shipped in a backup.

* The controls carry VISIBLE text labels ("Edit", "Rename"), not bare icons.
  The Problem Log and clash-banner findings of 26-27 Aug were both about
  controls whose only name was an aria-label; the a11y suite passes on those
  and the user still cannot tell what they do.

* Deleting an item goes through the app's existing softDelete(), so it is
  recoverable with one tap of the Undo toast and is pruned on the normal
  schedule. No new deletion mechanism, no second source of truth.

* Empty is a cancel, not a delete. Saving an edit with the field cleared would
  otherwise silently destroy the item's text with no undo -- so a blank save
  leaves the item alone and closes the editor.
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

# =================================================== 1. list rows get Rename
rep("""      return `<div class="card row" onclick="sub('listDetail',{id:'${l.id}'})">
        ${emoji}
        <div class="title grow">${esc(l.name)}</div>
        <span class="meta">${open===0?'done':open+' open'}</span>
        <button class="linkbtn red" style="padding:4px" aria-label="Delete list ${esc(l.name)}" onclick="event.stopPropagation();delList('${l.id}')">${ico('x')}</button>
      </div>`;""",
"""      if(listRenameId === l.id){
        return `<div class="card" style="padding:12px">
          <div class="formrow" style="margin:0">
            <input type="text" id="renameList" aria-label="Rename list" value="${esc(l.name)}"
              onkeydown="if(event.key==='Enter')saveListRename('${l.id}');if(event.key==='Escape')cancelListRename()">
            <button class="btn sm" onclick="saveListRename('${l.id}')">Save</button>
          </div>
          <div class="row" style="justify-content:flex-end;margin-top:8px">
            <button class="linkbtn" onclick="cancelListRename()">Cancel</button>
          </div></div>`;
      }
      return `<div class="card row" onclick="sub('listDetail',{id:'${l.id}'})">
        ${emoji}
        <div class="title grow">${esc(l.name)}</div>
        <span class="meta">${open===0?'done':open+' open'}</span>
        <button class="linkbtn" style="padding:4px" onclick="event.stopPropagation();renameList('${l.id}')">Rename</button>
        <button class="linkbtn red" style="padding:4px" aria-label="Delete list ${esc(l.name)}" onclick="event.stopPropagation();delList('${l.id}')">${ico('x')}</button>
      </div>`;""")

# ================================================= 2. item rows get Edit/Delete
rep("""  let html = items.length ? items.map(i=>`
    <div class="card row" style="padding:12px" onclick="toggleItem('${i.id}')">
      <div class="check ${i.checked?'on':''}" style="width:24px;height:24px">${i.checked?'✓':''}</div>
      <div class="grow ${i.checked?'strike':''}" style="font-size:15px">${esc(i.text)}</div>
    </div>`).join('')""",
"""  const itemRow = (i) => {
    // Edit mode replaces the row rather than sitting beside it: a row that is
    // both a checkbox and a text field invites tapping the wrong one.
    if(listEditId === i.id){
      return `<div class="card" style="padding:12px">
        <div class="formrow" style="margin:0">
          <input type="text" id="editItem" aria-label="Edit item" value="${esc(i.text)}"
            onkeydown="if(event.key==='Enter')saveItemEdit('${i.id}');if(event.key==='Escape')cancelItemEdit()">
          <button class="btn sm" onclick="saveItemEdit('${i.id}')">Save</button>
        </div>
        <div class="row" style="justify-content:space-between;margin-top:8px">
          <button class="linkbtn red" onclick="delItem('${i.id}')">Delete item</button>
          <button class="linkbtn" onclick="cancelItemEdit()">Cancel</button>
        </div></div>`;
    }
    return `<div class="card row" style="padding:12px" onclick="toggleItem('${i.id}')">
      <div class="check ${i.checked?'on':''}" style="width:24px;height:24px">${i.checked?'✓':''}</div>
      <div class="grow ${i.checked?'strike':''}" style="font-size:15px">${esc(i.text)}</div>
      <button class="linkbtn" style="padding:4px" onclick="event.stopPropagation();editItem('${i.id}')">Edit</button>
    </div>`;
  };
  let html = items.length ? items.map(itemRow).join('')""")

# ===================================================== 3. the handlers
rep("""function toggleItem(id){""",
"""// View state only. A half-finished edit is not the user's data and must never
// be written by save() or ride along in a backup -- so it lives here, not on S.
let listEditId = null;
let listRenameId = null;

function editItem(id){ listEditId = id; listRenameId = null; render(); focusEditBox('editItem'); }
function cancelItemEdit(){ listEditId = null; render(); }

/**
 * Commit a rename. An EMPTY field cancels rather than deletes: clearing the box
 * and tapping Save would otherwise destroy the text with no undo, and "delete"
 * already has its own labelled control right beside it.
 */
function saveItemEdit(id){
  const box = document.getElementById('editItem');
  const t = box ? box.value.trim() : '';
  const i = S.listItems.find(x => x.id === id);
  if(i && t && t !== i.text){ i.text = t; save(); }
  listEditId = null;
  render();
}

// The app's existing soft delete, so this is undoable and prunes normally.
// A new deletion path here would be a second source of truth for "removed".
function delItem(id){
  const i = S.listItems.find(x => x.id === id);
  listEditId = null;
  return i ? softDelete('listItems', id, '"' + i.text + '"') : (render(), null);
}

function renameList(id){ listRenameId = id; listEditId = null; render(); focusEditBox('renameList'); }
function cancelListRename(){ listRenameId = null; render(); }
function saveListRename(id){
  const box = document.getElementById('renameList');
  const t = box ? box.value.trim() : '';
  const l = S.lists.find(x => x.id === id);
  if(l && t && t !== l.name){ l.name = t; save(); }
  listRenameId = null;
  render();
}

// render() replaces #main, so the field only exists after it returns. Putting
// the caret at the END rather than selecting all means a small correction does
// not require retyping the whole line.
function focusEditBox(id){
  const box = document.getElementById(id);
  if(!box) return;
  box.focus();
  try{ box.setSelectionRange(box.value.length, box.value.length); }catch(e){}
}

function toggleItem(id){""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
open(p, 'w').write(src)
print('list item edit + list rename wired')
