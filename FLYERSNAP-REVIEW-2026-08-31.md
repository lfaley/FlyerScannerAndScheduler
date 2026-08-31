# FlyerSnap — full code review, 31 Aug 2026

> **Update 31 Aug 2026:** F1, F2 and F4 are fixed in **v9.77** (`sw.js` CACHE
> `flyersnap-v160`); suite went 752 → **761 passing**. Everything else below is
> still open and still accurate as of v9.76.

**Reviewed:** `C:\Users\Logan\Desktop\Repos\FlyerSnap` at `APP_VERSION = 'v9.76'` (`index.html:4455`), `sw.js` `CACHE = 'flyersnap-v159'` (`sw.js:16`).
**Scope requested:** code correctness & bugs · architecture & structure · security & data handling · docs vs. reality drift.

---

## 0. Method, and what "verified" means here

**What was actually read.** Every line of `index.html` (12,010 lines), all 22 `js/` modules, `gmail-watcher.gs` (691), `sw.js` (98), `deploy.ps1`, `manifest.json`, `.gitignore`, `watcher-deploy.json`, the four test files, `tools/`, and all 33 `.md` files.

**How.** The bulk line-by-line reading was split across eight parallel sub-reviews, each given a fixed line range and an instruction to report nothing it could not quote. **I then re-checked every finding in this document myself** against the file — by `grep`/`sed` on the exact lines, and by executing the shipped functions in Node where the claim was about behaviour. Findings the sub-reviews raised that I could not re-verify are in §7, marked as such, not mixed in with the rest.

**What was executed, not just read.**

- `node tests.js` on a clean copy: **752 passed, 0 failed.** (The two failures on my first run were my own missing `.png` files, since staged. This is a real run, not an inline check.)
- `cleanModelText` (finding 1) was run on a real contract-compliant answer string and its output captured.
- `looksDuplicate`, `quickRoute`, `validateRoute`, `matchListItems` were lifted verbatim out of `index.html` by line range and executed.

**What was NOT done.** Nothing was reproduced on the installed iOS PWA, and no git command was run (standing rule). Every behavioural claim below is *diagnosed from the code and, where stated, executed in Node* — not observed on your phone. Where that distinction matters I say so.

**Bottom line up front.** This is a genuinely well-built project — the routing/consequence architecture, the AI-log privacy design, the guard-test discipline, and the written record of *why* each rule exists are all better than most professional codebases I read. The problems below are concentrated in four places: (a) one prose/JSON confusion that silently destroys Ask answers, (b) three privacy leaks around content that leaves the device, (c) delete/prune/undo paths that are less recoverable than the code's own comments claim, and (d) documentation that has drifted far enough to actively mislead the next agent.

---

## 1. Fix these first

### F1 — CRITICAL · Every Ask answer that follows the rules is reduced to `[2]`

> **FIXED in v9.77.** Confirmed live on the installed PWA 31 Aug 2026 (a four-event
> answer rendered as `[1]`). The one-line fix at `:6414` would NOT have fixed the
> Gordon path: `callLocalModel` was already returning `cleanModelText(out)` at
> `:4811`, so the answer was destroyed inside the transport before `performRoute`
> ever saw it. Fixed in four places — transport (`:4811` → `stripThinking`), the
> two JSON parsers that now extract for themselves (`parseExtractedEvents`,
> `extractRecipeFromImages`), and the prose call site (`:6414`). Five new tests,
> each mutation-tested against a real revert.

`index.html:6414`, in `performRoute`'s ANSWER branch:

```js
    const text = await callAI([{ type:'text', text: built.user }], 700, built.system, 'ask.answer');
    const answer = cleanModelText(text).trim();
```

`cleanModelText` (`index.html:4643`) is a **JSON extractor**:

```js
function cleanModelText(text){
  const stripped = stripThinking(text);
  return /[{\[]/.test(stripped) ? extractJson(stripped) : stripped;
}
```

and `extractJson` (`index.html:4623-4640`) returns the first balanced `[...]` or `{...}` it finds.

The prompt for this exact call **requires** brackets in every answer — `ANSWER_CONTRACT`, `index.html:1638`:

> `2. CITE EVERY CLAIM. After each fact, put the reference number(s) it came from, like [2] or [1][4]. A statement with no reference is not allowed.`

**Executed** against the shipped functions:

```
INPUT : "Volleyball practice is Tuesday at 5:00 PM [2] and the band concert is Thursday [4]."
OUTPUT: "[2]"
```

A compliant answer is replaced by its first citation. An answer with no citation survives intact — so the app works *worse* the better the model obeys.

Why it survived 752 tests: every test of `cleanModelText` parses its output as JSON (`tests-cases.js:1759-1799`). The prose call site has no test.

`cleanModelText` is correct at its other three call sites (`:4811`, `:6325`, `:8546` — all JSON). `:6414` is the only prose payload.

**Fix:** at `:6414` use `stripThinking(text).trim()`, not `cleanModelText`. Add a test that asserts a bracketed prose answer round-trips unchanged, and mutation-test it by putting `cleanModelText` back.

> **Please check this on your phone before anything else** — open Ask, ask "what's on this week?", and tell me what the answer looks like. If answers are already coming back as `[2]` or `[1]`, this is the whole bug. If they look normal, it means your model rarely emits the citations the prompt demands, and the bug is latent rather than live. I have proven the code path and executed the function; I have not seen your screen.

---

### F2 — HIGH · The diagnostics file leaks the email addresses of everyone who has ever caused a watcher failure

> **FIXED in v9.77** — `where: redact(p.where)` in `js/ailog.js` and the inlined
> copy. Mutation-tested: reverting it fails "an address in `where` is redacted".

`index.html:3449`, in `buildDiagnostics`:

```js
      where: p.where, message: redact(p.message), detail: p.detail ? redact(p.detail) : null,
```

`message` and `detail` are redacted. `where` — on the same line — is not. And `where` is the field that always contains an address (`index.html:7616`, `:7624`, `:7629`):

```js
        logProblem('Email: ' + (payload.from || it.from || 'unknown'), p, label);
```

`redact()`'s own regex list names what it is scrubbing (`index.html:3229`):

```js
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,   // addresses in errors
```

The file this lands in is the one designed to be emailed around. The share sheet text promises otherwise (`index.html:11666`):

```js
        text:'FlyerSnap diagnostics — AI call log and reported problems. No events, notes or API key.' });
```

**Fix:** `where: redact(p.where)`. One-line change; add it to the same test that pins the other two.

---

### F3 — HIGH · The same diagnostics file publishes the private Gordon URL

`index.html:3433`:

```js
      localBaseUrl: m.includeLocalUrl ? redact((s.settings || {}).localBaseUrl || '') : null,
```

`buildDiagnosticsFile` always sets it (`index.html:11624`: `includeLocalUrl: true,`), and none of `redact()`'s four patterns match a bare `https://…ts.net/v1`.

The nuance that makes this **less** severe than it used to be: `GORDON_BASE_URL` now ships in the file anyway (`index.html:1048`), and auth moved from the hardcoded `Bearer local` to a real Firebase ID token (`index.html:4695`, `:4753`, `:11105`). So the URL is no longer the security. But CLAUDE.md still says it is (§6, D3), and if a *custom* `localBaseUrl` is saved, that one is genuinely private and does leave in the file.

**Fix:** either drop `localBaseUrl` from the export and report `usesDefaultGordonUrl: true|false`, or keep it and correct the share text and CLAUDE.md so the promise matches.

---

### F4 — HIGH · Text you typed into "What is this about?" is uploaded to the shared error database

> **FIXED in v9.77**, and the gate was inverted rather than patched: a denylist of
> one prefix became `CONTENT_FREE_WHERE`, an allowlist of the six `where` values
> audited as content-free, so a NEW call site is private by default. This required
> correcting an existing test that asserted `'Scanning'` details must keep
> travelling — it was written on the false premise that the detail was a screen
> name (`'recipe box'`) rather than the user's typed text. Two further leaks in
> this area are NOT fixed and remain open: an attachment filename still reaches
> the ungated `message` field via `index.html:7570` → `:7616`, and `redact()`'s
> 2000-char slice at `:6997` is dead because `redact` already caps at 400.

`index.html:10558`:

```js
    logProblem('Scanning', err.message, scanContext || null);
```

`scanContext` is the free-text box on the Capture screen (`index.html:8330`, placeholder `e.g. band, Olivia's dance, 3rd grade`) and is interpolated verbatim into the model prompt at `index.html:5499`.

`logProblem` queues every new problem for remote delivery (`index.html:7072`), and the only content gate is `index.html:7024`:

```js
  if(problem.detail && !isThirdPartyContent(problem.where)){
    docOut.description = redact(String(problem.detail)).slice(0, 400);
```

with `index.html:6980-6982`:

```js
function isThirdPartyContent(where){
  return /^Email:/.test(String(where || ''));
}
```

`'Scanning'` does not start with `Email:`, so the gate does not fire, and a child's name goes to `errorReports` in `meal-planner-f7f2f`. This is precisely the 2026-08-23 diagnostics-only ruling that the function's own comment (`:7006-7011`) cites, applied to a call site the ruling did not enumerate.

**Fix:** the guard is on the wrong axis. `isThirdPartyContent` should be replaced by an **allowlist of `where` values known to carry no content**, so that a new call site is withheld by default rather than exposed by default. Until then, add `'Scanning'` (and audit every other `logProblem` `detail` argument).

---

### F5 — HIGH · A backup that parses but is malformed permanently blank-screens the app, and the error message says the opposite

`index.html:11717-11733`:

```js
      const data = JSON.parse(r.result);
      if(!data || !Array.isArray(data.events)) throw new Error('bad');
      if(!confirm('Replace everything in the app with this backup?')) return;
      const defaults = blank().settings;
      S = Object.assign(blank(), data);
      S.settings = Object.assign({}, defaults, data.settings||{});
      ...
      save(); render();
      toast('Backup restored');
    }catch(e){ alert('That file is not a FlyerSnap backup.'); }
```

Three separate defects in twelve lines:

1. **Only `events` is validated.** `{"events":[],"kids":null}` passes, and `Object.assign` copies the `null` over `blank()`'s default. `renderEvents` → `allPeople()` (`index.html:4093`, `S.kids.filter(...)`) throws.
2. **`save()` runs before the throw is caught**, so the bad state is already in `localStorage`. `load()`'s check on next launch is the same weak one (`index.html:3858`), so `S.__locked` is never set and the recovery screen (`render()`'s `if(S.__locked)`) never appears. Blank screen on every launch.
3. **The catch spans the replacement**, so a failure *after* the data is destroyed is reported as `That file is not a FlyerSnap backup` — i.e. "nothing happened", at the exact moment everything happened.

Recovery is not guaranteed either: `snapshot()` is rate-limited to one a day (`index.html:3992`), so if today's snapshot was already taken, the pre-import state exists nowhere.

**Fix:** validate every collection `blank()` declares as an array before assigning; take an explicit pre-import snapshot that ignores the daily throttle; and move `save(); render();` outside the `try`, with its own catch that says what really happened and offers `restoreSnapshot`.

---

## 2. Data-safety and recoverability

### D1 — HIGH · The 90-day tombstone window is not implemented for six of seven collections, and events use the wrong date

`index.html:3904`: `const KEEP_SOFT_DELETED_DAYS = 90;   // tombstones for deleted rows`

`index.html:3946-3953`:

```js
  const oldDeleted = row => row.deleted && (!row.date || row.date < deletedCutoff);
  S.events = S.events.filter(e => !(e.deleted && (e.date || '') < deletedCutoff));
  S.listItems = S.listItems.filter(i => !i.deleted);          // no date; drop on prune
  S.notes = (S.notes || []).filter(n => !n.deleted);          // ditto
  S.lists = S.lists.filter(l => !l.deleted);
  S.chores = S.chores.filter(c => !c.deleted);
  S.rewards = S.rewards.filter(r => !r.deleted);
  S.kids = S.kids.filter(k => !k.deleted);
```

- `e.date` is when the event *happens*, not when it was deleted. **`grep -n "deletedAt" index.html` returns nothing** — the field does not exist. So an event dated 4 months ago is hard-deleted at the next prune however recently you deleted it, and a soft-deleted *future* event is never reclaimed at all.
- Lists, list items, notes, chores, rewards and people get **no age test whatsoever**. A person deleted five minutes before the prune is destroyed.
- `oldDeleted` on line 3946 is defined and **never used** (verified by grep — one occurrence in the file). A reader takes it for the prune rule; it isn't.

The section header two lines up claims the opposite (`index.html:3900`): `// conservative: nothing recent goes`.

**Fix:** write `deletedAt` in `softDelete` (and the five hand-rolled delete sites), migrate existing rows to `deletedAt = today`, and make every filter use `oldDeleted`.

### D2 — HIGH · After the first "storage full" alert, every later save fails silently

`index.html:3889-3895`:

```js
  }catch(e){
    // Quota exceeded, private mode, etc. Silence here would lose edits invisibly.
    if(!storageWarned){
      storageWarned = true;
      alert('Could not save — storage on this phone is full.\n\nExport a backup from Settings now, then clear out old past events or recipes.');
    }
  }
```

`storageWarned` is cleared only by a *successful* save (`:3888`). Once storage is full, save #2 onward takes the false branch: no alert, no toast, no `logProblem`, no dirty flag. You keep editing; everything is in memory only and dies with the tab. The comment on line 3890 states exactly the outcome line 3891 produces.

**Fix:** always surface it — a persistent banner rather than a repeated modal, plus a `logProblem` on the first failure so it reaches diagnostics.

### D3 — HIGH · Deleting duplicates writes a permanent suppression and tells you nothing changed

`index.html:8184-8194`, in `applyDedupe`:

```js
    if(!keep || !g.some(e => e.id === keep)){
      // "Keep both" means you have reviewed this pair and they are different.
      for(let x = 0; x < g.length; x++)
        for(let y = x + 1; y < g.length; y++){
          const k = pairKey(g[x], g[y]);
          if(S.settings.notDuplicates.indexOf(k) < 0) S.settings.notDuplicates.push(k);
        }
      return;
    }
```

The only feedback is `index.html:8200`:

```js
  toast(removed ? `Removed ${removed} duplicate${removed===1?'':'s'}` : 'Kept everything');
```

The button that triggers it reads `✓ Done (remove nothing)` (`index.html:8240`). So a tap labelled "remove nothing", reporting "Kept everything", writes a permanent record that those events are not duplicates.

The sibling function does this correctly and says why — `index.html:8113`:

```js
  // Reversible, like every other suppression as of v9.66 (code review P6-02).
  toast('Marked as different events', { label:'Undo', fn:() => {
```

This is your own rule 26, on the one path that was missed.

### D4 — HIGH · A photo scan can permanently mark unreviewed emails as handled

`pendingMsgIds` is assigned at `index.html:7647` and `:7854` and cleared **only** at `:8704` and `:8737` (verified by grep — those are all four sites). Neither `handleCapture` (`:8386`) nor `handleLinkCapture` (`:8501`) nor `back()` (`:5284`) touches it.

Sequence: tap the email banner → `openEmailReview` fills `pendingMsgIds` → tap Back → Capture → scan a flyer → `handleCapture` sets `pendingEvents = items` and `sub('review')` → tap "Track N items" → `saveReview` writes those *email* ids into `S.settings.seenMsgs` forever (`:8735-8737`). Those emails are never offered again and their events are lost. The review screen even shows "Skip all from this email" for a batch that isn't there (`:8677`).

**Fix:** clear `pendingMsgIds` wherever `pendingEvents` is replaced by a non-email source, or better, carry the msgIds *on the pending entries* rather than in a parallel global.

### D5 — MEDIUM · `openEmailReview` silently discards an unsaved scan batch

`index.html:7648` is an assignment, not a concat:

```js
  pendingEvents = markDuplicates(fresh.map(i => {
```

Contrast `retryEmailTrouble` (`:7853`, `pendingEvents.concat(...)`) and `handleCapture`'s append branch (`:8434`). The Ask DRAFT branch has the same shape (`index.html:6438`: `pendingEvents = [draft];`) and can wipe a batch under review with no warning and no undo. `pendingEvents` is never persisted, so the extraction cost is lost too.

### D6 — MEDIUM · "Remove key from this device" leaves the key on the device

`removeKey` (`index.html:11598-11607`) does `S.settings.apiKey = ''; save();`. Its docblock says *"the entire point here is that the value stops existing"*. But `save()` writes only the current blob; the up-to-three rolling snapshots (`SNAP_PREFIX`, `index.html:3975-3999`) are verbatim copies of earlier blobs, and Settings → Backup offers to restore them (`index.html:10917`). Worse: `snapshot()` runs *inside* `save()` and copies the previous blob, so if it is more than 24h since the last snapshot, the act of removing the key can archive a copy **containing** it.

**Fix:** `removeKey` should also rewrite each snapshot with `apiKey` blanked (or delete the snapshots and say so).

### D7 — MEDIUM · Bulk delete promises an undo route that does not exist

`index.html:8264`, the sheet subtitle: `'Tagging replaces existing tags. Deleting can be undone from Settings.'`
`bulkDelete` (`:8267-8273`) sets `e.deleted = true` behind a `confirm()` with no undo toast, and there is no Settings screen that restores a deleted event (the only `deleted = false` sites are `softDelete`'s own closure `:4157`, note groups `:9542`/`:9587`, and person restore `:11577`).

`bulkTag` on the same sheet does `e.personIds = personId ? [personId] : []` (`:8285`) — an unconditional overwrite of a multi-person tag list, with no undo, while `removePerson` (`:11562`) snapshots exactly that array so *its* undo can restore it.

`eventActions`' single "Remove event" (`:8304`) is the least recoverable delete in the app: `confirm()` + raw mutation, bypassing `softDelete(coll, id, label)` entirely.

### D8 — MEDIUM · `clearChecked` deletes a whole finished shopping list with no undo

`index.html:9364-9367` sets `deleted = true` by hand. The single-item delete right above it does it properly and explains why (`index.html:9331-9332`): *"The app's existing soft delete, so this is undoable… A new deletion path here would be a second source of truth for 'removed'."*

### D9 — MEDIUM · `manualPrune` silently invalidates every outstanding undo

Undo closures capture the row by reference and flip `deleted` back (`index.html:4157`). Prune hard-drops list items, notes and lists with no grace period (D1). Delete a note → press "clean up old records" → tap Undo: the closure sets a field on a detached object, calls `save()`, and toasts `Restored "…"`. A recovery path announcing a restoration that did not happen is rule 28.

---

## 3. The assistant: safety properties that do not hold as written

### A1 — HIGH · `performRoute()` writes to `S` and persists it

`index.html:6427-6428`, NAVIGATE branch:

```js
      S.settings.notesArea = target === 'lists' ? 'lists' : 'notes';
      save();
```

The invariant stated at `index.html:6469` and in CLAUDE.md is *"Not one of them writes: confirmPendingAction() is the only path in the app that turns an assistant sentence into a change."* It is a small, benign write — but it is a write, it survives a cancelled Ask (`cancelAsk` at `:6269` clears nothing), and the invariant is load-bearing for everything else in the section.

### A2 — HIGH · `complete_chore` is the one confirmed write with no undo, and it can double-count stars

`index.html:6727-6728`:

```js
      const kidId = pa.kidId || target.kidId || null;
      if(kidId) completeChore(target, kidId); else toggleChore(target.id);
```

`completeChore` (`index.html:9101-9109`) pushes a completion, saves, and calls `toast(...)` with **one argument** — and `toast(msg, action)` only renders a button when `action` is passed (`index.html:4131`). So there is no Undo. CLAUDE.md's claim that `completeChore` "carries theirs" is false.

It also has **no same-day duplicate check**. `toggleChore` has one (`index.html:9062-9063`); `completeChore` does not. `performRoute` checks at *propose* time (`index.html:6574`) and `confirmPendingAction` never re-checks — so a chore ticked in the Chores tab between the proposal and the "yes" gets a second completion row, and `starBalances` sums both. `completionFor` returns only the first, so one later tap removes one of the two and the extra stars stay.

Conversely, with no resolved person the confirm calls `toggleChore`, which is a *toggle* — a button reading "Mark 'Bins' done for today" can **un**-complete it.

### A3 — HIGH · A star balance can go negative, and un-ticking destroys stars silently

`starBalances` (`index.html:8974-8975`):

```js
  for(const c of S.completions){ if(c.kidId) bal[c.kidId]=(bal[c.kidId]||0)+(c.stars||0); }
  for(const r of S.redemptions){ bal[r.kidId]=(bal[r.kidId]||0)-r.stars; }
```

`redeem` refuses to overspend (`index.html:9162`), but nothing stops the *earning* side being removed afterwards: `toggleChore`'s untick splices the completion out (`:9063`) with no confirm, no toast, no undo — from a whole-card tap (`:9003`). Earn 10, redeem 10, untick: the balance renders as `-10` at `index.html:8988`.

Note the asymmetry in the same two lines: the completions loop guards `c.kidId` and defaults `c.stars`; the redemptions loop does neither, so a redemption missing `kidId` writes `bal["undefined"]` and one missing `stars` writes `NaN`, which renders as `0` — a real balance replaced by zero.

Earning is confetti and a toast (`:9105-9106`). Losing is silent. On the app's most emotionally loaded number, that is rule 26 again.

### A4 — HIGH · After disambiguating an edit, the app says "Updated" and changes nothing

`index.html:6606`:

```js
    if(res.status === 'ambiguous') return askWhich('events', res.matches, 'events', 'title');
```

No `extra`, so `pendingAction` gets no `changes` (`askWhich` builds it at `:6493`). The non-ambiguous path computes them and passes `{ changes }` (`:6613`). Then `index.html:6735-6740`:

```js
      const changes = pa.changes || {};
      ...
      Object.assign(target, changes);
      save();
      toast(`Updated "${target.title}"`, { label:'Undo', fn:() => {
```

`Object.assign(target, {})` does nothing, and the user is told it worked and offered an Undo that also does nothing. The comment eight lines up refuses this exact thing for the non-ambiguous case (`:6609-6610`): *"Writing an identical row and reporting success is a lie the user cannot see through."*

The same `extra`-dropping bug is on two more disambiguation paths: `check_list_item` by name (`:6546`, no `itemIds`/`pendingItems` → "Ticked off 0 items") and `complete_chore` (`:6573`, drops the resolved `kidId` → stars land on the wrong person or nobody). `askWhich`'s own comment (`:6490-6492`) records that this shipped once already and was fixed in v9.73 — for one of the four paths.

### A5 — MEDIUM · `quickRoute`'s topic guard has no word boundaries

`index.html:2289-2297` builds `TOPIC` from bare alternatives — `'star'`, `'list'`, `'game'` — with no `\b`.

**Executed** against the shipped `quickRoute`:

```
quickRoute("What is a starling?")                     -> ask_chores,   confidence 0.95, autoRun
quickRoute("Can you cancel the dentist appointment?")  -> ask_schedule, confidence 0.95, autoRun
quickRoute("what is the capital of France?")           -> null          (correctly refused)
```

The documented case works; near-misses do not. Two consequences: an out-of-scope question ships the family's schedule to the model instead of being refused, and **"cancel" is missing from the change-verb list** at `:2319` — so a request to *change* data is answered as a question instead of reaching `validateRoute` and the confirm gate. `postpone`, `bump`, `push back`, `swap` and `assign` are also absent. The stated invariant at `:2317-2318` is *"Anything that could change data must reach the model router."*

**Fix:** anchor every `TOPIC` alternative with `\b`, and add the missing verbs. Widening the verb list is always safe (your own note at `:2463`).

### A6 — MEDIUM · `validateRoute` accepts calendar-impossible dates and writes them

`index.html:2168-2169`:

```js
    case 'date':     return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    case 'time':     return typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);
```

**Executed:**

```
validateRoute({intent:'edit_event',params:{event:'recital',date:'2026-99-99',time:'99:99'},confidence:0.9})
  -> {"ok":true,"consequence":"confirm","params":{"event":"recital","date":"2026-99-99","time":"99:99"}}
```

`eventEditChanges` (`:3013`) passes it through and `confirmPendingAction` does `Object.assign(target, changes)` (`:6737`). There is no `Date.parse`/`isNaN` guard anywhere on that path (verified by grep). The comment at `:2205-2206` says *"A wrong-typed value is DROPPED, not coerced. Coercing is how a bad date becomes a real calendar entry."* — shape is checked; range is not.

### A7 — MEDIUM · `matchListItems` picks on ambiguity, and reports a matched word as missing

`index.html:3045-3050` resolves an `ambiguous` result by taking the first candidate, justified as *"Two items reading the same thing"*. But `resolveEntity` also returns `ambiguous` for **containment** matches (`:2018-2023`). **Executed:**

```
items = [{id:'a',text:'whole milk'},{id:'b',text:'oat milk'}]
matchListItems(['milk'])            -> {"matched":[{"id":"a","text":"whole milk"}],"missing":[]}

items = [{id:'i1',text:'semi-skimmed milk'},{id:'i2',text:'bread'}]
matchListItems(['milk','semi-skimmed']) -> {"matched":[{"id":"i1",...}],"missing":["semi-skimmed"]}
```

"whole milk" is chosen over "oat milk" by array order, and `missing` is empty so the caller cannot mention it. The second case tells the user there is no "semi-skimmed" on a list that contains "semi-skimmed milk", because a second word resolving to an *already-matched* row falls through to the `else missing.push(...)` branch.

This is the only place in the assistant where an `ambiguous` result is resolved by picking rather than asking, and it feeds a write.

---

## 4. Duplicate detection

### P1 — HIGH · The short-title rule is raw substring containment

`index.html:638-642`:

```js
  if(shorter <= 2){
    return na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0;     // full containment only
  }
```

`indexOf` matches *inside a word*. **Executed** against the shipped `normTitle`/`titleSimilarity`/`looksDuplicate`, all pairs on the same date:

| A | B | `looksDuplicate` |
|---|---|---|
| `PE` | `Spelling Test` | **true** |
| `Art` | `Party` | **true** |
| `Gym` | `Gymnastics` | **true** |
| `Band` | `Jazz Band Concert` | **true** |
| `Grade 3 Field Trip` | `Grade 3 Picture Day` | false ✔ |

`"spelling test".indexOf("pe") === 1`. Consequences: `markDuplicates` (`:8378`) unchecks the second one by default on the review screen, so a real event is silently skipped unless you notice; and the dedupe screen offers to delete it.

**Fix:** test containment on word boundaries — split both to word arrays and require every word of the shorter to appear as a whole word in the longer.

### P2 — HIGH · A third event can bridge a pair you explicitly marked "not duplicates", and then that event is deleted

`index.html:8136`:

```js
      if(group.some(g => looksDuplicate(g, evts[j]) && !isDismissedPair(g, evts[j]))){
```

Membership is `some` over the whole group, so an event joins if *any one* member matches undismissed. `applyDedupe` then deletes everything but the keeper (`:8195`). With A=`Concert`, B=`Spring Band Concert`, C=`Spring Band Concert Rehearsal` on one date and A~C dismissed, all three group and C is soft-deleted anyway — with no undo on that path (D3).

**Fix:** require the candidate to be an undismissed duplicate of **every** current member (`every`, not `some`), or drop the group to pairs.

---

## 5. Notes

### N1 — HIGH · A checklist row can tick the wrong line, or nothing at all

`renderNoteDetail` bakes the line index into the handler (`index.html:10074`):

```js
        onclick="toggleNoteCheck('${n.id}',${c.index})"
```

and the 400 ms autosave deliberately does **not** re-render (`writeNote`, `:9932-9943`; the docblock at `:9924-9926` explains why — it would destroy the caret). So once a body edit commits, the stored line numbering has moved and the rendered rows still carry the old indices.

`toggleNoteCheck`'s guard (`:9436-9437`) only catches the case where the shifted index lands on a *non-checkbox* line:

```js
  const m = line.match(CHECK_LINE);
  if(!m) return;                       // the body moved under us; change nothing
```

Body `"- [ ] a\n- [ ] b"`; type `milk⏎` at the top; 400 ms later the body is `"milk\n- [ ] a\n- [ ] b"` with no re-render. Tapping row **a** (index 0) hits `"milk"` and does nothing. Tapping row **b** (index 1) hits `"- [ ] a"` and **ticks off a**.

### N2 — HIGH · Six note-detail controls overwrite an un-flushed edit

Two functions flush the pending autosave first and say why — `index.html:9449` (`flushNote(); // do not let a pending autosave overwrite this`) and `:9913`. These six do not, and each then re-renders the textarea from `n.body`: `toggleNoteCheck` (`:9430`), `setNoteColor` (`:9503`), `setNoteFolder` (`:9596`), `toggleNoteLabel` (`:9604`), `toggleNotePerson` (`:9953`), `togglePinNote` (`:9902`).

`toggleNoteCheck` is the worst because it *persists* the stale body (`n.body = lines.join('\n'); save();`), and the loss is permanent: when the orphaned timer fires, `writeNote` reads the freshly re-rendered textarea and bails at `:9940` (`if(title === n.title && body === n.body) return;`).

Two of those functions carry comments about preserving the caret "mid-sentence" — which is only meaningful if the textarea was mid-edit at the moment the chip was tapped.

**Fix:** call `flushNote()` as the first line of all six.

### N3 — MEDIUM · Meal-plan data from the recipe app is interpolated raw into an `onclick`

`index.html:10284`:

```js
      byDate[d].map((meal, i) => `<div class="slot" onclick="mealActions('${d}','${meal.slot}')">
```

`d` is `m.date` straight out of the other app's `localStorage`, filtered only by `m.date >= today` (`:10159`). `m.slot` is constrained to `SLOTS`; `m.date` is not. The value on the very next line *is* escaped (`:10286`, `esc(meal.title …)`), so the omission is inconsistent within one template.

Related: `mealsByDate` (`:10165-10169`) has no `__proto__` guard — `map['__proto__']` reads `Object.prototype`, `.push` is undefined, and `renderMeals` throws before setting `innerHTML`, blanking the Meals tab. Every other consumer of this foreign data is defensive (`readMealPlan`, `:10151`: `}catch(e){ return null; }   // unreadable = no data, never an error`).

And `recipeUrlTemplate` / `shoppingListUrl` are handed to `window.open` (`:10173`, `:10178`, `:10180`) with no scheme or origin check.

---

## 6. Architecture and structure

### S1 — The drift guard is one-directional, and it has already let a contradiction ship

`tests-modules.js:232`:

```js
      if(!norm(script).includes(norm(body))) drifted.push(f);
```

Source ⊆ inlined passes. **Extra text in the inlined copy is invisible.** Verified:

```
$ diff <(sed -n '1186,1334p' index.html) js/ai-actions.js
15,37d14
```

23 lines exist only in the build artifact — a duplicated copy of the registry docblock, including `index.html:1207-1208`:

```js
// The only three classes an AI capability may have. Adding a fourth is a
// deliberate act with a test to update, which is the point.
```

while `RISK` 26 lines later (`:1233-1249`) has **four** members (`READ`, `PROPOSE`, `CONFIRM`, `DERIVE`) and the corrected wording sits at `:1231-1232`. The same duplication pattern appears at `:1717-1758` (registry header twice) and `:2027-2095` (router header **three** times) — the signature of an inline step that appends instead of replacing.

**Fix:** make the guard bidirectional — assert that removing each module's normalised body from the script leaves no orphan fragment, or inline by marker-delimited replacement so the comparison can be an equality.

### S2 — Dead code that the comments treat as live

- **`pickDomain`** (`index.html:1525`) — verified by grep to have **no call site** anywhere. Its docblock claims *"Decided in code, not by the model… it decides what data leaves the device, and that must stay predictable and auditable."* The decision is actually made at `index.html:6402-6404` from `route.intent`, i.e. from model output. (Only one collection is sent per call, so this is not over-sharing — but the auditable-in-code guarantee is not implemented, and the function written to implement it is never invoked.) Its body also has the unbounded-`\bstar` bug: `"when does soccer start?"` classifies as chores.
- **`availableActions`** (`index.html:1309`) — referenced only by `tests-modules.js:407,410`. Its docblock says *"with AI switched off, everything of class read/propose disappears"*; `aiCapabilitySection` (`:4375`) maps `AI_ACTIONS` unconditionally, so with AI off Settings still advertises "Read paperwork", "Ask about your schedule" and "Do things you ask for". The parameter also shadows the global `aiEnabled()` (`:4429`) — a future `aiEnabled()` call inside that body throws.
- **`exportQueueBanner`** (`index.html:5220`) — its only reference is its own recursive call at `:5226`. A near-duplicate of `renderExportQueue`.
- **`dupKey`** (`index.html:8370`), **`oldDeleted`** (`:3946`), **`LAST_SKIP`** in the watcher (`gmail-watcher.gs:369`, written, never read), and `gmail-watcher.gs:435` `if (false) {` with twenty unreachable lines.

### S3 — `render()` mutates and persists state

`index.html:5200`, inside `renderExportQueue`, reached from `render()` via `subs.exportQueue`:

```js
  if(!next){ S.settings.exportQueue = q.slice(1); save(); return renderExportQueue(m); }
```

*k* deleted entries produce *k* nested frames and *k* `localStorage` writes during one paint. `conflictBanner` does a milder version at `:5777`.

### S4 — Diagnostics that disagree with the code they diagnose

Rule 28, three fresh instances:

- **`jsonpRequestOrFetch`** (`index.html:11103-11110`) throws `'status ' + res.status` and then catches **its own throw**, appending CORS advice. An expired Gordon session is reported as `status 401 (check OLLAMA_ORIGINS includes this site, and OLLAMA_HOST=0.0.0.0)` — pointing at the wrong machine. The comment above promises a JSONP fallback that is not in the body.
- **`runLocalSelfTest`** (`index.html:11020`) accepts a **prefix** match: `id.indexOf(model) === 0`. With `localModel = 'qwen3-vl:8b'` and only `qwen3-vl:8b-instruct-q4_K_M` installed, "Chosen model is installed" passes while every real call (which sends the exact saved name, `:4717`) fails — confusing precisely the two names the UI warns about at `:10742`.
- **`compareProviders`** (`index.html:11146-11147`) puts a *file decode* failure into `anthropicErr`, because the outer `try` opens at `:11123`, before `readImageDownscaled`. The Anthropic column then shows `Failed: …` and the local column shows "Nothing found", when neither provider was contacted. That is rule 13 exactly. *(The setting-persistence bug this tool once had is genuinely fixed — `aiOverride` is in-memory and cleared in a `finally` at `:11148-11152`.)*
- **`renderCompare`** (`index.html:11360-11361`) passes `ico('cloud') + 'Anthropic…'` into `compareColumn`, which escapes it (`:11158`). Both headings render the literal text `<svg class="ico" aria-hidden="true"><use href="#i-cloud"/></svg>Anthropic (…)`. The a11y audit cannot see it — `tools/a11y-audit.js:187` seeds `compareResult = null`, which renders the empty-state branch.
- **`renderSetTrouble`** (`index.html:10937-10939`) gates the routing "Last run" line on `benchState.done` regardless of `benchState.kind`. After a *reading* benchmark, `benchSummary()` returns `aggregateExtraction(...)`, whose keys are `cases, expected, returned, matched, precision, recall, f1, missedTotal, inventedTotal, misdatedTotal, fields` (`:3645-3658`) — no `passed`. The routing card prints `undefined/12 passed` and its link opens the extraction screen.

### S5 — `esc()` is used as a JavaScript-string escaper in ~20 inline handlers

`esc` (`index.html:510-514`) maps `'` to `&#39;`. An HTML attribute value is character-reference-decoded **before** the handler is compiled as JavaScript, so `&#39;` becomes a literal `'` inside the JS string. Sites include `:6157` (`answerClarify('${esc(c.name)}')` — model-controlled text via `clarifyChoices`), `:7361` (sender strings; `addSender`'s validator at `:7388` permits `'`), `:10877`, `:10890`, `:7830`, `:5788`.

`index.html:6185` shows the author knew this context needs more:

```js
        onclick="askThis('${esc(s).replace(/'/g, "\\'")}')"
```

That `.replace` is a **no-op** — `esc` has already converted every `'`, so there is nothing left to match. The guard cannot fire.

Nothing here is exploitable today (values are `uid()`s, ISO dates, or app constants), but the code reads as protected and is not.

### S6 — Unescaped interpolations worth closing

- `p.color` / `k.color` into `style="background:${…}"` at `:5584`, `:5595`, `:5641`, `:7360`, `:8672`, `:8841`, `:8987`, `:9029`, `:9123`, `:9201`, `:10104`. `addKid` only ever assigns from `KID_COLORS` (`:11551-11553`), but `importBackup` validates nothing (F5), so a hostile backup carrying `"color": "red\" onclick=\"alert(1)"` closes the attribute.
- `m.date` from the recipe app (N3).

### S7 — Smaller correctness items, each verified

| Claim | Evidence |
|---|---|
| ICS lines are never folded; RFC 5545 §3.1 requires ≤75 octets | `index.html:5052-5056`, `:5077-5079`; no folding helper exists anywhere in the file |
| `icsEscape` does not escape `\r` | `index.html:4993` — chain covers `\\ ; , \n` only |
| ICS `SUMMARY` loses the person for assistant-drafted events and drops all but the first person otherwise | `eventTitle` (`:5017-5020`) reads only `evt.kidId`; `buildEventDraft` (`:2975-2976`) sets `personIds` with `kidId: null` |
| Default one-hour end time stretches to two across a DST spring-forward | `:5043` `new Date(y, m-1, day, hh, mm+60)` vs. floating-local `DTSTART` at `:5030` |
| `crossesMidnight` uses `<=`, so `endTime === time` exports a 24-hour event | `:5040` |
| Past-dated events skip the alarm filter entirely | `:5007-5012` — the `away >= 0` branch is the only one that filters |
| A transparent PNG is flattened onto **black** before going to the model | `:4982-4986` — no `fillRect` before `drawImage`, then `toDataURL('image/jpeg')` |
| `extractRecipeFromImages` lets a raw `SyntaxError` reach the user | `:4958` bare `JSON.parse`, unlike `:4907` and `:4936` |
| No size limit on the PDF capture path | `:8400` → `readFile` (`:4964`) base64-encodes with no cap; images are bounded at `MAX = 1600` |
| `relativeTime` can never output "1h" | `:573-575` — the minutes band runs to 5400s |
| Every `logProblem` failure inside the Anthropic-fallback path is lost when Anthropic *also* fails | `:4555-4563` — `recordAiCall(localFail)` is only reached after `callClaude` resolves |
| `err.message` dereferenced unguarded one line after `err` is guarded | `:4522` vs `:4523` |
| `S.settings.errorReportsOff` retries a permanently-failing report forever | `:7219` — only 2xx/409/403 drop the entry; a 400 is retried every launch |
| `occurrenceCount` is unreachable | `:7027` needs `count > 1`, but `queueErrorReport` is only called on the new-problem branch (`:7072`) where `count` is 1 |
| Ledger filter can strand you on a permanently empty screen | `ledgerKid` applied at `:9195`; the chips that clear it render only `if(kids.length>1)` at `:9198` |
| Undoing a folder deletion overwrites a folder chosen in the meantime | `:9586-9591` — the label branch guards with `includes`, the folder branch assigns unconditionally |
| Sending >20 legacy recipes marks all sent, keeps 20 | `:10200` truncation vs. `:10224-10226` per-item marking |
| A typed recipe is discarded when the queue write fails | `:10497-10508` — form cleared and navigation happens on both branches |
| Object URLs are never revoked on any download path | `:4331`, `:4039`, `:11192`, `:11697`, `:11711` |
| Global error handlers are installed *after* the first `render()` | `:11774` vs `:11832-11841` — a boot failure is the one class nothing records |
| `restoreSnapshot` skips `migrate()` and the nested settings merges | `:4010-4014` vs `load()` at `:3865-3869` |
| `importBackup` is a second, divergent copy of `load()` (no migration, no nested merges, no `applyTheme()`) | `:11725-11731` |
| The bridge comment misstates the architecture | `:11854` claims "This file is an ES module"; there is one classic `<script>` at `:431`, which is the only reason ~15 handlers not in the `Object.assign(window, …)` list work at all |

---

## 7. Gmail watcher, service worker, deploy

### W1 — MEDIUM-HIGH · `setsenders` concatenates a sender string straight into a Gmail query

`gmail-watcher.gs:604-606` validates length only; `:358` builds:

```js
  var query = '(' + list.map(function (s) { return 'from:' + s; }).join(' OR ') +
```

A value like `me OR in:anywhere` produces a query matching the whole mailbox. The gate is optional — `:601`:

```js
    if (writeSecret && e.parameter.wtoken !== writeSecret) {
```

so an install with no `WRITE_SECRET` set has none. And `action=message` (`:617-621` → `messagePayload`, `:299`) fetches by id with **no sender check**, so anything the query pulls into the queue becomes readable.

**Bounded by:** the caller needs `SECRET`, which is in the URL, in browser history, and in every FlyerSnap backup (the file's own comment, `:14-16`).

> **Question for you:** is `WRITE_SECRET` actually set in the Script Properties on your deployment? If not, anyone holding a backup can repoint the watcher. Also worth validating each sender against `/^[^@\s]+@[^@\s]+\.[^@\s]+$/` before it reaches the query.

### W2 — MEDIUM · The queue can exceed the 9KB property cap and wedge the watcher

`gmail-watcher.gs:23` caps **entry count**, not bytes: `var MAX_QUEUE = 60;        // keep the queue small; Script Properties cap at 9KB/value`. A maximal reference (120-char subject at `:482`, sender, ISO date, `chars`, `attachments`) measures ~278 bytes; 60 of them serialise to ~16.7KB. `props().setProperty('QUEUE', …)` at `:554` is not in a try/catch and is the **first** of four writes, so once it crosses the cap `checkMail` throws every 15 minutes and `SEEN`/`FAILS`/`LAST_RUN` never update.

Related: overflow uses `queue.slice(queue.length - MAX_QUEUE)` (`:551`), dropping the **oldest** — whose ids were already pushed to `seen` (`:491-492`), so those emails can never be re-queued.

### W3 — MEDIUM · RAW_MODE counts model calls it never makes

`gmail-watcher.gs:466` calls `countCall()` before the `RAW_MODE` branch `continue`s at `:493`, and `callClaude` is only reached at `:496`. With `RAW_MODE = true` (`:78`) the script spends nothing, yet `DAILY_CALL_CAP` (80) stops the run at `:391-394`. A busy mail day silently stops the watcher for a spend that does not exist.

### W4 — MEDIUM-HIGH · `deploy.ps1 -DryRun` deploys the Gmail watcher to production

The header says `-DryRun     # check everything, push nothing` (`deploy.ps1:4`). The `-DryRun` exit is in **step 6**, `:367`. Step 5 (`:224`) runs first and calls `Invoke-WatcherAuto` (`:353`), which runs `clasp push -f` (`:306`) and `clasp deploy -i` (`:313`) — a live deploy to the URL your phone calls. Nothing between lines 224 and 360 consults `$DryRun`, and `grep DryRun tests-modules.js` returns nothing.

Also in that function: both verification failure branches fall through to `return $true` (`:335-348`), so the caller prints `gmail-watcher.gs pushed and redeployed automatically`, skips the manual fallback, and commits. The check runs and its result is discarded.

*(Everything else about `deploy.ps1` checks out: no `&&`, no `Invoke-WebRequest`, `$ErrorActionPreference = "Continue"` at `:37`, tests via `Start-Process` with per-stream files, and the single `Get-Item` at `:158` has `-Force`, `-LiteralPath` and a null check. The `.wsuo` bug is genuinely fixed.)*

### W5 — MEDIUM · A failed cache write throws away a good network response

`sw.js:74-96`. The synchronous-`waitUntil` rule is satisfied — verified literally: the handler is not `async` (`:54`), and `const fresh = fetch(...)` (`:74`) and `e.waitUntil(fresh)` (`:91`) are both top-level statements before `respondWith`. But `.catch(() => null)` covers the whole chain including `caches.open` and `c.put`. If storage is full or the Cache API throws, a **successful** response with `res.ok === true` is discarded and `fresh` resolves `null`; on a cold cache `caches.match('./index.html')` also misses and `respondWith` receives `undefined` — a failed navigation with a working network.

**Fix:** return `res` before/independently of the cache write; catch only the write.

### W6 — MEDIUM · `preview-shots/` is not in `.gitignore`, and step 6 runs `git add -A`

`tools/preview.js:21` writes to `preview-shots/` by default; `deploy.ps1:377` is `git add -A`. CLAUDE.md tells you to run the preview tool before a deploy. Doing so commits a directory of full-page screenshots — light and dark, every tab — into a public repo. This is the "generated output never gets committed" rule, one directory short.

### W7 — MEDIUM-HIGH · The table flattener misplaces a rowspan when a later row is short

`gmail-watcher.gs:152-160`. The loop exits when the cell tags run out and there is no pending entry at the current column — it never scans right for pendings. **Executed** against the real functions on a header + three-row schedule with a `rowspan="2"` and one short row: the rowspan cell disappears from the row it belongs to, reappears one row late on the wrong time, and pushes that row's real cell off the grid. Short rows are ordinary in school schedule grids, and this is the one module whose whole purpose (`:117-119`) is *"The model then never has to infer which day or time a cell belongs to."*

**Shared constants: no drift.** I checked all four the pinning test covers — `MODEL` (`gmail-watcher.gs:22` / `index.html:4164`), the endpoint (`:84` / `:4163`), `anthropic-version` (`:87` / `:4828`) and the `unauthorized` string (`:586` / `:6824`) — all equal. `max_tokens: 8000` (`:90`) is shared but unpinned.

---

## 8. Documentation drift

The docs are the weakest part of the repo right now, and CLAUDE.md is the one that matters because every future agent reads it first.

**CLAUDE.md, verified wrong:**

| Line | Says | Actually |
|---|---|---|
| 67 | `**Current version:** v9.47 · **Tests:** 609 passing` | `index.html:4455` is `v9.76`; a real run is **752 passed**. (Line 368 says 752 — the file contradicts itself.) |
| 40-44 | `` `Authorization: 'Bearer local'` is a hardcoded constant (index.html:4064, :4112, :8334) `` | `grep "Bearer local" index.html` returns **nothing**. All three sites are now `'Authorization':'Bearer ' + gtok` (`:4695`, `:4753`, `:11105`). The replacement the doc calls for has happened. |
| 42-43 | "the URL's secrecy IS the security… Publishing that URL with the app makes the constant worthless" | `index.html:1048` ships `const GORDON_BASE_URL = 'https://desktop-pvl0f9c.tail1c32c9.ts.net/v1';` as the default. The security moved to the Firebase token; the warning is spent. |
| 28-33 | "**WHERE THIS IS HEADING**: Gordon SHIPS WITH THE APP, behind a login" | Shipped. `js/gordon-auth.js` is inlined at `index.html:876`; `gordonAuthCard()` at `:10652`; `GORDON_AUTH_REQUIRED` thrown at `:4722`. AI-STATE.md §4 has this right and claims authority over conflicts. |
| 59-63 | "`S.settings.aiProvider` still DEFAULTS to `'anthropic'` for a fresh install" | `index.html:1070`: `aiProvider:'local',`. `migrate` `from<5` also flips existing installs (`:795`). The stated reason is gone too — an empty `localBaseUrl` falls through to `GORDON_BASE_URL` (`:4688`). A test comment at `tests-modules.js` repeats the same stale claim. |
| 627 | "Opt-out: `S.settings.errorReportsOff = true` (no UI yet…)" | The checkbox shipped: `index.html:10347`, `setErrorReports` at `:10368`, and it is registered in `mustSurvive` as `'setErrorReports('`. Same stale claim in ERROR-REPORTING-PLAN.md:42 and ERROR-LOGGING-HANDOFF.md:32. |
| 118-121 | "(The old ARCHITECTURE-PLAN.md was deleted in v9.2…)" | The file is present (9,482 bytes) and still contains `<script type="module" src="js/app.js">` at `:128` — the exact change that blanked the app. HANDOFF.md contradicts itself on this too (`:105` lists it, `:126` says it was deleted). |
| 415-417 | "a MENU of six rows (`setPeople`, `setAI`, `setCapabilities`, …)" | `renderSettings` (`:10607-10626`) emits **seven** rows, `setCapabilities` is **not** one of them (it is reached from inside the AI page, `:10763`), and `setDismissed` — which is one — is missing from the list. |
| 427-428 | "A test lists 24 controls" | `mustSurvive` has **28** entries. |
| 446-447 | "Ten intents… change something; five only read" | `js/intents.js` declares **17** intents: 11 change data (9 confirm + 2 draft), 6 do not. `enrich_batch` was added without updating this or ADMIN-CONSOLE-CONTRACT.md:90. |
| 641-643 | "`deploy.ps1` (zip-based flow)… expects a `flyersnap-vNN*.zip` in Downloads" | `deploy.ps1:22-24` says the zip hunt was removed in v9.25 because the path it used had not existed since the repo moved. CLAUDE.md's own rule 18 (`:238`) describes the current script correctly — and the "## Deploying" section at `:633-639` contradicts rule 18 by telling agents to hand you manual git commands. |
| 81-87 | Lists 15 inlined modules | `js/` has 22 files. `gordon-auth.js`, `ask.js`, `gestures.js`, `bench-cases.js`, `extract-cases.js`, `extract-score.js`, `route-score.js` are unlisted. Not a build risk (the tests enumerate the directory), but the doc under-reports what ships by a third. |
| 6-8 | The one-paragraph description of the app | Omits Notes entirely, which since v9.60/9.61 is a tab and has absorbed Lists (`index.html:5249-5251`). |

**Other docs, verified wrong:**

- **`EXPERT-QA.md`** — every headline number is off by 2–3×: `v9.6 · Tests: 289` (`:3`), `index.html 4,667 lines` (`:14`), `js/ 6 files` (`:16`), and it contradicts itself at `:239`/`:269` (276). CLAUDE.md `:650-652` still points new agents at it as *"the best single summary… read it before proposing architectural changes."* **This is the highest-value doc fix**, because it is actively cited as authoritative.
- **`CODE-REVIEW-FINDINGS.md`** — names seven analysis tools as *"committed with this review so the enumeration is repeatable"* (`:28-29`): `tools/p1-reachability.js`, `p2-writepaths.js`, `p2-repro-compare-provider.js`, `p3-onefact.js`, `p4-silent.js`, `p6-oneway.js`, `p7-affordance.js`. **None exists** in `tools/`, and none is gitignored. It also reports on *"every `tools/wire-*.py` | 15"* — there are zero. Rule 25 makes those tools the basis for trusting the findings; the enumeration cannot be repeated. *(Its `index.html:NNNN` citations, unlike every other doc's, are still largely accurate — I spot-checked `:10772`, `:4344`, `:3905`, `:10663`, all correct.)*
- **`GMAIL-WATCHER-SETUP.md`** — describes the pre-RAW_MODE watcher: *"roughly 250 lines"* (`:49`; it is 691), *"Sends that to the Claude API"* (`:14`), *"a penny or two per email"* (`:111`). `gmail-watcher.gs:78` is `var RAW_MODE = true;` and `callClaude` is unreachable. This contradicts CLAUDE.md's own §"Gmail watcher (RAW_MODE)".
- **`DEPLOY.md:90`** — *"deadlines get alerts 7, 3, and 1 days before plus day-of"*. `index.html:1068`: `alerts:{ deadline:[7,1], event:[2,0] }`. `:62` also lists the old tab set (Events, Chores, Lists, Meals, Settings).
- **`ADMIN-CONSOLE-CONTRACT.md:35`** — `SCHEMA_VERSION = 4`; it is **9** (`index.html:752`), and the documented state shape omits `notes`, `noteFolders`, `noteLabels` entirely. `:31` also describes `flyersnap-lastsnapshot` as *"rolling backup copies"*; it holds a **timestamp** (`:3996`) — the copies are under `flyersnap-snap-`.
- **`RECIPE-APP-INTEGRATION.md:5`** — *"the exchange protocol below is a proposal. FlyerSnap does not implement it yet."* It ships: `index.html:10188` checks `env.schema !== 'recipe-exchange.v1'`. The doc also documents `S.recipes` and `S.meals`, both deleted by migration (`:763-765`).
- **`HANDOFF.md`** — three different test counts in one file (`:17` 562, `:1522` 482, banner v9.38), and its "docs as they ACTUALLY exist" inventory (`:84`) is missing ten files.
- **Referenced but absent:** `UNIVERSE-CONTROL.md` (declared supreme over FLYERSNAP-EA-PLAN.md at its `:3`), `FLYERSNAP-EA-READINESS-REVIEW.md`, `RECIPE-APP-SNACK-DESSERT-REQUEST.md` (HANDOFF's first open item), `js/ea-enrich.js` (scaffolded in FLYERSNAP-EA-PLAN.md:112; the feature shipped as `enrich_batch` instead), and `eval/last-run.json` / `eval/router-last-run.json`, which CLAUDE.md `:386` and `:411` both instruct be committed — neither benchmark has a baseline.

**Systemic:** `index.html` has grown from 4,078 lines to 12,010. **Every `index.html:NNNN` citation in the docs outside `CODE-REVIEW-FINDINGS.md` now points at unrelated code** — including CLAUDE.md `:53` (Share Events "at `:6374`", really `:7960`) and `:55` (`eventFilter` "at `:3560-3562`", really `:5481`).

---

## 9. What is genuinely good

Stated because a review that only lists defects misrepresents the codebase.

- **The consequence model is real, not aspirational.** The registry (`js/intents.js`) declares `answer`/`navigate`/`draft`/`confirm`, the set is closed, and a test loops the whole registry to prove no class writes silently. `S.events.push` exists at exactly **two** sites — `index.html:8730` (the reviewed save) and `:8917` (the hand-typed form) — verified by grep. The AI→storage boundary holds.
- **`validateRoute` and `parseRoute` do what they claim.** I executed both: `unknown` is refused, 0.59 is rejected and 0.60 accepted, an array `params` is rejected, and a `}` inside a quoted string does not truncate the parse. The range-check gap (A6) is real, but the untrusted-input discipline is otherwise sound.
- **`makeEntry` is a field allowlist, not a spread** (`index.html:3350-3371`), so an extra key on a caller's object cannot leak into the AI log. The "no prompt text, no answer text, no key" rule survives contact with the code.
- **The Ollama context work is careful.** `num_ctx` appears nowhere in a request body (only in prose at `:3705`), and a failed probe genuinely changes nothing — `probeLocalContext` returns `null` on five distinct paths and `planBudget` with `ctx === null` returns the unchanged request.
- **The service worker's synchronous-`waitUntil` rule is correctly implemented**, and the cross-origin bail-out at `sw.js:65` is the right fix for the JSONP staleness problem rather than a workaround.
- **The guard tests are unusually good** — mutation-tested, comment-stripped before analysis, and pinning operative expressions rather than prose. 752 of them pass on a clean checkout.
- **The written record of *why*** — the rules list in CLAUDE.md, each traced to a specific incident — is the single most valuable artifact in the repo. That is exactly why the stale parts matter.

---

## 10. What I would do, in order

Each numbered item is one change. Run the tests after each.

**Today (correctness and privacy, all one-liners or near):**

1. **F1** — `index.html:6414`: change `cleanModelText(text)` to `stripThinking(text)`. Add a test asserting a bracketed prose answer survives; mutation-test it.
2. **F2** — `index.html:3449`: `where: redact(p.where),`. Extend the existing diagnostics privacy test to cover `where`.
3. **F4** — `index.html:7024`: invert `isThirdPartyContent` into a `CONTENT_FREE_WHERE` allowlist so a new call site is withheld by default. Audit every `logProblem(..., detail)` argument while you are in there.
4. **D2** — `index.html:3891`: keep the alert once, but always set a visible persistent "not saving" banner and `logProblem` the first failure.
5. **A2** — `index.html:9101`: add the same-day duplicate check `toggleChore` already has, and give `completeChore` an undo toast that removes the completion by its `id`.

**This week:**

6. **F5** — rewrite `importBackup` to validate every collection, snapshot unconditionally first, and move `save(); render();` out of the try.
7. **D1** — introduce `deletedAt`, migrate, and route all seven prune filters through `oldDeleted`.
8. **P1/P2** — word-boundary containment in `looksDuplicate`; `every` instead of `some` in `duplicateGroups`.
9. **D3** — give `applyDedupe` the same named, undoable toast `dismissGroup` has.
10. **N1/N2** — `flushNote()` as the first line of the six note-detail handlers; key checklist rows by content hash or re-render after `writeNote`.
11. **A4** — pass `extra` from all four `askWhich` call sites (`:6546`, `:6573`, `:6606`, and audit the fourth).
12. **D4** — clear `pendingMsgIds` wherever `pendingEvents` is replaced by a non-email source.
13. **W4** — move the `-DryRun` exit above step 5, or gate `Invoke-WatcherAuto` on `-not $DryRun`. Add the guard test.
14. **S1** — make the drift guard bidirectional, then delete the duplicated comment blocks at `:1200-1222`, `:1738-1758`, `:2050-2095`.

**When you get to it:** A5 (`\b` on `TOPIC` + the missing verbs), A6 (calendar-validity check), A7 (ask instead of pick), D6, D7, D8, W1, W2, W5, W6, S2 (delete or wire the dead functions), and the `esc()`-in-`onclick` sites (S5) — replace with a `jsEsc()` helper so the code stops looking protected when it isn't.

**Docs — do this before the next agent session, it is the cheapest win here:**

15. CLAUDE.md: fix line 67 (v9.76 / 752); rewrite the `Bearer local` bullets (40-44) to past tense; move the "WHERE THIS IS HEADING" block to "shipped"; correct the `aiProvider` default (59-63); delete the "no UI yet" claim (627); fix the settings-hub row list (415-417), the control count (427), the intent counts (446); correct the `deploy.ps1` paragraph (641-643) and reconcile "## Deploying" with rule 18; either delete `ARCHITECTURE-PLAN.md` or fix line 118.
16. Put a `> **STALE — numbers are from v9.6.**` banner at the top of `EXPERT-QA.md`, or refresh its four headline figures, since CLAUDE.md sends people there.
17. Either commit the seven analysis tools `CODE-REVIEW-FINDINGS.md` claims, or add a line saying they were not kept.
18. Rewrite `GMAIL-WATCHER-SETUP.md` for RAW_MODE, and fix `DEPLOY.md:90`.
19. Consider a one-line rule: **docs cite functions by name, never by line number.** Every line citation in the repo is now wrong, and they will be wrong again a month after you fix them.

---

## 11. Open questions — I could not settle these from the code

1. **Ask answers on your phone** — see the box under F1. This is the one piece of evidence I most need.
2. **Is `WRITE_SECRET` set** in your Apps Script properties? (W1 severity depends entirely on it.)
3. **`watcher-deploy.json` is correctly gitignored, but it is present in the working folder** and holds the live `/exec` URL, which the .gitignore comment itself calls *"one half of the watcher's access"*. It was copied into my review workspace along with everything else; if that matters to you, rotating the deployment is the conservative move.
4. **`summarize`'s `failureRate`** (`index.html:3402`) counts a fell-back call twice in the denominator — one user-visible operation, two log rows. Deliberate or not?
5. **Meal-plan slots** — can the recipe app legitimately write two meals to the same date+slot? If so, `renderMeals` (`:10284`) shows both but `mealActions` (`:10431`) always opens the first.

---

## Appendix — commands

Run the suite:

```powershell
cd C:\Users\Logan\Desktop\Repos\FlyerSnap
node tests.js
```

Check the accessibility audit across all screens:

```powershell
cd C:\Users\Logan\Desktop\Repos\FlyerSnap
node tools/a11y-audit.js
```

Check CSS source/inline drift on its own:

```powershell
cd C:\Users\Logan\Desktop\Repos\FlyerSnap
node tools/inline.js --check
```

If you want this review committed alongside the other review docs:

```powershell
cd C:\Users\Logan\Desktop\Repos\FlyerSnap
git add FLYERSNAP-REVIEW-2026-08-31.md
git commit -m "Add full code review, 31 Aug 2026 (v9.76)"
git push
```

If `git add` or `git commit` reports `Unable to create '...index.lock': File exists`, the commit did **not** happen and a later `git push` will misleadingly print `Everything up-to-date`. Recover like this:

```powershell
cd C:\Users\Logan\Desktop\Repos\FlyerSnap
Get-Process git -ErrorAction SilentlyContinue
```

If that prints nothing (no git process running), remove the stale lock:

```powershell
cd C:\Users\Logan\Desktop\Repos\FlyerSnap
Remove-Item .git\index.lock -Force
```

Then confirm it is gone and re-run the add/commit/push block above:

```powershell
cd C:\Users\Logan\Desktop\Repos\FlyerSnap
Test-Path .git\index.lock
```

`False` means you are clear to retry.

**No code was changed by this review.** Nothing needs pushing except this file, if you want it kept.
