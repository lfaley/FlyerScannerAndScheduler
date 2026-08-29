# Notes: how other apps organize, and what FlyerSnap should do

Research pass, 28 Aug 2026. Written before any code, per CLAUDE.md rule 4
(Research → Plan → Scaffold → Code). Every claim below carries a source. Where
a source only *asserts* something rather than measuring it, it says so.

---

## 1. What FlyerSnap's notes are today

Read from the shipped code, not from memory.

| Thing | Where | State |
|---|---|---|
| Note shape | `index.html:9331` (`newNote`) | `{id, title, body, pinned, personIds[], created, updated, deleted}` |
| Title | `index.html:9199` (`noteTitleOf`) | Explicit title wins; otherwise first non-empty body line (Apple's rule) |
| Board | `index.html:9260` (`renderNotesBoard`) | Flat list. Two groups only: **Pinned** and **Others** |
| Sort | `index.html:9264` | Most recently edited first. **No other sort exists** |
| Search | `index.html:9217` (`noteMatches`) | Title + body + **people names** |
| People | `index.html:9401` (`toggleNotePerson`) | A note can carry several `personIds` |
| Lists | `index.html:9231` (`renderNotes`) | Second area of the same tab, switched by a chip |
| Schema | `index.html:751` | `SCHEMA_VERSION = 8` |

**The important thing this table shows:** the app *already has a cross-cutting
label axis* — people. A note can carry several, they are searchable, and they
already render on the card. Any organizational feature added now either
extends that axis or competes with it.

**What is missing:** any grouping at all beyond pinned/not-pinned, any sort
choice, any way to see "everything about volleyball", and any structure inside
a note (a note is one plain-text blob — no checklist, no image).

---

## 2. What every other app actually does

| App | Primary primitive | Nesting | Second axis | Auto-groups |
|---|---|---|---|---|
| **Apple Notes** | Folders (one per note) | Subfolders, no stated depth cap | Inline `#tags`, many per note | **Smart Folders**: tags, mentions, checklist state, created/edited dates |
| **Google Keep** | **Labels only**, many per note | None — flat | Colours; Archive as a state | None documented |
| **Bear** | **Tags only** | Nested via `#a/b` | — | Unverified |
| **Simplenote** | **Tags only** | None | — | `tag:` search prefix, not saved |
| **Standard Notes** | **Tags**, nested | — | — | **Smart Views**: title, content, dates, editor, tags |
| **Evernote** | Notebooks → Stacks | **Stacks cannot nest** — two container levels, hard stop | Tags, many per note | Unverified |
| **Samsung Notes** | Folders | Subfolders | **No tags documented** | Unverified |
| **Notion** | Pages in a tree | "Infinite levels" | Multi-select properties | Database views (filter/sort/group) |

Two patterns worth naming:

1. **Nobody lets a note live in two folders.** Apple, Evernote and Samsung all
   state a note has exactly one container. Multi-membership is *always* done
   with tags. Apple says so directly: tags are "a great way to further organize
   notes without moving them from their original folders."
2. **The three tag-only apps (Keep, Bear, Simplenote) ship no folders at all**
   and are not considered crippled. Keep caps labels at 50; Simplenote advises
   no more than ~10 tags on one note.

Sort defaults, where documented: Apple = most recently edited (same as
FlyerSnap today). Samsung offers Title / Date created / Date modified.
Simplenote offers six (Modified, Created, Name — each direction).

---

## 3. What the research actually shows

This is where I have to be careful, because most of what is written about
folders vs tags is opinion.

**MEASURED — Civan, Jones, Klasnja & Bruce (2008), n=10.** Participants filed
articles into folders (Hotmail) or labels (Gmail) for five days, then retrieved
them.

- Recall of details: **1.9 folders vs 2.4 tags — p = 0.30, not significant**
- Time to find: **14.5s vs 15.4s — p = 0.84, not significant**
- Application: **1.0 folder per item vs 1.4 labels per item**

The conclusion is the useful part: **neither model retrieved better.** What
differed was *where the effort landed* — folders cost more thinking at filing
time (choose one destination), tags cost more tapping (apply several).

**MEASURED — Bergman et al. (2012), n=62.** Retrieving a file by *navigating*
a hierarchy used significantly less attention than retrieving by *searching*,
and search took roughly **3× longer** and failed more often. This is
navigation-vs-search, not folders-vs-tags, but it is the strongest evidence
that a visible structure you can tap beats a search box you must type into.

**MEASURED — Whittaker & Sidner "failed folders."** A folder holding fewer than
three items is filing effort spent for nothing. The original email study found
**39%** of folders were failed folders; a later replication across **600
mailboxes** found **16%**. Directly relevant here: a family's note collection is
tens of notes, so hand-made folders would mostly hold one or two things.

**ASSERTED, not measured** — tag proliferation, inconsistent near-duplicate
tags, and "I don't know enough to define a taxonomy" are real complaints from
long-term Evernote/Obsidian users and from Evernote's own guidance, but none of
it is measured. I found **no** NN/g article on folders-vs-tags for personal
notes; their material on flat-vs-deep hierarchy is about websites. "Folder
paralysis" and "orphaned notes" are terms I could not source with any data at
all — treat them as folklore.

---

## 4. What this means for *this* app specifically

1. **Retrieval is not the deciding factor.** Civan measured no difference. So
   pick on capture cost, not on find cost.
2. **Capture cost matters more here than in Evernote.** These notes are jotted
   one-handed at a school pickup. A model that demands "which folder?" before
   the note exists taxes the moment the app is worst placed to tax.
3. **Failed folders are the predictable outcome at this scale.** With maybe
   30–60 notes, a folder per topic mostly holds one note.
4. **The app already has labels.** People are exactly a tag axis
   (`personIds`, `index.html:9401`) — searchable, multi-valued, already on the
   card. A second parallel *folder* concept would mean two organizational
   systems that do not talk to each other.
5. **Bergman says give it something to tap.** Whatever the primitive, it needs a
   visible row of groups at the top of the board, not just a search box.
6. **Lists already occupy the "second area."** Notes and Lists are one tab with
   a chip switcher (`index.html:9231`). Folders inside Notes but not inside
   Lists would be asymmetric.

---

## 5. The options

### A — Labels, Keep's model *(recommended)*
Many per note, flat, no nesting. A chip row above the board: `All · Pinned ·
School · Volleyball · Braelyn …`, tapping filters. People become label chips in
the same row, so the axis the app already has is the axis it grows.

- **For:** cheapest capture (a note needs no home); no failed folders; multi-home
  for free; one concept, not two; matches the measured evidence that filing
  model does not change retrieval.
- **Against:** labels proliferate without discipline; nothing enforces a
  taxonomy. Mitigate with a cap and a merge/rename screen.

### B — Folders, Apple's model
One folder per note, flat (no subfolders). A folder row above the board.

- **For:** the most familiar model on his iPhone; a note is in exactly one place,
  which is easy to reason about; no proliferation.
- **Against:** a decision at capture time; "School" vs "Volleyball" forces a
  choice for a note that is both; failed folders at this scale.

### C — Both (Apple exactly)
One folder + many labels.

- **For:** the model that mainstream apps converged on.
- **Against:** two systems to learn and two to maintain, in an app whose notes
  are a side feature. Roughly double the code and double the surface for the
  drift the audit keeps finding.

### D — No manual filing; smart groups only
Auto-collections: Recent, Pinned, By person, Has a checklist, plus saved
searches. Nothing to file.

- **For:** zero capture cost; nothing to maintain; leans on data already there.
- **Against:** you cannot express a grouping the app did not think of.

---

## 6. Features worth adding regardless of which is chosen

Ranked by value per line of code, drawn from what the other apps ship:

1. **Checklists inside a note.** Every app has this. FlyerSnap has checkable
   items in Lists but a note body is plain text.
2. **Sort choice** — edited / created / title. Three of the surveyed apps offer
   it; FlyerSnap has one fixed order (`index.html:9264`).
3. **Archive**, distinct from delete — Keep's third state, for a note that is
   done but not disposable.
4. **A colour or icon per note**, so the board is scannable — Keep's colours,
   Samsung's covers.
5. **Duplicate a note**, for anything used as a template.
6. **Share/copy a note as text** — the Problem Log already has `copyProblem`
   and `shareProblem` (`index.html`), so the plumbing exists.

Deliberately **not** recommended: images or attachments in notes. The app
stores everything in `localStorage`, and base64 images would blow the quota —
that is the same constraint that shaped photo handling elsewhere in the app.

---

## Sources

Apple Notes: [tags and Smart Folders](https://support.apple.com/en-us/102288),
[Smart Folders](https://support.apple.com/guide/notes/use-smart-folders-apd58edc7964/mac),
[sort and pin](https://support.apple.com/guide/notes/sort-and-pin-notes-apdb54e469b6/mac),
[folders](https://support.apple.com/guide/notes/add-and-remove-folders-apd558a85438/mac).
Google Keep: [organize your notes](https://support.google.com/keep/answer/6191044),
[lists](https://support.google.com/keep/answer/6395451).
Bear: [nested tags](https://bear.app/faq/nested-tags/), [tags](https://bear.app/faq/how-to-use-tags-in-bear/), [pinning](https://bear.app/faq/pin-notes-and-tags/).
Simplenote: [help](https://simplenote.com/help/).
Standard Notes: [smart views](https://standardnotes.com/help/42/how-do-i-view-a-list-of-untagged-notes-and-create-other-dynamic-filters).
Evernote: [spaces, stacks, notebooks](https://evernote.com/blog/spaces-stacks-notebooks), [tagging guidance](https://evernote.com/learn/struggling-with-tagging-chaos-heres-how-to-build-a-simple-tag-system).
Samsung Notes: [organize](https://www.samsung.com/us/support/answer/ANS10004548).
Notion: [databases](https://www.notion.com/help/intro-to-databases), [views, filters and sorts](https://www.notion.com/help/views-filters-and-sorts).
Research: [Civan et al. 2008](https://www.academia.edu/59576791/Better_to_organize_personal_information_by_folders_or_by_tags_The_devil_is_in_the_details),
[Bergman et al. 2012](https://link.springer.com/article/10.1007/s00779-012-0544-z),
[Revisiting Whittaker & Sidner](https://www.academia.edu/49400353/Revisiting_Whittaker_and_Sidners_email_overload_ten_years_later),
[Bergman & Whittaker review](https://www.auxilit.com/review-the-science-of-managing-our-digital-stuff/).
