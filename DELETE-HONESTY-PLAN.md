# Delete-honesty plan — the second review batch

Status: **plan only. No code changed by this document.**
Written 31 Aug 2026 against **v9.83** (`index.html:4639`), commit `520d37c`.
Covers review items **D3, D7, D8, D9, A2, A3** from `FLYERSNAP-REVIEW-2026-08-31.md`,
plus **two new findings** the v9.82/v9.83 work introduced or exposed.

---

## 0. What the last batch already fixed — verified, not assumed

Three of the six items are wholly or partly closed by the Recently Deleted work.
Each was re-checked against the current file, not carried over from the review.

| Item | Review claim | State at v9.83 | Evidence |
|---|---|---|---|
| **D7** (first half) | The bulk-delete sheet says *"Deleting can be undone from Settings"* and no such screen exists | **FIXED.** The sentence is now true. | Sheet copy `index.html:8531`; the screen it promises is `renderSetDeleted` at the `setDeleted` sub-view |
| **D9** | `manualPrune` hard-drops a just-deleted row, so a live Undo closure restores nothing | **FIXED for the tombstone rule.** `oldDeleted` requires `deletedAt < now-30d`, so a row deleted seconds ago cannot be pruned. | `index.html:4093` |
| **D8 / D7 (second half)** | `clearChecked`, `bulkDelete` and the `eventActions` "Remove event" delete with no undo | **Downgraded, not fixed.** All three now route through `markDeleted`, so the rows are recoverable from Recently Deleted. What remains is a *feedback* defect, not a data-loss one. | `index.html:9632`, `:8535`, `:8572` |

That reframes the whole batch. The question is no longer "can this be recovered at all"
but **"which destructive actions still have no durable route back"**. There are four,
and they are all in the star system or in suppression lists — not in the delete paths.

---

## 1. Two new findings

### N1 — HIGH (one word) · The Storage screen states the wrong retention window

`index.html:11304`:

```
      deleted items over 90 days old, and events over two years old.</div>`;
```

`KEEP_SOFT_DELETED_DAYS` is **30** (`index.html:4041`). I changed it from 90 to 30 in
v9.82 and did not update this sentence. Recently Deleted interpolates the constant
(`${KEEP_SOFT_DELETED_DAYS}`) and therefore says 30; the Storage screen hardcodes 90.
Both screens are in Settings, two rows apart. A user comparing them sees the app
contradict itself about how long their deleted data survives.

This is mine, and it is exactly the docs-vs-reality drift the review was commissioned
to find. Verified by grep: `90 days` appears nowhere else in `index.html`, `js/`,
`tests*.js` or `CLAUDE.md`.

**Fix:** interpolate the constant, like the screen next door already does. A hardcoded
number beside a constant is a second source of truth.

### N2 — MEDIUM-HIGH · The past-events prune rule ignores the 30-day promise

`pruneData` runs two independent rules over `S.events`, in this order:

```js
  const oldDeleted = row => !!row && row.deleted && !!row.deletedAt && row.deletedAt < deletedCutoff;
  S.events = S.events.filter(e => !oldDeleted(e));            // index.html:4094 - honours 30 days
  ...
  S.events = S.events.filter(e => !e.date || e.date >= eventCutoff);   // index.html:4107 - does not
```

The second rule tests only the event's **own date** against `KEEP_PAST_EVENTS_DAYS`
(730, `index.html:4042`). It does not look at `deleted` or `deletedAt`. So an event
dated more than two years ago that you delete **today** appears in Recently Deleted
saying "30 days left", and the very next prune destroys it — possibly the same prune,
since both rules run inside one `pruneData()` call. Prune runs automatically at boot
roughly monthly (`autoPrune`, `index.html:12227-12234`) and on demand from Settings.

How you reach it without an old calendar: a mis-read date. Extraction produces the
date; a flyer OCR'd as `0202-09-15` or `2019-05-03` is an event the past-events rule
considers ancient the moment it exists.

This is not a regression — the past-events rule predates the review. It is newly
*visible* because v9.83 put a screen in front of the user that makes a promise the
rule below it does not keep. Rule 28 applies: the recovery screen must not be the
thing that is wrong.

**Fix:** the past-events rule should skip rows that are inside their tombstone window,
so the two rules cannot contradict each other. One line.

---

## 2. Reproduction — A2 and A3, run against the shipped code

Not diagnosed from reading. `completionFor`, `starBalances`, `toggleChore` and
`completeChore` were extracted from `index.html` **by line range** (nothing retyped),
given stubs for the four browser-only calls they make, and executed. Output:

```
--- A2: does confirmPendingAction double-count? ---
The Chores tab path (toggleChore) taps twice:
  after tap 1: completions = 1 balance = 5
  after tap 2: completions = 0 balance = undefined

The assistant path (index.html:6971 calls completeChore directly):
  completions = 2 balance = 10
  completionFor() sees only: {"id":"id2","choreId":"c1","kidId":"k1","date":"2026-08-31","stars":5}
  one untick removes ONE row -> balance becomes:
    5 stars for a chore that is now shown as NOT done

--- A3: can a balance go negative? ---
  earned: 5
  after redeeming 5: 0
  after unticking the chore: -5
  toasts shown during that untick: ["TOAST: Olivia earned 5 stars - now at 5"]

--- A3b: a malformed redemption row ---
  balance with a redemption missing stars: NaN
  keys with a redemption missing kidId: ["k1","undefined"]
```

Read that last A2 line carefully: the app ends in a state where the chore renders as
**not done** while the kid still holds 5 stars for it, and no screen in the app can
show you why. The only toast in the whole untick sequence is the *earning* one from
before it — the loss is silent.

### Why the double-count is only reachable from the assistant

`toggleChore` checks `completionFor(id, t)` first and unticks when it finds one
(`index.html:9331`), so tapping twice in the Chores tab cannot double-count.
`confirmPendingAction`'s `complete_chore` branch calls `completeChore` **directly**
(`index.html:6971`), and `completeChore` pushes unconditionally (`index.html:9370`)
with no same-day check. `performRoute` checks at *propose* time (`index.html:6817`)
and nothing re-checks at confirm time. That gap is the bug: a chore ticked in the
Chores tab between Gordon proposing and you saying yes gets a second row.

This is a textbook [time-of-check to time-of-use](https://en.wikipedia.org/wiki/Time-of-check_to_time-of-use)
gap. The propose/confirm split is the app's core safety property, and it is exactly
the shape that opens a TOCTOU window: the check and the write are separated by an
unbounded amount of user time.

---

## 3. Research

### 3.1 Confirmation vs. undo

NN/g is explicit that these are not alternatives and that undo is the one to prefer:
confirmation belongs "before actions with serious consequences", and in particular
"before actions that cannot be undone" — but designers should still "do your best to
offer undo", because "some user errors will remain despite even the best of
confirmation dialogs".
([NN/g, *Confirmation Dialogs Can Prevent User Errors*](https://www.nngroup.com/articles/confirmation-dialog/))

Applied here: FlyerSnap's delete paths now have the durable route (Recently Deleted)
**and** mostly the confirm. The star paths have neither. That is the inversion to fix —
the app is most careful about the thing it can already undo, and least careful about
the thing it cannot.

### 3.2 A timed message is a poor home for the only route back

WCAG 2.0/2.1 Success Criterion 2.2.1 *Timing Adjustable* requires that for each
time limit set by the content, at least one of: the user can turn it off; adjust it
over at least a 10x range; be warned and given 20+ seconds to extend it (10+ times);
or the limit is real-time, essential, or over 20 hours.
([W3C, *Understanding SC 2.2.1*](https://www.w3.org/TR/UNDERSTANDING-WCAG20/time-limits-required-behaviors.html))

FlyerSnap's `toast(msg, action)` dismisses after 7000 ms (`index.html:4298`) with no
way to extend it. **My reading, not the spec's words:** where that toast is the *only*
route back — redemptions and chore unticks — the app fails to meet any of the listed
alternatives. Where a durable screen also exists (the seven soft-delete collections),
the toast is a convenience and the timer is fine. That distinction is the design rule
this plan uses throughout.

Android's own Snackbar API supports this reading: it ships `LENGTH_INDEFINITE`
alongside the two timed constants specifically so a snackbar can stay until acted on.
([Android, `Snackbar` API reference](https://developer.android.com/reference/com/google/android/material/snackbar/Snackbar))

### 3.3 Never destroy a posted entry — post a reversal

The standard treatment for a value ledger is that entries are immutable; a mistake is
corrected by writing a *compensating* entry, not by editing or deleting the original.
Modern Treasury's argument is that mutation means the record is "irreversibly destroyed
and then becomes impossible to figure out what changed", and prescribes instead to
"completely reverse the ledger transaction by creating a new ledger transaction with
the opposite amount".
([Modern Treasury, *Enforcing Immutability in your Double-Entry Ledger*](https://www.moderntreasury.com/journal/enforcing-immutability-in-your-double-entry-ledger))

FlyerSnap has a real ledger — `S.completions` and `S.redemptions`, rendered as Star
History (`renderLedger`, `index.html:9450`). `toggleChore`'s untick **splices a row
out** (`index.html:9331`), which is precisely the mutation this rule forbids, and it
is why the Star History screen cannot explain a balance that changed. See §5 for the
honest trade-off on adopting this fully — it is not free here.

---

## 4. Findings, ranked by whether there is a route back

| # | What | Durable route back? | Confirm? | Feedback? | Severity |
|---|---|---|---|---|---|
| **A3a** | `toggleChore` untick destroys a completion and its stars | **none** | no | **none** | **HIGH** |
| **A3b** | Balance renders negative; a malformed redemption yields `NaN` or `bal["undefined"]` | n/a | n/a | wrong number shown as fact | **HIGH** |
| **A2a** | `confirmPendingAction` re-completes an already-done chore, double-counting stars | none | the Ask confirm | a toast that reports the wrong total | **HIGH** |
| **A2b** | `completeChore` toast has one argument, so there is no Undo | none | no | acknowledgement only | **MEDIUM** |
| **A2c** | With no resolved person, "Mark 'Bins' done" calls `toggleChore`, which can **un**-complete | none | the Ask confirm | none | **MEDIUM** |
| **redeem** | Undo exists but lives only in a 7-second toast | **none after 7s** | no | good toast | **MEDIUM** |
| **N1** | Storage screen says 90 days; the constant is 30 | n/a | n/a | contradicts the next screen | **HIGH (one word)** |
| **N2** | Past-events prune destroys a tombstone inside its 30 days | n/a | n/a | Recently Deleted shows a false countdown | **MEDIUM-HIGH** |
| **D3** | "Done (remove nothing)" writes a permanent `notDuplicates` suppression, toasts "Kept everything" | ~~none~~ **yes** — see the correction below | no | **actively wrong** | **MEDIUM-HIGH** |
| **D7b** | `bulkTag` overwrites `personIds` for N events | **none** | no | toast, no undo | **MEDIUM** |
| **D8/D7c** | `clearChecked`, `bulkDelete`, `eventActions` remove | **yes** (Recently Deleted) | mixed | `clearChecked` silent | **LOW-MEDIUM** |

**Correction (31 Aug, while building Phase 3).** The D3 row above said "none" for a
route back. That is wrong, and it was wrong when I wrote it. Settings → Dismissed
Warnings has listed every `notDuplicates` pair individually with a "Bring back"
button since **v9.66** (`renderSetDismissed`, `restoreNotDuplicate`), and
`dismissedCount()` counts them. I checked `applyDedupe` and `dismissGroup` and did
not check the screen that undoes what they write, then filed the result as a
verified finding. D3 is a *feedback* defect, not a data-loss one: the record is
recoverable, but nothing told you a record had been written, so you would never
think to go looking. That still needs fixing, and it is still rule 26 — it is one
severity band lower than the table claimed.

The rows with **no route back at all** are therefore A3a, A2a and `redeem` after 7s.
Everything else is polish on top.

---

## 5. Recommendations

### 5.1 The star system (A2, A3) — recommended: make the transitions honest, keep the data model

Two options, and I want your call on this one.

**Option A (recommended) — guard the arithmetic, confirm the loss, offer the undo.**

1. `starBalances` treats both loops the same way — guard `r.kidId`, default `r.stars`:
   ```js
   for(const r of S.redemptions){ if(r.kidId) bal[r.kidId]=(bal[r.kidId]||0)-(r.stars||0); }
   ```
   This kills `NaN` and `bal["undefined"]` outright. It is a one-line change to the
   line directly below the completions loop, which already does exactly this.
2. `completeChore` gains the same-day check `toggleChore` already has, so the assistant
   path cannot double-count. Deterministic rules belong in code, not in a prompt (rule 5).
3. `completeChore`'s toast gains an Undo that removes the row it just pushed — the same
   shape `redeem` already uses at `index.html:9437`.
4. `toggleChore`'s untick, **when the completion carried stars**, confirms first and
   then offers Undo. Untick with zero stars stays a silent instant toggle — that is the
   common case and does not need ceremony.
5. `confirmPendingAction`'s `complete_chore` branch stops calling `toggleChore` in the
   no-person case, so a button reading "Mark X done" can never un-complete. It either
   completes with no kid, or asks who.

Cost: five small edits, no schema change, no migration, Star History unchanged.

**Option B — append-only completions, per §3.3.** Never splice; write a reversing row
and make `completionFor` mean "latest event for this chore+day wins". Star History then
shows the untick as a `-5` line and the screen can explain every balance.

Honest cost: `completionFor` is the *state* of "is this chore done today", read by
`renderChores` (`index.html:9271`), the `allDone` celebration (`:9259`) and the
assistant. Turning it into an event fold changes the chore tick's core semantics,
needs a schema bump and a migration, and grows `S.completions` monotonically against a
5 MiB ceiling. That is a genuine redesign, not a fix, and it is more risk than the four
defects justify **today** — but it is the right end state if the star system grows.

**My recommendation: A now, B recorded as the direction.** Say the word if you want B.

### 5.2 `redeem`'s undo (MEDIUM)

The undo is well written and lives in a 7-second toast. Per §3.2 that is the only route
back for a value-bearing action. Cheapest honest fix: give Star History a "Undo this"
control on redemption rows from the last 24 hours. That makes the toast a convenience
rather than the whole safety net, which is the same shape Recently Deleted gave the
delete paths. **This one I have not costed properly — flagging it, not proposing code.**

### 5.3 D3 — the dedupe suppression

`applyDedupe`'s "keep both" branch (`index.html:8453-8461`) writes `notDuplicates`
permanently. Its sibling `dismissGroup` already does this correctly and says why in a
comment citing review P6-02 (`index.html:8381-8389`): it collects only the keys **this
tap** contributed and offers an Undo that removes exactly those.

**Fix: do what the sibling does.** Collect the keys added during `applyDedupe`, and
when the tap suppressed anything, say so and offer the undo — instead of
`'Kept everything'`, which is false. Two behaviours in one tap need two sentences:
`Removed 2 duplicates - 1 pair kept as different` with an Undo for the suppression half.

This is rule 26 on the one path that was missed, and the correct implementation is
already in the file eight lines away.

### 5.4 D7b — `bulkTag`

`bulkTag` (`index.html:8549`) sets `e.personIds = personId ? [personId] : []` for every
selected event, destroying multi-person tags. `delKid` (`index.html:11938`)
snapshots exactly this array — live object refs plus their prior values — so its Undo
restores the person *and* every tag. The pattern exists.

**Fix:** snapshot `{id, personIds, kidId}` for each changed event before the loop and
offer Undo in the existing toast. The sheet already warns "Tagging replaces existing
tags", so the behaviour is intended; only the way back is missing.

### 5.5 D8 / bulkDelete / eventActions — feedback only

All three are recoverable now. What is left:

- `clearChecked` (`index.html:9632`) deletes a finished shopping list silently. Give it
  the count and an Undo, like `delItem` above it.
- `bulkDelete`'s toast (`index.html:8544`) reports the count with no Undo. Add one.
- `eventActions`' "Remove event" (`index.html:8572`) does `markDeleted` + `save` +
  `render` with no toast at all. It should call `softDelete('events', ...)`, which
  produces the toast and the undo, instead of open-coding half of it.

### 5.6 N1 and N2

N1: replace the hardcoded `90` at `index.html:11304` with `${KEEP_SOFT_DELETED_DAYS}`.

N2: the past-events rule skips rows still inside their tombstone window:

```js
  S.events = S.events.filter(e => !e.date || e.date >= eventCutoff || (e.deleted && !oldDeleted(e)));
```

so the countdown Recently Deleted shows is the countdown that is actually honoured.

---

## 6. Phasing

Each phase is independently shippable and independently testable. `index.html` changes
in every one, so **each phase needs its own `APP_VERSION` + `CACHE` bump** —
`deploy.ps1` step 2 refuses a push where `index.html` moved and the version did not.
That is the mistake I made in the last plan; recording it so it is not repeated.

| Phase | Contents | Version |
|---|---|---|
| **1** | N1 (the 90/30 word) and N2 (the prune rule) — the two places the app currently contradicts itself | **v9.84 — DONE**, see §10 |
| **2** | §5.1 Option A: the five star-system edits | **v9.85 — DONE**, see §11 |
| **3** | §5.3 D3 dedupe suppression + undo | **v9.86 — DONE**, see §12 |
| **4** | §5.4 `bulkTag` undo, §5.5 the three feedback fixes | v9.87 |
| **5** | §5.2 redemption undo from Star History — only if you want it, after costing | — |

## 7. Acceptance criteria

Every guard gets mutation-tested by a **real revert** — the change is undone in the
file, the test must go red, the change is restored (rule 30). A guard that passes for
the wrong reason is worse than no guard, and M29 in the last batch caught nothing
until it was tested that way.

1. `starBalances` returns a finite number for a redemption missing `stars`, and writes
   no `undefined` key for one missing `kidId`.
2. Calling `completeChore` twice for the same chore and day produces **one** completion.
3. Unticking a chore that carried stars does not silently reduce a balance: the path
   goes through a confirm, and declining leaves the completion intact.
4. A balance cannot render negative from an untick.
5. `applyDedupe` that suppresses a pair does not toast `'Kept everything'`, and the
   suppression it wrote is removable.
6. `bulkTag` undo restores a two-person `personIds` array exactly.
7. An event dated three years ago and deleted today survives a `pruneData()`.
8. The Storage screen's retention sentence and `KEEP_SOFT_DELETED_DAYS` cannot disagree
   — asserted by deriving the expected string from the constant.

## 8. Decisions (answered by Logan, 31 Aug 2026)

| # | Question | Decision |
|---|---|---|
| 1 | §5.1 Option A or B | **Option A** — the five small edits. B stays recorded as the direction if the star system grows. |
| 2 | Untick that destroys stars | **Confirm only when the balance would go negative** — i.e. only when the stars being removed have already been spent. An ordinary untick stays an instant, silent toggle. |
| 3 | §5.2 redemption undo | **Yes, build it.** Promoted from "only if you want it" to a real phase. Still to be costed before code. |

Phase 5 is therefore in scope. The phasing table above stands otherwise.

---

## 9. The questions as originally asked

1. **§5.1: Option A or Option B?** A is five small edits with no migration. B is the
   textbook ledger and a real redesign of what "done today" means.
2. **§5.1 item 4:** should unticking a chore that earned stars *confirm*, or just toast
   with an Undo? A confirm interrupts a kid tapping their own chart; an undo does not,
   but can be missed. My lean: confirm only when the untick would push the balance
   below what has already been spent — the case where stars are genuinely destroyed.
3. **§5.2:** is a redemption undo in Star History worth a phase, or is the 7-second
   toast good enough for your house?


---

## 10. Phase 1 as built (v9.84)

### The code

`index.html:11320` — the Storage screen now reads the constant:

```js
      deleted items over ${KEEP_SOFT_DELETED_DAYS} days old, and events over two years old.</div>`;
```

`index.html:4122` — the past-events rule defers to a dated tombstone:

```js
  S.events = S.events.filter(e => !e.date || e.date >= eventCutoff ||
                                  (e.deleted && !!e.deletedAt));
```

`APP_VERSION` v9.83 → v9.84, `sw.js` `CACHE` flyersnap-v166 → v167.

### What changed from §5.6 while building, and why

The plan proposed `(e.deleted && !oldDeleted(e))`. **That third clause is dead
code and it is not in the shipped line.** Mutation test M31 proved it: reverting
`!oldDeleted(e)` to nothing turned no test red, and the reason is that the
tombstone rule runs earlier in the same function and has already removed every
expired tombstone by the time this line executes. No reachable state lets that
clause change an outcome. It would have read like a safety net and been decoration
— the same dead-logic mistake as the 24-hour prune floor in the last plan, caught
this time by mutation testing instead of by rereading.

`!!e.deletedAt` replaced it, and unlike the clause it replaced it is load-bearing:
an undated tombstone is deliberately kept by the rule above ("unknown is never a
licence to destroy"), so exempting it here too would have created the one row in
the app that nothing can ever clear.

### Tests added (806 total, from 804)

| Test | Guards |
|---|---|
| `an event past the two-year window still gets its full tombstone` | N2 itself |
| `an UNDATED tombstone keeps the sweep it has always had` | the `!!e.deletedAt` clause |
| `a stray deletedAt on a LIVE row does not buy it an exemption` | the `e.deleted` clause |
| `a LIVE event past the two-year window is still pruned` | the past-events rule still works |
| `an EXPIRED tombstone still goes, however old the event was` | whole-function property |
| `the Storage screen states the REAL retention window` | N1 |

The existing v9.82 guard `deleting an old event does not make it disappear on the
next prune` used `dayAhead(-400)` — inside the 730-day window, so it could never
have seen N2. It was 330 days short.

### Mutation tests — every guard reverted for real

| # | Revert | Result |
|---|---|---|
| **M30** | remove the whole exemption clause | **RED** — `an event past the two-year window still gets its full tombstone`, correct message, and nothing else |
| **M31** | remove `!oldDeleted(e)` from the *originally planned* line | **GREEN — caught nothing.** The clause was dead; the plan's §5.6 wording was wrong and the shipped line does not contain it |
| **M31b** | remove `!!e.deletedAt` | **RED** — `an UNDATED tombstone keeps the sweep it has always had` |
| **M32** | remove `e.deleted` | **RED** — `a stray deletedAt on a LIVE row does not buy it an exemption` |
| **M33** | put the hardcoded `90` back | **RED** — `the Storage screen states the REAL retention window` |

`an EXPIRED tombstone still goes` is recorded in its own comment as a test that
does **not** guard the exemption clause — no fixture can make it do so, because
the tombstone rule removes the row first. Saying so in the file is the point:
a test that looks like a guard and is not one is the failure rule 30 exists for.


---

## 11. Phase 2 as built (v9.85)

All five edits from §5.1 Option A, plus one that fell out of doing them properly.

| # | Change | Where |
|---|---|---|
| 1 | `starBalances`' redemptions loop guards `kidId` and defaults `stars`, matching the completions loop one line above it | `starBalances` |
| 2 | `completeChore` carries the same-day guard, and returns `false` when it refuses | `completeChore` |
| 3 | `completeChore`'s toast carries an Undo that removes **the row this call pushed**, by reference | `completeChore` |
| 4 | `toggleChore`'s untick confirms **only** when the balance would go below zero | `toggleChore` |
| 5 | `confirmPendingAction`'s `complete_chore` branch never calls `toggleChore` | `confirmPendingAction` |
| 6 | *(new)* the "who did it?" sheet is one function, `askWhoDidChore`, shared by the Chores tab and the assistant | new function |

Item 6 was not in the plan. Writing item 5 meant the confirm path needed the same
sheet the Chores tab shows, and copying it would have made a second source of truth
for a question that has to stay identical in both places.

### One behaviour change beyond the plan

`completeChore` now toasts on a **starless** tick as well, with the same Undo. It
said nothing at all before. In the Chores tab a second tap undoes it, so the silence
was survivable; on the assistant path there is no second tap, and Gordon was changing
the day's state and reporting it in silence. Flagging it because it is a visible
change to an everyday tap that the plan did not ask for.

### Verified against the shipped functions, before and after

The §2 reproduction script was re-extracted from v9.85 by line range and re-run:

```
--- A2: the assistant path, same sequence as before ---
  completions = 1  balance = 5
  what it said: ["TOAST: \"Bins\" is already done today"]

--- A2c: "Mark Bins done" when it is already done ---
  it asks who rather than unticking: "Bins / Who did it?"

--- A3: earn 5, spend 5, untick ---
  declining -> balance: 0  completions: 1
  it asked: "Olivia has already spent these 5 stars. | Unticking "Bins" puts them on -5. Continue?"
  accepting  -> balance: -5

--- A3: an ordinary untick still costs nothing ---
  confirms asked: 0  completions: 0

--- A3b: malformed redemption rows ---
  redemption with no stars -> balance: 5
  redemption with no kidId -> keys: ["k1"]

--- the new Undo ---
  TOAST: ⭐ Olivia earned 5 stars — now at 5  [Undo]
  after Undo -> completions: 0  balance: 0
```

Every line that was wrong in §2 is right here, and the two things that should NOT
have changed — an ordinary untick staying silent, an accepted untick still doing
what it said — did not.

### Tests: 815 total, from 806

Nine new behavioural tests, and one existing test updated rather than deleted.

`the assistant calls the app's own functions rather than reimplementing writes`
asserted `fn.includes('toggleChore(')`. That assertion was the proxy for a real
property — *the anyone-chore star sheet is not bypassed* — and the property still
holds, through `askWhoDidChore`. It now asserts **both halves**: the sheet is still
reached, **and** `toggleChore` is not called, which is the whole point of item 5.
The intent is preserved and the guard is stricter than it was.

### Mutation tests — every guard reverted for real

| # | Revert | Result |
|---|---|---|
| **M34** | `starBalances`' redemptions guard | **RED ×2** — the NaN test and the `undefined`-key test |
| **M35** | the same-day guard in `completeChore` | **RED ×2** — `counts once` and `refused OUT LOUD` |
| **M36** | drop `undo` from the star toast | **RED** — `earning stars offers an Undo` |
| **M37** | drop the starless acknowledgement | **RED** — `a STARLESS tick is acknowledged too` |
| **M38** | `after < 0 &&` → `false &&` (never confirm) | **RED ×2** — `ALREADY SPENT asks first` and `never renders negative` |
| **M39** | `after < 0 &&` → `true &&` (always confirm) | **RED** — `an ordinary untick is NOT interrogated` |
| **M40** | confirm branch back to `toggleChore` | **RED** — `the anyone-chore star sheet is bypassed` |

M38 and M39 are a matched pair on purpose: one proves the confirm fires when it
must, the other proves it does not fire when it must not. A single mutation would
have left half the condition untested.

`node tests.js` 815/0 · `inline.js --check` in sync · a11y audit clean across all
48 screens.


---

## 12. Phase 3 as built (v9.86)

### The correction first

§4 said D3 had no durable route back. It has had one since v9.66. See the
correction inserted under the §4 table. The fix below is therefore about telling
the truth, not about building a safety net that already existed.

### Changes

| # | Change |
|---|---|
| 1 | New `dedupeChoice(g)` returns **an id** (keep this one), **null** (an explicit "Keep both"), or **undefined** (no recorded choice). The old code used a plain `!keep`, which made "we do not know" and "the user reviewed these" write the same permanent record. |
| 2 | `applyDedupe` records a suppression **only** for `null` — an actual review decision. |
| 3 | The toast names both halves of what the tap did: `Removed 2 duplicates · 1 pair marked as different`. A tap that changes nothing now says `Nothing changed` rather than `Kept everything`. |
| 4 | That toast carries an **Undo** which reverses the whole tap — un-deletes the removed copies (restoring `dirty` to what it was, not to `1`) and removes **only the keys this tap contributed**, exactly as `dismissGroup`'s undo has done since v9.66. |
| 5 | The button says what tapping it will do: `Remove 2 duplicates, keep 1 pair`, or `✓ Done — mark 1 pair as different`. It no longer reads "remove nothing" on a tap that writes a permanent record. |
| 6 | The screen's help text says "Keep both" is remembered, and names the screen that undoes it. |

### A wrong comment, caught by mutation testing

The first draft of `dedupeChoice`'s docblock asserted that the `undefined` case was
reachable: dismissing one pair of a group of three would regroup the survivors under
a new key. **M44 caught that it was not.** Folding `undefined` back into "keep both"
failed the bogus-id test but *not* the regrouping test — because `dismissGroup`
suppresses **every** pair in the group, which leaves no group at all, so that test
was passing over an empty loop.

Two things were wrong and both are fixed: the docblock now states plainly that the
absent case is **not reachable through the interface today**, with the three reasons
checked rather than assumed (`sub('dedupe')` has one caller; `openDedupe` records a
choice for every group; `dismissGroup` acts on a group whole); and the test now
asserts the property at the function level by clearing `dedupeKeep` directly, with
the earlier wrong version described in its comment so nobody re-derives it.

The distinction is kept because the *other* `undefined` case — a keep-id belonging to
no member of the group — is reachable, and is the P5-07 defect shape.

### Tests: 822 total, from 815

Seven new. No existing test needed changing.

| # | Revert | Result |
|---|---|---|
| **M41** | the old one-line toast | **RED ×4** — the honesty test, the undo test, and the two that depend on the undo existing |
| **M42** | undo clears all suppressions, not only this tap's | **RED** — `undo removes only the keys THIS tap added` |
| **M43** | undo no longer restores the removed copies | **RED** — `undo also puts back the copies the tap deleted` |
| **M44** | fold "no recorded choice" back into "keep both" | **RED ×2** — the absent-choice test and the bogus-id test |
| **M45** | the old `Done (remove nothing)` label | **RED** — `the button says what tapping it will do` |

`node tests.js` 822/0 · `inline.js --check` in sync · a11y audit clean across all
48 screens, `dedupe` included.


---

## 13. Phase 6 as built (v9.87) — D4

Taken out of order at Logan's direction: D4 was the last remaining HIGH with no
route back at all. D5 is deliberately **not** in this phase — see §14.

### The change

`pendingMsgIds`, a module-level array, is gone. The message id now rides on the
review row itself (`msgId`), and the four places that used the global ask a
derivation instead:

```js
function pendingMsgIdsOf(){
  return [...new Set((pendingEvents || []).map(e => e && e.msgId).filter(Boolean))];
}
```

`openEmailReview` and `retryEmailTrouble` set `msgId` when they build a row;
`saveReview`, `dismissPendingEmail` and `renderReview` derive. That makes the
defect unreachable **by construction** rather than by remembering to clear a
second variable: replacing `pendingEvents` replaces the ids, because they are the
same objects.

The behaviour that had to survive did: the ids are derived from **all** rows on
screen, not only the ticked ones. Reviewing an email and choosing none of its
events is still a review, and that email should not come back. What it can no
longer do is mark an email handled because its row was replaced by a photo scan.

### Tests: 825 total, from 822

Three new, and three existing fixtures updated in shape but not in intent — they
set `pendingMsgIds` directly, which no longer exists; they now put `msgId` on the
rows. Every assertion in them is unchanged.

### A test of mine that did not reproduce the real sequence

**M46 caught it.** The headline test walked the reported sequence — email batch,
Back, scan, "Track N items" — and stayed green when the ids were made to outlive
the rows. The reason: the leak only bites once something has *read* the ids while
the email rows were up, and in the app that reader is `renderReview`, which checks
them on every render to decide whether to offer "Skip all from this email". My
test never rendered, so the stale list was never populated and there was nothing
to leak.

Adding the one line the real user performs — looking at the review screen — makes
the test reproduce the defect. That line now carries a comment explaining that it
is load-bearing, so nobody deletes it as scene-setting.

Second time this batch that a mutation caught a test passing for the wrong reason
(the first was M44 in §12). Both would have shipped as green guards over nothing.

### Mutation tests

| # | Revert | Result |
|---|---|---|
| **M46** | ids outlive the rows (the old parallel-global semantics) | **RED ×3** — the photo-scan test, the screen-gate test, and `skipping everything still marks the email handled` |
| **M47** | derive from only the TICKED rows | **RED ×3** — the two-emails test and both existing "chose nothing" guards |
| **M48** | the screen's gate hardcoded to `true` | **RED** — `the "Skip all from this email" control only shows for a real email batch` |

`node tests.js` 825/0 · `inline.js --check` in sync · a11y audit clean across all
48 screens.

---

## 14. D5 — open, and it needs a decision

With D4 fixed, D5's dangerous half is gone: a replaced batch can no longer mark
the wrong emails handled. What remains is narrower than the review implied.

**What D5 actually costs, checked rather than assumed.** `openEmailReview` and
`handleCapture`'s non-append branch both *assign* to `pendingEvents`, destroying a
batch under review. But an abandoned email batch is **not** lost — `seenMsgs` is
only written on save, so the watcher offers those emails again. And a photo is
still on the phone. What is destroyed is the **extraction work**: one model call,
and the user's place in a review. Annoying and surprising; not permanent data loss.
That is a lower severity than the review's MEDIUM implied, and it changes what the
right fix is.

**Why I am not just picking one.** The obvious fix — merge instead of replace —
has two real costs I could not resolve alone:

1. `saveReview` stamps every saved event with a single `pendingSource`. Merge two
   batches and half the events get the wrong provenance. Fixing that means a
   per-row source field, which is more surface than the bug.
2. Merging brings back a batch the user had walked away from. Scan something,
   decide it is junk, back out, scan again — and the junk is on screen again to be
   deselected. Safe, but its own kind of surprise.

**The three options:**

| | What happens when a scan lands on a batch already under review |
|---|---|
| **A** | Ask, after the extraction: "Add to the 3 already here" or "Replace them". Needs the per-row source field. Nothing is lost either way. |
| **B** | Always merge, and toast `Added 3 — 9 from your email are still here`. Needs the per-row source field. No dialog; unwanted rows are one tap from deselected. |
| **C** | Keep replacing, but `confirm()` first: "You have 3 items still under review. Replace them?". No source work at all — the smallest change that stops the silent destruction. |

My lean is **C**, on the grounds that the thing being protected is a model call
rather than data, and A and B both pull in a schema change to fix provenance for a
case that is uncommon. But this is a taste call about your own app, not a
correctness one, so it is yours.

**Decision: C.** Built as v9.88 — see §15.


---

## 15. D5 as built (v9.88)

One guard, `confirmReplacePending()`, declared beside the state it protects, and
asked **before** the model call so declining costs nothing:

```js
function confirmReplacePending(){
  const n = pendingEvents.length;
  if(!n) return true;
  return confirm('You still have ' + n + ' item' + (n === 1 ? '' : 's') +
    ' under review from ' + (pendingSource || 'an earlier scan') + '.\n\n' +
    'Starting a new one replaces ' + (n === 1 ? 'it' : 'them') + '. Continue?');
}
```

Wired into three of the four replace paths: `handleCapture`, `handleLinkCapture`
and `openEmailReview`. Declining sends the user back to the batch they kept
(`sub('review')`) rather than stranding them where they were.

`openEmailReview` is safe to ask from because the background check never reaches
it — `checkEmail(true)` sets `pendingEmailCount` and returns — so the question can
only ever follow a tap. Declining there leaves the queue untouched, since
`seenMsgs` is written on save.

**The fourth path is deliberately different.** The assistant's DRAFT branch does
not open a modal; a dialog appearing out of a chat answer is its own surprise, and
the assistant has a better place to put the message. It refuses and explains:
*"You have 1 item still waiting on the review screen from Photo 2026-08-31. Save
or skip it first, then ask me again and I will draft this one."*

### A harness property that made a correct test fail

The first version of the assistant test was `async` and `await`ed `performRoute`
before reading `pendingEvents`. **It failed while the code was right.**

`tests-cases.js:21` registers an async test's promise in `pendingTests` and
`tests.js:136` settles them all at the very end — so an async test runs
**concurrently with every test declared after it**, and anything it asserts about
shared module state is racing them. A later test had already emptied
`pendingEvents` by the time the assertion ran. The probe made it obvious: the
refusal message was verbatim correct while `pendingEvents.length` read `0`.

Rewritten synchronously: the DRAFT refusal returns without awaiting anything, so
the state assertion is made **before** any microtask can interleave, and only the
answer — a local — is checked in the returned promise. The reason is written into
the test, because the next person to reach for `async` here will hit the same wall.

Worth knowing beyond this test: any existing async in-page test that asserts on
`S` or another module global has the same exposure. Not audited; noted.

### Tests: 829 total, from 825

| # | Revert | Result |
|---|---|---|
| **M49** | the guard always allows the replace | **RED ×2** — `never replaced without asking` and `the question names how many items` |
| **M50** | it asks even when there is nothing to replace | **RED** — `with nothing under review it does not ask at all` |
| **M51** | the assistant drafts over the batch again | **RED** — `the assistant refuses to draft over a batch` |

M49 and M50 are the matched pair again: one proves the question fires when it must,
the other proves a first scan is never interrupted.

`node tests.js` 829/0 · `inline.js --check` in sync · a11y audit clean across all
48 screens.


---

## 16. A1 as built (v9.89) — and the guard that was supposed to prevent it

### The write

`performRoute`'s NAVIGATE branch did this:

```js
    if(target === 'notes' || target === 'lists'){
      S.settings.notesArea = target === 'lists' ? 'lists' : 'notes';
      save();
    }
```

CLAUDE.md states, under "THE ASSISTANT CAN ACT": *"`performRoute()` NEVER writes.
It resolves an entity and proposes."* and, of that list, *"The safety properties
below are each enforced by a test, and none of them is optional."* The write made
the first sentence false and, as it turns out, the second one too.

### The guard did not guard

`tests-modules.js` has a test literally named
`performRoute never writes; confirmPendingAction is the only path that does`.
It checked a **denylist of seven shapes** — `S.lists.push`, `S.listItems.push`,
`S.chores.push`, `S.events.push`, `softDelete(`, `completeChore(`, `markHandled(`.
`S.settings.notesArea = ...; save();` matches none of them.

**Demonstrated, not argued.** With the write restored and the old guard back, the
suite reports **833 passed, 0 failed**. A denylist is the wrong instrument for an
invariant whose entire point is that *unknown* writes are the danger — the same
lesson as the `errorReports` denylist-to-allowlist change in v9.77, which the
review flagged and which had not been generalised.

The guard now asserts two closed properties instead of enumerating shapes:

```js
    assert.ok(!/\bsave\(/.test(pr), 'performRoute persists something ...');
    const assign = pr.match(/\bS\.[A-Za-z_.]+\s*=[^=]/);
    assert.strictEqual(assign, null, 'performRoute assigns into S: ' + ...);
```

Nothing reaches storage except through `save()`; nothing changes the running app
except through an assignment into `S`. The seven named shapes are kept underneath,
because a named shape gives a better failure message than a regex.

A second test was added because those assertions are only as good as the slice
they read: `the guarded slice really is performRoute and nothing else` fails if a
function is ever moved between `performRoute` and `confirmPendingAction`, which
would otherwise put *its* `save()` inside the guard and invite someone to weaken
the guard rather than move the function.

### The fix

The behaviour the write existed for is real: both halves of the Notes tab are
addressable by name, and asking Gordon for notes must not drop you on lists just
because that is where you were last. `nav()` **already did exactly this write** for
`'lists'` — half the rule lived in the router and half in the navigation function.
It now lives entirely in `nav`, which gained an optional `area`:

```js
function nav(tab, area){
  ...
  if(tab === 'lists'){ area = 'lists'; tab = 'notes'; }
  if(area && S.settings) S.settings.notesArea = area === 'lists' ? 'lists' : 'notes';
```

and the NAVIGATE branch is now purely a destination and a navigation.

No `save()` — deliberately, matching what `nav('lists')` has always done. The area
is where you are looking; it rides along with the next write. A tab **tap** passes
no area and is unchanged, so the Notes tab still remembers which half you were on.

### One existing test needed its split widened

`choosing a tab is a deliberate departure and clears the origin` split on the
literal `'function nav(tab){'` and broke the moment `nav` gained a parameter —
while `nav` was doing exactly the right thing. Its own comment already recorded
being bitten this way once in v9.61, when it was tied to the function being a
one-liner. It now splits on `'function nav('`: match the name, not the shape.
Intent and every assertion unchanged.

### Tests: 834 total, from 829

| # | Revert | Result |
|---|---|---|
| **M52** | the write back in `performRoute` | **RED ×2** — the new guard AND `a NAVIGATE route changes no stored data` |
| **M53** | the write back **and** the old denylist guard restored | **GREEN, 833/0** — the proof that the old guard enforced nothing |
| **M54** | `nav` ignores its `area` argument | **RED ×3** — including the pre-existing `nav("lists") still works` guard |
| **M55** | a plain notes tab tap forces the notes half | **RED** — `TAPPING the notes tab still remembers which half you were on` |

M54 and M55 are the matched pair: one proves a named area moves you, the other
proves a plain tab tap does not.

`node tests.js` 834/0 · `inline.js --check` in sync · a11y audit clean across all
48 screens.

### Worth doing separately

`quickRoute`'s change-verb guard, and the routing safety list in CLAUDE.md more
broadly, are also written as enumerations. This batch changed one of them. The
others have not been checked and should not be assumed sound because this one was
fixed.


---

## 17. The guard audit (v9.90) — three of four siblings were hollow

§16 ended by saying that finding one hollow guard is a reason to suspect its
siblings, not to feel better about them. This is that audit. Every verdict below
is a mutation actually run, not a reading of the test.

Run in a synchronised copy of the repo rather than the live one, because
mutation testing means deliberately breaking the code and a deploy firing
mid-mutation would commit a planted bug. That precaution exists because it
already happened once this session.

### Verdicts

| Property (CLAUDE.md, "each enforced by a test") | Mutation | Verdict |
|---|---|---|
| Every write is undoable | **G1** a new `case` that writes with no undo | **RED** — sound, and it named the branch |
| " | **G1b** the same branch plus `// TODO: give this a toast with label:'Undo'` | **GREEN** — read prose, not code |
| Undo by id, never by text | **G2** `create_list` undo rewritten to `filter(l => l.name !== name)` | **GREEN** — it only ever inspected `add_list_item` |
| Call the app's own functions | **G3** `delete_chore` reimplemented crudely | RED, but by two OTHER guards |
| " | **G3b** reimplemented while keeping `markDeleted` and an undo | **GREEN** — presence-only; it never checked for the reimplementation |
| `quickRoute` short-circuits only to read-only intents | **G4b** the change-verb guard DELETED outright | **GREEN** — no test at all |

### The change-verb guard

Two tests, sixteen sentences, and every sentence is an **imperative**. Imperatives
are stopped one check later by `isQuestion`, so not one of the sixteen was ever
stopped by the guard they are named for. Deleting the guard entirely left both
green; the suite's only failure was an unrelated classification mismatch in the
routing corpus.

**A measurement I got wrong first.** Probing which verbs mattered, I ran against a
router that still had 26 of the 30 verbs in place, and concluded only four were
load-bearing. That is the same confounding error as a test passing for the wrong
reason, committed in the measurement instead of the test. Rebuilt against a router
with the guard fully removed: **all 30 of 30 are load-bearing.** Without it,
`"can you add milk to the costco list?"` returns `ask_lists` at 0.95 confidence
with `autoRun=true` — a write answered as a read, never reaching `validateRoute`
or the confirm step.

### The fixes

1. **Undo guard** reads `codeOf(...)`, so a comment cannot satisfy it.
2. **Undo-by-id** now checks **every** branch that pushes a row: the undo must
   mention an `.id`, and must not filter on `name`/`text`/`title`.
3. **Own-functions** gained the absence half: no branch may set `.deleted = true`
   by hand or reach past `softDelete()` to `markDeleted()`.
4. **Change-verb** pins all 30 verbs **in the test** — deriving them from the
   source would be circular — and asserts a question-shaped sentence per verb.

### Re-run

| # | Mutation | Before | After |
|---|---|---|---|
| **G1b** | missing undo behind a comment | GREEN | **RED** |
| **G2** | undo by text in another branch | GREEN | **RED**, naming `create_list` |
| **G3b** | `softDelete` inlined, undo kept | GREEN | **RED** |
| **G4b** | the whole guard deleted | GREEN | **RED** |
| **G4c** | four verbs removed | GREEN | **RED** |
| **G4d** | ONE verb (`del`) removed | GREEN | **RED** |
| **G4e** | `cancel` ADDED (widening) | — | **GREEN**, as the docs require |

G4d and G4e are the matched pair: the smallest narrowing fails, and a legitimate
widening does not. A guard that blocked widening would be deleted the first time
someone needed it.

`tests-modules.js` only — `index.html` and `js/router.js` are untouched, so no
version or CACHE bump. 834/0 on Logan's machine, `inline.js --check` in sync.

### Still not audited

`js/ai-actions.js` is described in CLAUDE.md as the user-facing disclosure list
that "must be updated too — it exists so the promise a user reads cannot drift
from what the code does, and it HAS drifted before." Whether anything enforces
that has not been checked.

---

## 18. Phases 4 and 5 as built (v9.99)

Phase 4 is §5.4 + §5.5; Phase 5 is §5.2, which §6 listed as "only if you want it,
after costing". Logan approved it. Both shipped together because both are the same
sentence — *a change that costs the user something must leave a way back* — and
splitting them would have meant two version bumps for four small edits.

### Phase 4 — the four silent or one-way changes

| Was | Now |
|---|---|
| `bulkTag` overwrote `personIds` with a one-element array, toast with no Undo | snapshots `{e, personIds, kidId}` for every selected row first, Undo restores the multi-person tag exactly |
| `bulkDelete` reported a count, no Undo | Undo puts every row back, `deletedAt` removed not nulled |
| `clearChecked` deleted a finished list **silently** — no count, no toast, no undo | `Cleared 2 ticked items` + Undo; `Nothing was ticked off` when the tap changes nothing |
| `eventActions`' Remove open-coded `markDeleted` + `save` + `render` — the one delete in the app with no toast at all | calls `softDelete('events', …)`, which is where the toast and the undo already lived. The `confirm` stays; losing it was not this fix |

The `bulkTag` snapshot is the `delKid` pattern verbatim (live object refs plus prior
values), which is what §5.4 said to copy.

### Phase 5 — the redemption undo, §5.2

`redeem`'s toast Undo is fine for a mis-tap noticed at once and no use at all for one
noticed over dinner (§3.2). Star History now carries the same undo for a day.

**`date` alone could not support the claim.** A redemption stores `date: todayISO()`,
and "today" is five minutes at 00:05 and twenty-three hours at 23:00 — a 24-hour
window built on it would be a 24-hour window in name only. New redemptions are now
stamped `at: new Date().toISOString()` alongside `date`, which is untouched because
`pruneData`, `starBalances` and the ledger's sort all read it.

Rows written before v9.99 have no `at` and fall back to `date === todayISO()` — the
most the stored data can honestly support, stated as such rather than dressed up.

`canUndoRedemption` gates the button; `undoRedemption` re-checks it, because the
screen can sit open across the boundary. Past the boundary it says
*"That was more than a day ago — it stays on the record"* rather than doing nothing
(a broken-looking button) or doing it anyway (breaking the promise the greyed row makes).

### Tests: 882 total, from 873

Nine new. `withToast()` stands in front of `toast` so the message AND its action are
readable — the harness's `getElementById` returns a fresh stub, so a toast is otherwise
invisible to a test. Always restored in a `finally`.

### Mutation tests — twelve reverts, one at a time

| # | Revert | Result |
|---|---|---|
| P1 | `bulkTag` Undo removed | **RED** |
| P2 | `personIds.slice()` → alias | **GREEN** — see below |
| P3 | `bulkDelete` Undo removed | **RED** |
| P4 | `clearChecked` silent again | **RED** |
| P5 | `clearChecked` toasts an Undo for a no-op tap | **RED** |
| P6 | 24-hour window → any time | **RED** ×2 |
| P7 | `isNaN` guard removed | **GREEN first time** — see below |
| P8 | expired branch returns silently | **RED** |
| P9 | expired branch stops refusing | **RED** |
| P10 | `redeem` stops stamping `at` | **RED** |
| P11 | old-row date fallback removed | **RED** |
| P12 | `eventActions` back to open-coded delete | **GREEN first time** — see below |

**P2 is genuinely redundant, and the comment says so.** `bulkTag` REASSIGNS
`e.personIds`, so the snapshot's alias would still point at the old array. The
`.slice()` is defence against a future edit that mutates in place instead. Kept,
with the comment stating it is defensive rather than load-bearing — a dead clause
with a comment claiming otherwise is what M44 was.

**P7 exposed a weak test of mine.** `canUndoRedemption({at:'not a date', date:'2020-01-01'})`
returns false either way, because `(Date.now() - NaN) < X` is false. The line proved
nothing about the guard. What the guard actually decides is whether a junk `at` makes
the row read as *untimestamped* and fall back to the date — so the case that separates
them is `{at:'not a date', date: todayISO()}`. Added; P7 then went red.

**P12 exposed a change with no test at all.** I rewired `eventActions` and wrote nothing
that touched it. The new test stands in front of `showSheet`, takes the "Remove event"
button's `fn`, and asserts the toast, the Undo and the restored row.

### The a11y audit was green about a control it never rendered

Its seed held one redemption dated `2026-08-19`, so `canUndoRedemption` was false and
the new button never appeared on the ledger screen. Its pass said nothing about this
work. The seed now carries two rows — one old, one an hour ago — so both states render.

Fixed in the same seed: it wrote `cost:10` where `redeem` writes `stars`, so the ledger
had been rendering `-undefined` for that row and nothing had ever looked.

And the audit is **not** a guard on the label. It checks that a control HAS an
accessible name; a bare "Undo" is a name. Measured by stripping the `aria-label` and
watching it stay green. A row of identical "Undo" buttons is precisely what a screen
reader cannot work with, so `aria-label="Undo redeeming Movie night for Olivia"` is
asserted in `tests-cases.js` instead, and mutation-proved there.

### Status

§5.1–§5.6 are now all built. 882/0, 22/0 in the browser, a11y clean across 48 screens,
`inline.js` in sync. v9.99 / `flyersnap-v182`.

---

## 19. noteFolders / noteLabels — measured, and smaller than the note claimed

Carried on the backlog as "`noteFolders`/`noteLabels` tombstones never pruned".
Read before acting, 3 Sep 2026. Most of what that implied is **not true**:

- **No dangling references.** `delNoteGroup` clears `n.folderId` and removes the
  id from `n.labelIds` at delete time, so no note points at a deleted row.
- **No leaked names.** `noteFolderName` already ends `return f && !f.deleted ?
  f.name : ''`, so a deleted folder's name never renders. `noteLabelsOf` reads
  the live-only `noteLabels()`.
- **The tombstone is load-bearing while it exists.** `addNoteGroup` re-uses a
  deleted row by name and un-deletes it, so re-adding "School" restores the
  original id rather than making a second one.

What is actually left is one honesty gap, of the same family as N1 and N2:

> Recently Deleted says **"Anything you delete waits here for 30 days before it
> is cleared for good."** A deleted folder or label is not there, and is never
> cleared. The sentence is false for two collections.

### Why it is not simply fixed by adding them to `DELETED_COLLS`

`restoreDeleted` only calls `unmarkDeleted`. For a folder that gives back an
**empty folder** — the notes were unlinked at delete time and nothing records
which ones they were. A "Restore" button that silently returns less than it took
is the same class of dishonesty this whole plan is about, so adding the row
without more would trade one small lie for a larger one.

### The correct fix, and its cost

`delNoteGroup` already computes `touched`. Storing those note ids on the
tombstone would let `restoreDeleted` re-link them, which makes the row honest
and makes pruning safe. That is a new persisted field, a special case in a
deliberately generic restore path, and its own tests.

**Open — needs Logan's ruling.** The user-visible harm today is a handful of
tiny rows that never age out, against a real change to a data shape. Not built
on my own judgement.
