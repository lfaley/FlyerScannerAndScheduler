# DATA-LOSS-PLAN.md — the three places FlyerSnap loses data

**Status:** PLAN. Nothing implemented. Written 31 Aug 2026 against **v9.77** (`2fc7206`).
**Scope:** findings D1, D2 and F5 from `FLYERSNAP-REVIEW-2026-08-31.md`.
**Order:** Research → Plan → Scaffold → Code → Verify. This document is step 2.
**Revision 2** (31 Aug, after competitive research — see §1.4): retention set to **30 days**, and
D1 now includes a **Recently Deleted screen**, because every comparable product pairs the
window with a place to see it. Decisions recorded in §7.

---

## 0. What this covers, and what it deliberately does not

**In scope — the three places where data is actually destroyed or silently not written:**

| | Finding | One line |
|---|---|---|
| **D1** | Prune destroys tombstones with no grace period | Six of seven collections hard-delete the moment prune runs; events are gated on the wrong date entirely. **And a deleted row has nowhere to be seen** — see §1.4 |
| **D2** | `save()` goes silent after the first failure | You keep editing; nothing is written; nothing tells you |
| **F5** | `importBackup` can permanently blank-screen the app | And the alert says "that file is not a backup" *after* your data is overwritten |

**Explicitly NOT in scope, and why:**

- **D6** (`removeKey` leaves the key in snapshots) — a security fix, not a data-loss one. Separate change, separate reasoning.
- **D3/D7/D8/D9** (deletes with no undo) — real, but they are UI-honesty problems, not storage problems. They belong with the "delete without a way back" batch.
- **`restoreSnapshot` skipping migration** (§5 of the review) — *partly* in scope: F5's fix creates the shared function that would fix it too, and taking that for free is cheaper than leaving a third divergent copy. Called out in Phase 2.
- **Reducing what the app stores.** The 5 MiB ceiling (§1.2) is a real constraint and D1 makes tombstones live longer. This plan quantifies the risk and offers a lever; it does not redesign storage.

---

## 1. Research

### 1.1 How to tell "storage is full" from "storage is broken"

MDN's canonical `storageAvailable()` helper identifies a quota failure like this ([MDN, *Using the Web Storage API*](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API)):

```javascript
  } catch (e) {
    return (
      e instanceof DOMException &&
      e.name === "QuotaExceededError" &&
      // acknowledge QuotaExceededError only if there's something already stored
      storage &&
      storage.length !== 0
    );
  }
```

Two things follow for us:

1. The name to test is **`QuotaExceededError`**, and it is a `DOMException`.
2. MDN's own note — *"acknowledge QuotaExceededError only if there's something already stored"* — exists because **private browsing can present an empty `localStorage` with zero quota**, which throws the same error for a completely different reason.

FlyerSnap's `save()` currently treats *every* throw as "storage on this phone is full" (`index.html:3891-3894`). A disabled-storage or private-mode failure gets told to go delete old events, which will not help.

### 1.2 The ceiling is 5 MiB, and it is not the ceiling most articles talk about

[MDN, *Storage quotas and eviction criteria*](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria):

> "Web Storage, which can be accessed by using the `localStorage` and `sessionStorage` properties of the `window` object, is limited to 10 MiB of data maximum on all browsers. Browsers can store up to 5 MiB of local storage, and 5 MiB of session storage per origin."

The multi-gigabyte quotas people quote apply to IndexedDB, Cache API and OPFS — **not** to `localStorage`, which is where all of FlyerSnap's data lives. The app already knows this: the storage screen says *"of roughly 5,000 KB"* (`index.html:10964`).

**This is the constraint that makes D1 non-trivial.** Today six collections drop tombstones instantly. Giving them a 90-day life keeps more rows. And the state is stored **four times over**: the live `flyersnap` key plus up to three `flyersnap-snap-*` copies (`SNAP_KEEP = 3`, `index.html:3976`), each a verbatim copy of the whole blob (`:3995`). Every kilobyte of retained tombstone costs up to four.

### 1.3 Eviction is real, but it is not what folklore says

Same MDN page:

> "Data eviction can happen in multiple cases:
> - When the device is running low on storage space, also known as *storage pressure*.
> - When all of the data stored in the browser (across all origins) exceeds the total amount of space the browser is willing to use on the device.
> - Proactively, for origins that aren't used regularly, which happens only in Safari."

and:

> "**Persistent**: an origin can opt-in to store its data in a persistent way. Data stored this way is only evicted, or deleted, if the user chooses to."

[WebKit's storage-policy update](https://webkit.org/blog/14403/updates-to-storage-policy/) says an origin "might be excluded from eviction if it has active page at the time of eviction, or its storage is in persistent mode."

**I checked whether the app already does this before proposing it: it does.** `index.html:11806`:

```js
if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(()=>{});
```

So no change is needed there. Worth recording, because a "7-day Safari eviction" claim circulates widely and **neither primary source says it** — I looked for it specifically and it is not in either page. This plan does not act on it.

Two consequences the app does *not* currently take:

- `navigator.storage.persist()` returns a **boolean** that is thrown away. Whether the request was granted is exactly what you want to know when data goes missing, and it costs one field in the diagnostics file.
- MDN: "Safari and most Chromium-based browsers … automatically approve or deny the request based on the user's history of interaction with the site." So the answer can change over time and is worth reading at boot rather than assuming.

### 1.4 What shipped products actually do

Checked against primary vendor documentation, not recollection.

| Product | Window | Where deleted items live | Quoted |
|---|---|---|---|
| Google Drive | **30 days** | Trash — a browsable place | *"When you move a file or folder to your trash, it remains there for 30 days. After 30 days, your files are deleted forever."* |
| Apple Photos | **30 days** | Recently Deleted collection | *"Deleted photos and videos are kept in the Recently Deleted collection for 30 days before being permanently removed from all devices."* |
| Apple Notes | **30 days** | Recently Deleted folder | *"You can view and recover notes in the Recently Deleted folder for up to 30 days before they're permanently removed from all your devices."* |
| Dropbox | **30 days** (Basic/Plus/Family) | Deleted files view | *"Dropbox Basic, Plus, and Family customers have 30 days"* — 180 days on Professional/Standard/Business, 365 on Advanced/Enterprise/Education |

**Three conclusions, and the third is the one that changes this plan:**

1. **30 days is the consumer default, unanimously.** The longer windows exist only on business tiers, where the driver is retention policy and compliance, not "I deleted the wrong thing." Nothing here supports 90.

2. **Trash is charged to the user's quota, and they say so.** Google, explicitly: *"Items in your trash take up storage in Google Drive until they're deleted forever."* If a product operating at Google's scale still bills trash against the quota and tells the user, then at a 5 MiB ceiling (§1.2) FlyerSnap has no case for a 90-day window.

3. **Every one of them gives deleted items a VISIBLE HOME.** Not one relies on an undo affordance alone. FlyerSnap's soft-delete is entirely invisible: the only route back to a deleted row is a toast that auto-dismisses after 7 seconds (`index.html:4142`). A 30-day window nobody can see or reach is storage cost with no user benefit — so the window and the screen are one change, not two.

Supporting guidance, same standard:

- **Material Design 3, snackbar guidelines:** *"Snackbars without actions can auto-dismiss after 4–10 seconds… **Snackbars with actions should remain on the screen until the user takes an action on the snackbar, or dismisses it.**"* and *"Snackbars shouldn't be the only way to access a core use case, to make an app usable."* FlyerSnap's undo toast has an action and auto-dismisses at 7 s (`toast()`, `index.html:4142`). **Logged as its own finding; deliberately NOT fixed in this batch** — it touches every `softDelete` call site and changes how the whole app feels.
- **NN/g, visibility of system status:** *"no action with consequences to users should be taken without informing them."* This is the argument against `manualPrune` quietly destroying rows, and for showing what is in the trash.
- **Apple HIG, Undo and redo:** *"Show the results of an undo or redo"* and *"Avoid placing unnecessary limits on the number of times people can undo."*

**Precedent inside this repo:** `renderSetDismissed` (`index.html:10831-10902`) is already exactly this pattern — a settings sub-screen whose only job is to be the way back from a suppression, with `dismissedCount()`, `restoreDismissedConflict()` and `restoreNotDuplicate()`. The Recently Deleted screen should be its sibling and follow its shape. This is not a new idea for the app; it is the idea the app already had, applied to deletes.

### 1.5 What the code does today — verified, not recalled

| Behaviour | Evidence |
|---|---|
| No `deletedAt` field exists anywhere | `grep -n "deletedAt" index.html` → **no matches** |
| Eight sites soft-delete, none records when | `index.html:4156`, `:5969`, `:8241`, `:8318`, `:8350`, `:9410`, `:9620`, `:11612` |
| The tombstone rule is written but never used | `index.html:3946` `const oldDeleted = row => row.deleted && (!row.date \|\| row.date < deletedCutoff);` — one occurrence in the file |
| Events use the event's own date as the tombstone clock | `index.html:3947` |
| Six collections have no age test at all | `index.html:3948-3953` |
| `save()` warns once, then never again | `index.html:3889-3895`; `storageWarned` cleared only on success at `:3888` |
| `logProblem` ends with `save()` | `index.html:7075` — **so `save()`'s catch must never call `logProblem`, or it recurses** |
| `importBackup` validates only `events` | `index.html:11723` |
| `importBackup` has `save(); render();` inside the try | `index.html:11732` |
| `load()` does three things `importBackup` does not: nested settings merges and `migrate()` | `index.html:3865-3869` |
| `snapshot()` is throttled to once a day | `index.html:3992` |
| The current suite | 761 passing at `2fc7206` |

---

## 2. D1 — give tombstones a real 90-day life

### The bug

`KEEP_SOFT_DELETED_DAYS = 90` (`index.html:3904`) describes a grace period that is not implemented. Events are filtered on `e.date` — *when the event happens* — so an event dated four months ago is destroyed however recently you deleted it, and a soft-deleted future event is never reclaimed. The other six collections are dropped the instant prune runs.

### The change

1. **Add `deletedAt`** — an ISO date string (`todayISO()`), written at the moment of soft deletion, at all eight sites.
2. **Route every site through `softDelete`** where the collection is one it handles, so there is one place that stamps it. Where a site cannot use `softDelete` (it operates on many rows at once — `:5969`, `:8241`, `:8318`, `:9410`), it sets both fields together via a tiny shared helper `markDeleted(row)`.
3. **Make `oldDeleted` the single prune rule** and actually call it:

```js
const oldDeleted = row => row.deleted && row.deletedAt && row.deletedAt < deletedCutoff;
```

   **A missing `deletedAt` means keep.** Unknown is never a licence to destroy.
4. **Apply it uniformly** to `events`, `listItems`, `notes`, `lists`, `chores`, `rewards`, `kids`.
5. **Leave `KEEP_PAST_EVENTS_DAYS` alone.** That rule *should* use `e.date` — it is about old events, not old deletions. The two were conflated; separating them is most of this fix.

### The migration (`from < 10`, `SCHEMA_VERSION` 9 → 10)

Existing soft-deleted rows have no `deletedAt` and there is no way to recover when they were deleted. Two options:

- **(a) Leave them unstamped.** Invents nothing. But under the rule above they are then kept *forever*, and at a 5 MiB ceiling that is a slow leak with no bound.
- **(b) Stamp them with today's date.** Gives every existing tombstone a fresh 90 days from the upgrade.

**Recommendation: (b)**, and it should be stated plainly in the migration comment that today's date is a *chosen* value, not a recovered one. It is additive, it errs toward keeping, and it cannot destroy anything sooner than 90 days from the upgrade. Option (a)'s unbounded growth is the worse failure at this ceiling.

### The window: 30 days, and a 24-hour floor

**`KEEP_SOFT_DELETED_DAYS` changes from 90 to 30.** §1.4: Drive, Photos, Notes and Dropbox all use 30 for consumers, and Google charges trash against the quota and says so. At a 5 MiB ceiling with four copies of state, 90 has no precedent behind it and a real cost.

**Separately, prune never touches a row deleted within the last 24 hours**, whatever the window says:

```js
const freshCutoff = daysAgoISO(1);
const oldDeleted = row => row.deleted && row.deletedAt
                       && row.deletedAt < deletedCutoff && row.deletedAt < freshCutoff;
```

This is the fix for D9 (`manualPrune` invalidating a live undo toast), and it removes the race outright rather than warning about it — NN/g: *"no action with consequences to users should be taken without informing them."* A warning tells you about a problem; this removes it. Two lines, no UI.

### The Recently Deleted screen

Per §1.4 conclusion 3, the window is only worth its storage if there is a way to reach it. Modelled directly on `renderSetDismissed` (`index.html:10831-10902`), which is already this exact pattern for suppressions.

- **A new settings sub-screen**, `setDeleted`, reached from a hub row beside the existing Dismissed row (`renderSettings`, `index.html:10607-10626`).
- **Lists every soft-deleted row across all seven collections**, newest deletion first, each showing what it was, which collection, and how many days remain.
- **Two actions per row:** *Restore* (clears `deleted`/`deletedAt`) and *Delete permanently* (drops it now).
- **Rule 29 applies:** with nothing deleted, the screen shows a sentence, not an empty list — check `.length`, never truthiness.
- **Rule 23 applies:** the restore control goes into `mustSurvive` **the day it ships**, and the screen goes into `tools/a11y-audit.js` SCREENS, or a test fails the build.
- The hub row shows live state like every other row ("Recently deleted / 4 items"), per the settings-hub test.
- Storage screen (`index.html:10964`) gains one line in Google's wording: *"Deleted items still use storage until they're cleared."*

### Risk this introduces, honestly

Rows that used to vanish immediately now live up to 30 days. I **cannot** quantify the cost without your real data — it depends entirely on how much you delete. Three mitigations:

- The new screen makes the cost visible and gives a one-tap way to clear it, rather than leaving it to be inferred.
- `manualPrune` still exists as the bulk lever.
- The storage screen already shows usage against 5,000 KB and will now say what trash costs.

**Not in this batch, logged as its own finding:** Material 3 says a snackbar carrying an action *"should remain on the screen until the user takes an action on the snackbar, or dismisses it"*; FlyerSnap's undo toast auto-dismisses at 7 s (`index.html:4142`). Once the Recently Deleted screen exists this stops being a data-loss issue and becomes a UX one, which is why it moves to the delete-honesty batch.

### Tests

- A row deleted today survives prune; a row with `deletedAt` 31 days ago does not; a row with `deleted:true` and **no** `deletedAt` survives.
- A row deleted 23 hours ago survives even if the window were set to 0 — the 24-hour floor is tested independently of the window, or it can pass for the wrong reason.
- Each of the seven collections gets the same cases — no sampling one and assuming the rest, which is how this class of bug got in.
- An event dated two years ago but deleted today is **kept** (the exact case that is broken now).
- Migration: an existing `{deleted:true}` row comes out with a `deletedAt` and is not destroyed on the same run.
- Recently Deleted screen: renders a sentence when nothing is deleted (`.length`, not truthiness); Restore clears both fields and the row reappears in its collection; Delete permanently removes it; the hub row reads live state.
- The restore control is in `mustSurvive`; `setDeleted` is in `tools/a11y-audit.js` SCREENS. Both registrations are themselves mutation-tested, per rule 23.
- **Mutations:** (a) revert `oldDeleted` to the old per-collection filters → the event case must go red specifically; (b) remove the 24-hour floor → the 23-hour case must go red; (c) remove the `mustSurvive` entry → the reachability test must go red.

---

## 3. D2 — a failing save must never be silent

### The bug

`index.html:3889-3895`. `storageWarned` gates the alert and is cleared only by a successful save, so save #2 onward after storage fills produces no alert, no toast, no log, no flag. The comment on line 3890 states the exact outcome line 3891 causes.

### The constraint that shapes the design

`logProblem` calls `save()` (`index.html:7075`). **`save()`'s catch calling `logProblem` would recurse until the stack blows.** This is why the fix is not "just log it".

### The change

1. **Classify the failure** using MDN's test (§1.1), so the message matches reality:
   - `e instanceof DOMException && e.name === 'QuotaExceededError'` **and** `localStorage.length !== 0` → genuinely full → the existing "export a backup, clear out old records" text.
   - Otherwise → "This browser is not letting FlyerSnap save (private browsing, or site data is blocked)." Different problem, different fix.
2. **Set a sticky module flag** `saveFailed = { at, kind }`, cleared on the next successful save.
3. **Render a persistent banner** whenever `saveFailed` is set — top of `render()`, styled like the existing recovery banner, saying *"Not saving — your changes are only on this screen"* with a button to Settings → Backup. Persistent beats a repeat modal: the alert can be dismissed and forgotten, a banner cannot.
4. **Log it on recovery, not on failure.** When a save *succeeds* while `saveFailed` was set, call `logProblem('Storage', …)` then. That records the incident, cannot recurse (the save already worked), and `'Storage'` is already on the `CONTENT_FREE_WHERE` allowlist added in v9.77 so it stays diagnostics-only.
5. **Record whether persistence was granted** — `navigator.storage.persist()` returns a boolean the app throws away (`index.html:11806`). Store it and put it in the diagnostics file next to `hasApiKey`. One field; answers "was this phone allowed to keep my data?" the next time something vanishes.

### Tests

- The existing `store._fail` harness (`tests.js:19`) already simulates a throwing `setItem` — a quota failure makes two consecutive saves and the banner state must still be set on the second.
- A non-quota throw produces the *other* message, not "storage is full".
- A successful save after a failure clears the flag **and** logs exactly one problem.
- **Mutation:** restore `if(!storageWarned)` and confirm the second-save test fails.

---

## 4. F5 — one importer, one shape check, one place that adopts parsed data

### The bug

`index.html:11717-11733`. Only `events` is validated; `Object.assign(blank(), data)` copies a `null` collection straight over the default; `save(); render();` sit inside the `try`, so a crash *after* the overwrite is reported as "that file is not a FlyerSnap backup"; and the weak check in `load()` (`:3858`) means the bad state loads "successfully" next launch, so `S.__locked` never fires and the recovery screen is unreachable.

### The change — scaffold first

Three functions currently turn parsed JSON into `S`, and they disagree:

| | validates | nested settings merge | `migrate()` | `applyTheme()` |
|---|---|---|---|---|
| `load()` `:3850` | `events` only | yes | yes | n/a |
| `importBackup()` `:11717` | `events` only | **no** | **no** | **no** |
| `restoreSnapshot()` `:4001` | none | **no** | **no** | **no** |

**Phase 1 (scaffold, zero behaviour change):** extract `adoptParsed(parsed)` — validate, merge, migrate, return `S` — and have `load()` call it. Prove by test that `load()` behaves identically. Nothing else moves yet.

**Phase 2:** point `importBackup` and `restoreSnapshot` at it. That closes F5 *and* the `restoreSnapshot` divergence in one move, and makes a fourth divergence impossible.

**Phase 3:** the import-specific safety:

1. ~~**Validate every collection `blank()` declares as an array** — not just `events`. A wrong type is a refusal, not a coercion.~~
   **CHANGED IN IMPLEMENTATION (v9.80): coerced, not refused.** The plan was wrong and the code told me so. `migrate`'s `from < 8` block already coerces a junk `notes` on purpose — *"coercing here is cheaper than making every reader defensive, and it destroys nothing that was ever usable"* — and an existing test, `'a save whose notes key is junk is coerced, not trusted'`, pins that behaviour with `notes = 'not an array'`. Refusing would have broken it, and would send the user to the recovery screen over a value that was **never data** — `null` where an array belongs is corruption, not content, so replacing it with `[]` loses nothing recoverable. (Worth stating precisely, because the two are easy to run together: an *empty* collection — `kids: []` — is a real and correct state meaning "no people yet", and a file that simply **omits** the key was never broken at all; `Object.assign` leaves `blank()`'s default in place. The bug was only ever a key **present** carrying junk, which overwrites that default. Measured: all 13 empty collections cost 175 bytes, ×4 with the snapshots — 0.013% of the 5 MiB ceiling — so keeping them is free, and the shape guarantee saves a guard at every one of the app's hundreds of read sites.) The coercion runs **after** `migrate` so migrate's own repairs are not undone. The residual risk — a collection arriving as some other *shape* is discarded rather than quarantined — is accepted and written into the code comment; this app has never written one.
2. **Force a snapshot before the overwrite**, bypassing the daily throttle (`snapshot({ force:true })`). Today, if a snapshot was already taken in the last 24h, the pre-import state exists nowhere.
3. **Move `save(); render();` out of the `try`**, with their own catch that says what actually happened and offers Settings → Backup → Restore.
4. **Call `applyTheme()`** after adopting, so a light-theme backup does not leave the wrong palette until relaunch.

### Tests

- `{"events":[],"kids":null}` is **refused**, and `S` is untouched afterwards.
- Every array collection gets its own refusal case — all of them, not a sample.
- A valid backup with an older `schemaVersion` comes out **migrated**.
- A forced snapshot exists after an import even when one was already taken that day.
- A throw from `render()` does not produce the "not a backup" message.
- **Mutation:** restore the single-`events` check and confirm the `kids:null` case fails.

---

## 5. Phasing

| Phase | Content | Ships as | Risk |
|---|---|---|---|
| 1 | `adoptParsed` extracted, `load()` uses it, tests prove identical behaviour | **v9.78** ✅ **DONE** | low |
| 2 | D2 (save failure) + persist-granted field | **v9.79** ✅ **DONE** | low; no stored-shape change |
| 3 | F5 (import/restore through `adoptParsed`) | **v9.80** ✅ **DONE** | medium; touches the restore path |
| 4a | D1 storage half: `deletedAt` at all eight sites, `SCHEMA_VERSION` 10, 30-day window, 24-hour floor, `oldDeleted` used | v9.81 | **highest — changes the stored shape.** Alone, so if anything is wrong there is exactly one suspect |
| 4b | D1 surface half: the Recently Deleted screen, hub row, `mustSurvive` + SCREENS registrations, storage-screen line | v9.82 | medium; new screen, no stored-shape change |

**Correction to revision 1:** phase 1 was written as "no version bump — refactor only". That is wrong. `deploy.ps1` step 2 stops any push where `index.html` changed without `APP_VERSION` moving, and then stops again if `APP_VERSION` moved without `sw.js` `CACHE` moving (`deploy.ps1`, Step 2). A refactor that touches `index.html` is still a release. Phase 1 shipped as v9.78.

**A harness limit found in phase 2, worth recording because it will come up again:** the test sandbox's `document.getElementById` returns a **new stub object on every call** (`tests.js`), so no test can hold the same element `render()` writes into. Anything about what `render()` puts on screen has to be split — behaviour tested on a pure builder, wiring pinned by a guard that reads `render()`'s source. Testing only the builder would be the exact failure rule 30 describes.

**One thing phase 2 had to deal with, found while writing phase 1:** `tests-cases.js` has a test called `'a full disk warns loudly, once'` which pins the *current* once-only behaviour — i.e. an existing test asserts the D2 bug. It will have to be rewritten, loudly and with the reason stated, the same way v9.77 handled the `'Scanning'` row.

D1 last is deliberate. It is the only one that migrates data, and CLAUDE.md is right that `migrate` is the most consequential code in the app. Splitting it at 4a/4b keeps the migration in a release of its own: if a tombstone goes missing after 4a there is one suspect, and if a screen misbehaves after 4b the data is already known good.

---

## 6. Acceptance criteria

- `node tests.js` green at every phase; no existing test loosened. Any existing test that must change is called out in the message with the reason, as v9.77 did for the `'Scanning'` row.
- Every new guard mutation-tested against a real revert of its own fix.
- After phase 4: `grep -c "deletedAt" index.html` ≥ 9 (eight delete sites plus the prune rule).
- After phase 3: `adoptParsed` has exactly three callers and no fourth path constructs `S` from parsed JSON.
- Logan verifies on the installed PWA before each is called done: delete something and confirm it is still gone-but-recoverable; import a good backup; import a deliberately broken one.

---

## 7. Decisions — settled 31 Aug 2026

| Question | Decision | Basis |
|---|---|---|
| 90 days or 30? | **30** | §1.4: Drive, Photos, Notes and Dropbox-consumer all use 30; Google charges trash against quota and says so; 5 MiB ceiling with four copies of state |
| Warn about `manualPrune`, or make it safe? | **Make it safe** — prune skips anything deleted in the last 24 hours | NN/g: *"no action with consequences to users should be taken without informing them."* A warning describes the problem; the floor removes it |
| Show the deleted count? | **Yes, as a Recently Deleted screen**, not a number on the storage screen; plus one line of Google's wording about trash costing storage | §1.4 conclusion 3 — every comparable product gives deleted items a visible home |
| Undo toast auto-dismissing at 7 s against Material's guidance | **Logged as its own finding, fixed in the delete-honesty batch** | Touches every `softDelete` call site; changes how the whole app feels; not a storage fix |
| Migration stamp for existing tombstones | **Stamp with today's date**, stated in the comment as a chosen not a recovered value | Additive, errs toward keeping, cannot destroy sooner than 30 days from the upgrade; the alternative leaks forever at 5 MiB |

No open questions remain. Ready for step 3 (scaffold) on your word.

---

## Sources

- [MDN — *Using the Web Storage API*](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API) — the `storageAvailable()` detection helper and the private-mode caveat.
- [MDN — *Storage quotas and eviction criteria*](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) — the 5 MiB `localStorage` limit, the eviction cases, best-effort vs persistent.
- [MDN — *StorageManager.persist()*](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist) — the boolean result the app currently discards.
- [WebKit — *Updates to Storage Policy*](https://webkit.org/blog/14403/updates-to-storage-policy/) — exclusion from eviction for an active page or persistent-mode storage.

Competitive and design research (§1.4):

- [Google — *Learn what happens when you delete a file in Google Drive*](https://support.google.com/docs/answer/14933051) — 30 days, and trash counts against storage.
- [Apple — *Delete or hide photos and videos on iPhone*](https://support.apple.com/guide/iphone/delete-or-hide-photos-and-videos-iphb4defbde9/ios) — 30 days, Recently Deleted collection.
- [Apple — *Delete and recover notes on iCloud.com*](https://support.apple.com/guide/icloud/delete-and-recover-notes-mm2f42f05cb9/icloud) — 30 days.
- [Dropbox — *What happens when I delete files in Dropbox?*](https://help.dropbox.com/delete-restore/deleted-files) — 30 days consumer, 180/365 on business tiers.
- [Material Design 3 — *Snackbar guidelines*](https://m3.material.io/components/snackbar/guidelines) — a snackbar with an action should not auto-dismiss; a snackbar must not be the only route to a core use case.
- [NN/g — *Visibility of System Status*](https://www.nngroup.com/articles/visibility-system-status/) — no consequential action without informing the user.
- [NN/g — *User Control and Freedom*](https://www.nngroup.com/articles/user-control-and-freedom/) — the "emergency exit" heuristic.
- [Apple HIG — *Undo and redo*](https://developer.apple.com/design/human-interface-guidelines/undo-and-redo) — show the result of an undo; avoid arbitrary limits on undo.

- The codebase itself at `2fc7206`, cited by `file:line` throughout.
