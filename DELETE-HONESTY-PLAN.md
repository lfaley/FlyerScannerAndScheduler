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
