# Notes: the build plan

Follows `NOTES-RESEARCH.md`. Logan chose **folders AND labels** (Apple's model)
plus **checklists, sort choice, colour, and archive**.

Two shipped phases, each with tests, mutation runs, a version bump and a push.

---

## The data model

```js
S.noteFolders = [{ id, name, deleted }]      // one per note; the WHERE
S.noteLabels  = [{ id, name, deleted }]      // many per note; the WHAT-ABOUT
S.notes[i]    = { id, title, body, pinned, personIds[],
                  folderId,        // string | null  -- null = Unfiled
                  labelIds[],      // string ids into noteLabels
                  color,           // '' | one of KID_COLORS
                  archived,        // bool
                  created, updated, deleted }
```

**Folders and labels are ENTITIES with ids, not bare strings.** A rename then
costs nothing and cannot orphan a note — the alternative (storing the name on
the note) means a rename has to rewrite every note that used it, and a typo
silently forks the group in two. Same reasoning the app already applies to
people.

**`SCHEMA_VERSION` 8 → 9.** The migration only ensures shapes; it invents no
folders and no labels. Every existing note becomes Unfiled with no labels,
which is exactly what it is today. `js/migrate.js` and the inlined copy in
`index.html` both change — that is the drift the test suite checks for.

## Filter state

`noteFolderFilter` (string | null) and `noteLabelFilter` (a Set) are
**module-level view state**, never on `S` — the same rule `problemSel` and
`clashSel` follow. A Set on `S` serialises to `{}` and would ship in a backup.

Sort is different: it *is* a preference, so `S.settings.noteSort` is saved.
Apple and Samsung both treat sort as a setting rather than a per-visit choice.

## Checklists — the one judgment call worth flagging

Apple and Keep store checklist items as structured rows. FlyerSnap will use
**markdown lines inside the existing body** (`- [ ] item` / `- [x] item`),
rendered as tappable checkboxes, with a tap rewriting that one line.

Why, given the app already has a `listItems` table it could copy:

- The body stays the **single source of truth**. Autosave, undo, export, search
  and the AI read path all keep working untouched.
- No second table means no orphan rows when a note is deleted, and no migration
  for notes that have none.
- It survives a round-trip through export and through anything that treats a
  note as text.
- Bear does exactly this.

The cost is honest and worth stating: you cannot drag to reorder items, and a
malformed line renders as text rather than a checkbox. Both are acceptable for
"who is bringing what" — and Lists still exists for anything that needs more.

---

## Phase 1 — v9.71: folders, labels, and the filter bar

1. `SCHEMA_VERSION` 9 + the `from < 9` block, in `js/migrate.js` **and** the
   inlined copy.
2. `noteFolders` / `noteLabels` in `blank()`.
3. CRUD: `addNoteFolder`, `renameNoteFolder`, `delNoteFolder` (notes inside
   become Unfiled — never deleted), and the same three for labels.
4. Note detail: a "Folder" row (single choice) and a label chip row (multi).
5. Board: folder row + label chips above the list; `noteMatches` extended.
6. A **Manage** screen for renaming, merging and deleting both kinds.
7. Deleting a folder or label must never delete a note. Test + mutation.

## Phase 2 — v9.72: checklists, sort, colour, archive

1. `- [ ]` / `- [x]` parsing, tappable rendering, `toggleNoteCheck(id, index)`
   rewriting exactly one line, and an "Add item" button.
2. Board shows `3 of 5` when a note has checkboxes.
3. `S.settings.noteSort`: edited / created / title. Pinned still floats to top.
4. `color` from `KID_COLORS`, shown as the card's left stripe.
5. `archived`: hidden from the board, its own section, unarchive, and a count.
   Distinct from delete, which keeps its undo.

## What is deliberately not being built

- **Nested folders.** Apple allows them; Evernote's stacks explicitly do not
  nest, and on a phone there is no drag-and-drop tree to make depth usable.
  Flat, with labels for the cross-cutting cases.
- **Images or attachments in notes.** Everything lives in `localStorage`;
  base64 images would exhaust the quota.
- **Smart folders.** Worth revisiting once folders and labels have been used
  for a while — a saved filter is trivial to add on top of this model, and
  guessing the criteria before there is any real data would be inventing them.
