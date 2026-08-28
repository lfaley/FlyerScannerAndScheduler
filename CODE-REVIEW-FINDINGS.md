# FlyerSnap code review — FINDINGS

Evidence log for the review defined in `CODE-REVIEW-PLAN.md`. One section per
phase. Per finding: what, where (`file:line`), how it was proven, what changed,
what test now guards it — **and every correction to an earlier claim of mine**,
because a findings log with no self-corrections is a marketing document.

**Baseline for the whole review, measured 28 Aug 2026 at `00d6521` (v9.61):**

| | |
|---|---|
| Working copy verified against the repo | **`md5sum` over all 30 source files — byte-identical.** Rule 10 satisfied with evidence, not assertion |
| `index.html` | 10,892 lines |
| `js/` modules | 22, carrying **124** exports |
| Window bridge | **113** names |
| Distinct functions named by an inline `on*=` attribute | **171** |
| Tests | **656 passed, 0 failed** |
| a11y audit | no problems across 42 screens |
| CSS inline check | in sync |

---

## P1 — Reachability and drift  ·  status: COMPLETE  ·  28 Aug 2026

**Question:** what ships that nothing reaches, and what has drifted out of sync?

**Tool:** `tools/p1-reachability.js` (new, committed with this review so the
enumeration is repeatable and arguable). It prints the rule it applied for each
question, so the enumeration can be checked rather than trusted.

### How each set was enumerated

| | Set | Size | Rule applied |
|---|---|---|---|
| A | every `export` in `js/*.js` | 124 across 22 modules | reached if the name appears in the shipped script, a sibling module, or `tools/` — **with comments stripped first** |
| B | every name in `Object.assign(window, {…})` | 113 | split in two: B1 nothing calls it anywhere; B2 called from JS but never from a handler attribute |
| C | every identifier called from an inline `on*=` attribute | 171 | must resolve to a definition in the shipped script |
| D | every `js/*.js` vs its inlined copy | 22 | deferred to the existing test, then **mutation-tested** (below) |
| E | every `tools/wire-*.py` | 15 | the functions it defines must still exist in `index.html` |

### Result

**Zero dead code.** No unreached export, no dead bridge entry, no handler naming
a function that does not exist. This matches what `CODE-REVIEW-PLAN.md` §2
predicted for a 22k-line repo, and is the opposite of the source methodology's
53,000 deleted lines. **A phase that finds nothing and says so is a result.**

Four smaller things did surface, none of them a bug.

### P1-01 — METHOD ERROR, mine. My `tools/` was not the repo's `tools/`

**Where:** working copy, not the repo.
**How found:** the first run of check E reported on 20 wire scripts. The repo has
15. Comparing `ls tools/` on the device against my copy showed **five scripts
that are not in the repo at all** — `wire-ai.py`, `wire-ask2.py`,
`wire-assistant.py`, `wire-memory.py`, `wire-theme.py` — carried forward from an
older working copy three re-syncs ago, plus `run-lighthouse.sh` missing from
mine.

This is `CLAUDE.md` rule 19 exactly, and it is the third time it has bitten in
this session's history. Note **what saved it**: not the tests, which pass either
way, but re-checking the enumeration against the device before reporting a count.
An enumeration that is not verified against the real repo is a number, not a fact.

**Changed:** the five stale files were deleted from the working copy and E re-run
against the repo's 15. They were **not** added to the repo — they are not mine to
restore, and rule 11 says ask first.
**Guarded by:** nothing yet. See the recommendation at the end.

### P1-02 — CORRECTIONS, mine, to the analysis itself

The first run of `p1-reachability.js` produced five findings that were all
artefacts of a bad method. Both are recorded here rather than quietly fixed,
because both are the same failure this project has now shipped five times.

1. **It matched identifiers after a dot.** `.replace(`, `.toLowerCase(`,
   `.stringify(` and `getElementById(` were reported as "functions called from a
   handler with no definition". They are method calls.
2. **It read comments as code.** It reported `foo` as an undefined handler
   target. `foo` appears in the comment at `index.html:10766` that *explains* the
   bridge: `Inline onclick="foo()" attributes resolve against the global scope`.

That is `CLAUDE.md` rule 21 — *a guard that reads the words next to the logic is
not reading the logic* — appearing in a new place: not in a guard this time, but
in the **audit tool written to check the guards.** Check A was originally written
with the same flaw and was rewritten to strip comments before deciding whether an
export is reached; its result (0 unreached) held under the stricter method.

**Changed:** the tool strips comments and refuses to match after a dot.
**Proven not vacuous:** three canaries injected into a throwaway copy — an
unreached `export`, a bridge entry nothing calls, and a handler naming a function
that does not exist. **All three were caught.** An audit that cannot fail is not
an audit.

### P1-03 — `tools/wire-ailog.py` documents a mechanism that no longer exists

**Where:** `tools/wire-ailog.py:92` defines `withAiOp(op, fn)`; no such function
is in `index.html`.
**Verdict: not a defect.** It was superseded, deliberately and for the better.
`callAI` now takes `op` as a fourth parameter and sets `aiOp` at the top of the
call (`index.html:4370-4371`), which does the same job without a wrapper. The
nine `aiOp` read sites are all live.
**Why it is logged anyway:** `CLAUDE.md` treats the wire scripts as the record of
*why* the code is shaped as it is. One that describes a replaced mechanism will
mislead the next reader, and this is the only one of the 15 in that state.
**Recommended:** a superseded banner at the top of that file, naming
`wire-ailog2.py` as what replaced it. Not applied — it is documentation, and this
phase is a survey.

### P1-04 — `syncEventForm` is on the bridge but no handler names it

**Where:** `index.html:10850` (bridge entry); defined at `:8374`; called from
`:8371`, `:8372`, `:8384`, `:8392` — all ordinary JS.
**How proven:** check B2. Nothing in any `on*=` attribute names it.
**Why it matters, mildly:** the bridge's own comment at `index.html:10772` says
*"Generated from the markup; do not hand-edit."* If that were true, this entry
could not exist. So either the block is hand-edited despite the comment, or the
generator is broader than the comment claims. **The comment is currently false
in at least one respect**, and it is the comment that tells a future agent
whether they may touch the block.
**Impact:** none at runtime — an extra global. Logged as a documentation
inconsistency, not a bug.

### P1-05 — 16 of 22 modules are inlined with no marker comment

**Where:** only 5 `// ===== inlined from js/X =====` markers exist
(`index.html:454, 575, 649, 719, 844`) plus one for `errorReport.js` at `:6463`.
The other 16 modules — `ai-actions`, `ailog`, `ask`, `assistant-actions`,
`bench-cases`, `conflicts`, `conversation`, `extract-cases`, `extract-score`,
`gestures`, `icons`, `intents`, `local-limits`, `route-score`, `router`, `theme`
— are inlined with nothing saying so.
**Why it matters:** the drift test covers all 22 regardless, so the *build* is
safe. The hazard is human: someone editing `index.html` inside one of those 16
regions has no signal that they are editing a generated copy, and their change
will be silently reverted the next time the module is re-inlined — or, worse, it
will make the drift test go red for a reason that looks unrelated to what they
did. Rules 19 and 20 exist because exactly this class of confusion has already
cost this project a bad deploy.
**Recommended:** emit the marker for all 22. Cheap, mechanical, and it makes the
"do not hand-edit" rule visible where the editing happens.

### The one thing P1 leans on, verified rather than assumed

Check D does not re-implement the drift comparison — `tests-modules.js` already
owns that rule, and a second copy of a rule is the defect P3 exists to remove.
But deferring to a guard means the guard has to be real, so it was
**mutation-tested**: changing `ASSUMED_MINUTES` from 60 to 61 in
`js/conflicts.js` alone turned the suite red with
`FAIL the inlined copies match js/ exactly`. It compares whole module bodies, not
prose. **It is honest.**

### P1 recommendations, carried to P9

1. Emit an `inlined from js/X` marker for all 22 modules (P1-05).
2. Superseded banner on `tools/wire-ailog.py` (P1-03).
3. Either regenerate the bridge block or correct its comment (P1-04).
4. **A guard for P1-01.** The working-copy hazard has now cost time three times
   and is caught only by someone thinking to check. A test that compares the
   working tree's file list against `git ls-files` would catch a stale or extra
   file mechanically. This is the highest-value item on the list, because it is
   the only one that has actually caused a bad outcome.

**Verified vs diagnosed:** everything above was verified by running code against
the repo at `00d6521`. Nothing here was reproduced on a device, and nothing here
needed to be — P1 asks only what the source says.

---

## P2 — Write-path and persistence audit  ·  status: COMPLETE  ·  28 Aug 2026

**Question:** can a write be lost?

**Working copy re-verified against the repo before starting** — `md5sum` on
`index.html`, `js/migrate.js` and `gmail-watcher.gs` all matched `00d6521`.

**Tools:** `tools/p2-writepaths.js` (the enumeration) and
`tools/p2-repro-compare-provider.js` (the reproduction for P2-01, runnable).

### Why the source methodology's mechanism does not transfer, and what replaces it

The source review found 6 data-losing races across 40 database methods and fixed
them with a lock-ordering law. **FlyerSnap has no database, no worker and no
server writer**, and JS is single-threaded, so two functions cannot run at once.
Copying that phase literally would find nothing and prove nothing.

What *does* transfer is the question. FlyerSnap's interleaving is an **`await`**:
it yields to the event loop, and a timer, a JSONP callback, a render or a tap can
run in the gap. So the shape that can lose a write here is:

> read part of `S` → `await` → write back what you read

and **not** the general "two functions touch `S`", because `S` is one live
mutable object and `save()` serialises it at call time — two writers to different
fields both land.

### The sets, enumerated

| Set | Size |
|---|---|
| top-level functions in the shipped script | **487** |
| `async` functions | **46** |
| `save()` call sites | **99** |
| direct `S.settings.<key> =` writes | **48** |
| functions where a read of `S` precedes an `await` that precedes a write | **4** |
| **capture-from-`S` → `await` → write-it-back sites** | **2** |

**CORRECTION to the plan's §3 baseline.** `CODE-REVIEW-PLAN.md` says 88 `save()`
sites and 46 settings writes. The real figures at `00d6521` are **99** and **48**.
The plan's numbers were taken at v9.59 with a cruder grep and are two releases
stale; these were counted per-line with comments stripped. The plan's §4 rule
("re-measure at the start; if a number moved, the tree moved under you") is what
caught it.

### P2-01 — `compareProviders` persists `aiFallback: false` for the length of two model calls  ·  REAL, highest severity in this phase

**Where:** `index.html:10038-10072`.

**What it does:** captures `original = S.settings.aiProvider` (`:10040`) and
`originalFallback = S.settings.aiFallback` (`:10041`), sets
`S.settings.aiFallback = false` (`:10050`), then flips
`S.settings.aiProvider` to `'anthropic'` (`:10056`) and later `'local'`
(`:10061`) around two `await callAI(...)` calls, and restores both in a
`finally` before `save()`.

**Why that reaches disk:** `recordAiCall()` (`index.html:4230-4235`) ends with
`save()`, and it runs on **every** AI call — including the two inside this
function. So the temporary settings are written to `localStorage` by the app's
own code, not merely held in memory.

**Proven, not reasoned.** `node tools/p2-repro-compare-provider.js` builds the
same sandbox `tests.js` builds, loads the real shipped script, and only stands in
for the model call and the image read:

```
BEFORE  on disk: {"provider":"local","fallback":true}
DURING  on disk: [{"provider":"anthropic","fallback":false},{"provider":"local","fallback":false}]
AFTER   on disk: {"provider":"local","fallback":true}
```

**The consequence, in order of how likely it is to bite:**

1. **The PWA is killed mid-comparison.** iOS evicts backgrounded PWAs routinely,
   and a local-model call on the 8B is slow enough to tab away from — the
   `thinking_only` failures earlier this month took 48s and 27s. `finally` never
   runs. The user is left **persisted with the AI fallback switched off**, and
   possibly on the wrong provider, with nothing on screen saying so. The next
   time Gordon fails, it will not fall back to Anthropic and there will be no
   explanation.
2. **Any other AI call in the window** — the Ask screen is reachable from every
   screen, and `maybeCheckEmail()` fires on `visibilitychange` — runs with the
   comparison's provider and with fallback disabled.
3. **A settings change in the window is silently reverted.** Settings is still
   reachable during the busy screen; changing the provider there is undone by
   `finally` and the revert is saved.

**The class, swept.** `tools/p2-writepaths.js` enumerated every
capture→await→write-back across all **487** functions. **Exactly two sites, both
in this function** (the two lines above). This is not a scattered pattern; it is
one function doing one unsafe thing twice.

**Fix, proposed but NOT applied** — this phase's deliverable is the list, per the
plan. Do not mutate `S.settings` at all. `aiProvider()` (`index.html:4344`) is a
single read point, so a module-level `aiOverride` that it consults would let the
comparison force a provider without touching saved state; a matching
`aiFallbackOn()` helper would do the same for the four `aiFallback` read sites
(`:4356`, `:4398`, `:4403`, `:5788`). Then `finally` failing leaves nothing wrong
on disk, because nothing wrong was ever put there. It also collapses four
scattered reads of one fact into one — a P3 improvement for free.

### P2-02 — Two instances on one device clobber each other wholesale  ·  REAL, medium

**Where:** `save()` `index.html:3801` writes `JSON.stringify(S)` — the entire
blob. `load()` runs once at startup.

**How proven:** searched the shipped script for a `storage` event listener —
**there is none**. The only `visibilitychange` handler (`index.html:10754`) calls
`maybeCheckEmail()` and re-renders the meals tab; it does **not** re-`load()`.

So two instances on the same origin (the installed PWA plus a Safari tab, most
plausibly) each hold an `S` from whenever they opened, and the later saver
overwrites everything the other did.

**Bounded, and worth saying so rather than inflating it:** FlyerSnap has **no
cross-device sync at all**, so this cannot happen between phone and desktop —
they hold separate data. It needs two instances on one device.

**`snapshot()` is not a mitigation.** It is rate-limited to once per 24 hours
(`index.html:3905`), so the odds it captured the state you want back are poor.

**Options, none applied:** re-`load()` on `visibilitychange` when the app was
hidden (cheapest, and it fixes the stale-read half); a `storage` listener that
warns; or accept it and document it. Needs Logan's call — option one changes
behaviour on every return to the app, which is not a decision for a review to
make alone (rule 11).

### P2-03 — The watcher's `SEEN` and the app's `seenMsgs` are two independent lists  ·  BY DESIGN, documented

Confirmed, not a race: `gmail-watcher.gs` keeps `SEEN` in Script Properties and
the app keeps `S.settings.seenMsgs` (`index.html:6376` and `:8169`). Neither
knows about the other, which is why `forgetImportedEmails()` (`:6888`) tells the
user to run `resetWatcher` then `checkMail` in the Apps Script editor as well.
It is a documented two-step, and the UI says so. Carried to **P3** as a
two-truths candidate rather than logged as a P2 defect.

### P2-04 — CORRECTION: one of the four candidates was a false positive, and why

`tools/p2-writepaths.js` flagged `performRoute` (`index.html:6004`): an `S.events`
read at `:6011`, an `await` at `:6028`, a write at `:6042`. Reading it shows the
read is inside the ANSWER branch, which **returns at `:6033`**, and the write is
in the NAVIGATE branch. They are mutually exclusive and can never both run.

**The limitation, stated so the next reader can trust the tool for what it is:**
it matches on line order, not control flow. It NARROWS the set from 487 functions
to 4; it does not judge. Every candidate got read by hand, which is the only
reason this one did not become a fabricated finding.

`checkEmail` (`:6966`) and `openEmailReviewNow` (`:6994`) were the other two.
Both write single scalar fields (`lastEmailCheck`, `pendingEmailCount`) with
fresh values after their await — no captured snapshot, nothing to lose.
**Verdict: safe.**

### P2 recommendations, carried to P9

1. **P2-01 is worth fixing now**, ahead of the rest of the review. It silently
   disables a safety net the user chose, and the reproduction takes one command.
2. A guard test for the class: no `S.settings.<key> =` may appear between an
   `await` and a `finally` in the same function. Mutation-testable.
3. P2-02 needs a decision before it needs code.

**Verified vs diagnosed:** P2-01 was **reproduced** against the real shipped
script in the sandbox. It was **not** reproduced on a device — the iOS-kills-the-
PWA step is inference from documented platform behaviour, not something observed
here. P2-02 was diagnosed from code only; no two-instance test was run.


## P3 — One fact, one place  ·  status: COMPLETE  ·  28 Aug 2026

**Question:** is any single fact stored or derived in more than one place?

**Working copy re-verified** — `md5sum` on `index.html`, `gmail-watcher.gs`,
`js/migrate.js`, `sw.js` all matched `00d6521` before starting.

**Tool:** `tools/p3-onefact.js`.

### Why a duplicated literal is the only shape this can take here

FlyerSnap's surfaces do not share a module system. `index.html` inlines `js/`,
but `gmail-watcher.gs` is pasted into Google's editor by hand, `sw.js` is a
separate worker, `manifest.json` is data, and the meal planner is a different
repo. **A fact shared across two of those can only be a duplicated literal.**
So the sweep is: enumerate every storage key and every distinctive literal that
appears on more than one surface, then give each a human verdict.

`js/*.js` is excluded on purpose: `index.html` carries inlined copies by design,
and P1 check D already owns that rule with a mutation-tested guard.

### The sets, enumerated

| Set | Size |
|---|---|
| distinct storage keys / Script Properties | **13** |
| literals appearing on 2+ surfaces | **19** |
| of those, genuine shared contracts (not incidental) | **9** |
| **guarded by a test** | **1** |

### The two seeds from earlier this month — both verified CLOSED

- **The Gordon model tag.** The v9.37–38 guard is still in place and is a real
  one: it reads `GORDON_MODEL` out of the shipped script, refuses the bare
  (thinking) tag, requires `instruct`, and pins `saveLocalModel()`'s fallback to
  the same constant (`tests-modules.js:3862-3884`). **Closed inside the app.**
  It cannot reach the meal planner, which is a separate repo — that coupling
  lives in `MEAL-PLANNER-MODEL-HANDOFF.md` and nothing enforces it.
- **The watcher queue entry shape.** The v9.39 guard is present and executes the
  real filter rather than reading prose. **Closed.**

### P3-01 — `mealplan-out` is named twice in one file, and the second one is the diagnostic  ·  REAL

**Where:**
- `index.html:9144` — `const MEALPLAN_KEY = 'mealplan-out';`
- `index.html:9151` — `localStorage.getItem(MEALPLAN_KEY)` — the real reader
- **`index.html:9381`** — `localStorage.getItem('mealplan-out')` — a raw literal,
  inside `mealPlanDiagnostic()`

**How proven:** enumerated every use of both exchange keys. `SCANNED_KEY` is used
through the constant at all three of its sites (`:9191`, `:9208`, `:9243`).
`MEALPLAN_KEY` has exactly one honest reader and one bypass.

**Why it matters more than it looks:** the constant exists so the key lives in
one place, and the bypass is in the tool whose whole job is to answer *"why don't
I see my meals?"*. If the recipe app ever renames that key and `MEALPLAN_KEY` is
updated, the app would read the new key correctly and **the diagnostic would keep
reading the old one and report that nothing is there.** The instrument you reach
for when something is wrong would be the one thing still lying to you.

That is the same shape as P2-01 in spirit: the failure is not in the feature, it
is in the thing you use when the feature fails.

**Fix, not applied:** use `MEALPLAN_KEY` at `:9381`. One word. A guard test that
no raw `'mealplan-out'` literal exists outside the constant's own declaration is
cheap and mutation-testable.

### P3-02 — Eight app↔watcher contracts, none of them pinned  ·  REAL, unguarded

`gmail-watcher.gs` does **not deploy with the push** — it is pasted by hand — so
these two surfaces can drift silently and for weeks. The queue-shape bug on 24
Aug was exactly this, and it swallowed every email.

Every literal the two share, verified:

| Fact | app | watcher | guarded? |
|---|---|---|---|
| Anthropic endpoint | `index.html:4658` | `gmail-watcher.gs:78` | no |
| `anthropic-version: 2023-06-01` | `:4659` | `:81` | no |
| `x-api-key` header name | `:4658` | `:81` | no |
| **model `claude-sonnet-4-6`** | `:4050` | `:16` | **no** |
| `kind` values `event` / `deadline` | `:230` | `:48` | no |
| date format `YYYY-MM-DD` | `:237` | `:47` | no |
| media types (`application/pdf`, `image/jpeg`, `image/png`) | `:3537`+ | `:273`+ | no |
| error string `unauthorized` | `:5187` | `:567` | no |

Two deserve singling out:

- **`claude-sonnet-4-6` is the Anthropic model name written in two files with
  nothing keeping them equal.** This is the identical class to the Gordon tag
  that cost a day in August, and it is currently dormant only because
  `RAW_MODE = true` means the watcher does no AI work. Flip that flag and the two
  can disagree immediately.
- **`unauthorized`** is a string the watcher returns and the app string-matches
  (`index.html:5187`) to turn into *"Token rejected — check the secret matches the
  script."* Reword it on the watcher side and the user gets the raw token instead
  of the explanation.

**Why they cannot simply be collapsed:** there is no import path between the two.
The honest options are a guard test that reads both files and asserts they agree
(the pattern the model-tag guard already uses), or a single generated header
block. **Not applied — this is a survey.**

### P3-03 — Two service-worker message contracts, one guarded  ·  MINOR

`update-ready` (`index.html:9351` ↔ `sw.js:84`) and `navigate`
(`index.html:987` ↔ `sw.js:80`). `update-ready` is referenced twice in
`tests-modules.js`; `navigate` is not. Low stakes — a broken update banner, not
lost data — but it is the same class and the asymmetry is unintentional.

### P3-04 — `kidId` and `personIds`: two representations, correctly handled, unguarded  ·  NO DEFECT FOUND

Events carry both. Schema v3 introduced `personIds` and **deliberately kept**
`kidId` so the stars/chores system, which is kids-only, kept working.

**Enumerated every read and every write.** The reads go through two helpers that
prefer `personIds` and fall back only when it is absent —
`eventHasPerson()` (`index.html:4006-4009`) and `eventPeople()` (`:3968`). Every
writer sets both, or sets `personIds` alone, which the readers handle:
`bulkTag` (`:7786-7787`), `setReviewKid`/`tagAll` (`:8189`, `:8197`),
`saveReview` (`:8232`), `delKid` (`:10481`). All three `S.events.push` sites
(`:8231`, `:8418`) populate `personIds`.

**Verdict: no defect today.** Logged because nothing enforces it: a future writer
that sets only `kidId` on an event would make it vanish from the people filter,
and there is no test that would notice. A guard belongs in P9.

### The scoreboard this phase produces

Nine genuine shared facts. **One** has a test. The two that already bit this
month are the two that were fixed and pinned — which is the argument for pinning
the rest before they bite rather than after.

**Verified vs diagnosed:** everything above was verified by reading the repo at
`00d6521` and enumerating with a committed tool. Nothing was reproduced at
runtime; P3 is a question about source, and none of these findings needs a
running app to establish. **No code was changed.**


## P4 — Silent failures  ·  status: NOT STARTED

## P5 — `index.html` top to bottom  ·  status: NOT STARTED

## P6 — One-way doors  ·  status: NOT STARTED (2 members already confirmed, see plan §5)

## P7 — Affordance and discoverability  ·  status: NOT STARTED

## P8 — Is the suite honest?  ·  status: NOT STARTED

Two entries are already waiting for this phase, both found by ordinary feature
work rather than by looking:

- **S8** — four watcher tests at `tests-cases.js:444` assigned
  `document.getElementById` a plain-object factory and never restored it, so from
  that point to the end of the file every element lacked `focus()`, `blur()` and
  `setSelectionRange()`. Every caret-preserving handler in the app was therefore
  untestable, and nobody knew. Fixed in v9.60.
- **S9** — the guard *"choosing a tab is a deliberate departure and clears the
  origin"* read only the **first line** after `function nav(tab){`. It passed for
  the *shape* of a one-line function, not its content, and went red the moment
  `nav()` grew a second line while still behaving correctly. Widened in v9.61.

Both are the same shape as P1-02. That is now five occurrences of one class in
this project, which is the strongest argument in the plan for running P8 at all.

## P9 — Prevention  ·  status: NOT STARTED
