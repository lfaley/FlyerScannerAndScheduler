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


## P4 — Silent failures  ·  status: COMPLETE  ·  28 Aug 2026

**Question:** what fails, or succeeds pointlessly, without telling anyone?

**Tool:** `tools/p4-silent.js`.

### The sets, enumerated

**111 catch blocks** across 24 files — 100 in `index.html`, 2 in `js/`, 9 in
`gmail-watcher.gs`. Sorted by the shape of the body, not by judgement:

| Shape | Count | Meaning |
|---|---|---|
| handled | **78** | alerts, toasts, `logProblem`, rethrows, real recovery |
| comment only | **11** | swallowed on purpose, **with the reason written down** |
| console only | **0** | — |
| empty, no reason at all | **22** | the set that needed reading |

**Worth saying before the findings:** those 11 comment-only catches each state
why — *"snapshots are best-effort; never block a save"*, *"logging must never
break the thing it is logging about"*, *"decoration must never break the
action"*. That is a healthy pattern and it is most of the deliberate swallowing
in the app. The 22 with nothing at all are where the problems live, and **17 of
those 22 are genuinely ignorable** on reading (caret restore, `navigator.share`
cancellation, capability probes, a nested belt-and-braces write inside a handler
that already alerts). Five are not.

`logProblem()` is called from **15** sites.

### P4-01 — Sign-out reports success it never checked  ·  REAL, the most serious in this phase

**Where:**
- `index.html:931` — `function clearGordonSession(){ try{ localStorage.removeItem(GORDON_SESSION_KEY); }catch(e){} }`
- `index.html:9695-9698` — `gordonSignOutUI()` calls it and then **unconditionally** toasts *"Signed out of Gordon"*.

If `removeItem` throws — Safari private mode, storage access denied, quota
states — the catch swallows it and the app **tells the user they are signed out
while the Firebase ID token is still on the device.**

The probability is low. That is not the point: the app is **asserting a security
outcome it did not verify.** Everywhere else in FlyerSnap a destructive action
either confirms or offers undo; this one announces a result without checking it.

**Fix, not applied:** read the key back and only toast on success; otherwise say
so. One line, and it turns an assertion into a fact.

### P4-02 — A Gordon sign-in that cannot be saved fails silently  ·  REAL

**Where:** `index.html:930` — `saveGordonSession()`, same empty catch. Called at
`:948` and `:962` after a successful sign-in.

If the write fails, sign-in **appears** to work for the rest of the session and
the user is signed out again on next launch, with nothing ever having said why.
The app already has the right pattern for exactly this: `save()`
(`index.html:3793-3797`) alerts *"Could not save — storage on this phone is
full"* rather than swallowing. This path does not.

### P4-03 — The recovery download can be silently incomplete  ·  REAL

**Where:** `index.html:3943-3949` — `downloadQuarantine()` enumerates
`localStorage` inside a `try` with an empty catch, then builds the blob from
whatever it collected.

If the enumeration throws part-way, the user downloads a **partial** copy of
their quarantined data and is given no reason to doubt it. This is the file you
reach for when the app has already locked itself after a load failure, so a
truncated one is the worst possible time for silence.

Same class as P3-01 and P2-01: the failure is not in the feature, it is in the
instrument you reach for when the feature has already failed. **Three
independent instances of that shape in three phases** is a pattern worth naming.

### P4-04 — Service-worker registration failure is invisible  ·  MINOR

`index.html:10663` — `navigator.serviceWorker.register('sw.js').catch(()=>{})`.
If it fails, the app keeps working online and **offline support simply does not
exist**, with nothing to distinguish that from working. Given how much of this
project's history is about the installed PWA, this deserves at least a
`logProblem`.

### P4-05 — `startFresh()` can leave keys behind and still claim a fresh start  ·  MINOR

`index.html:3961-3968` — deletes every `flyersnap*` key inside a `try` with an
empty catch, then unconditionally does `S = blank()`. A throw mid-loop leaves
some keys and the app says it started fresh.

### P4-06 — CORRECTION, mine, to a finding I already reported twice

**Seed S4 in `CODE-REVIEW-PLAN.md` §5 says `fetchEmailQueue()` builds a
diagnostic report that "both callers discard". That is wrong, and I told Logan so
in conversation as well.**

There are **three** callers, not two, and the third surfaces it:
`testWatcher()` (`index.html:10401`) destructures `report` and, when nothing was
offered, shows it in an `alert` with an explanation of what to do about it
(`:10410-10415`).

The accurate finding is narrower: **the report is shown on the Test button's
path and discarded on the two everyday paths** — `checkEmail()` (`:6976`) and
`openEmailReviewNow()` (`:6998`) still take only `{ fresh }`. Worth surfacing
there too, but that is a smaller claim than the one I made.

S4 should be amended in the plan rather than deleted, because the underlying
point survives: on the path you actually use, the explanation is thrown away.

### P4-07 — Eight module return values that only the tests ever read  ·  INFORMATIONAL

`validateRoute().autoRun`, `summarize().failureRate / .slowestMs / .byErrorType`,
`scoreExtraction().pairs`, `aggregateExtraction().inventedTotal / .misdatedTotal`,
`observedPromptTokens().samples`. Each is computed on every call, asserted by a
test, and never shown to anyone. Not a defect — but `summarize().failureRate` in
particular is the kind of number the Problem Log or the AI-call screen could use.

### CORRECTIONS to this phase's tool, before its output was trusted

Three, all the same failure — the method not matching reality:

1. **It stripped comments to spaces before measuring a catch body**, so all 11
   comment-only catches read as `EMPTY`. It erased the exact distinction the
   phase exists to make, and would have turned 11 examples of good practice into
   11 findings.
2. **It bounded a function at the next `function` keyword**, so top-level
   constants declared after a function closed were attributed to it. It reported
   `const THEME_LABELS` as living inside `matchListItems()`. Function bodies are
   now found by brace matching.
3. **It read its own prose as evidence.** The first version of check B searched
   the whole `tools/` directory for a key name — including `tools/p4-silent.js`,
   whose comments name the very keys under investigation. `report` came back
   "read by tests/tools" because *the audit was reading its own writing*. The
   review's own `p*-` tools are now excluded. This is `CLAUDE.md` rule 21 turned
   recursive, and it is the fourth time in four phases that the method needed
   correcting before the results meant anything.

A fourth was caught by the results looking wrong rather than by inspection: an
absolute/relative index mix-up made `alertPlan().extras`,
`fetchEmailQueue().lastRun` and `buildDiagnosticsFile().diag` appear unread when
all three are read plainly a few hundred lines later. **Had I not checked the
three by hand, all three would have been fabricated findings.**

### P4 recommendations, carried to P9

1. **P4-01 first.** Verifying a sign-out is a one-line change and the current
   behaviour makes a claim about security that is not checked.
2. P4-02 should use the same alert `save()` already uses — the pattern exists.
3. P4-03 and P4-05: an empty catch inside a recovery path is the worst place for
   one. Both should at least `logProblem`.
4. A guard: no empty `catch` in `index.html` without a comment saying why. **11
   of 33 already comply**, so the convention exists; it is simply not enforced.

**Verified vs diagnosed:** all seven findings were verified by reading the repo
at `00d6521`. **None was reproduced at runtime** — the failure modes need a
storage error to trigger, which was not simulated. That is a real limit on P4-01
and P4-02: the code path is certain, the trigger frequency is not.


## P5 — `index.html` top to bottom  ·  status: COMPLETE  ·  28 Aug 2026

**Question:** what is wrong inside the file nobody re-reads?

**10,892 lines, read in eight contiguous slices.** Method disclosed in full: the
reading was fanned out over eight agents, one fixed slice each, each instructed
to read line by line, to follow every candidate to its call site, and to say
plainly if it skimmed. **All eight reported reading their slice in full.** Every
finding below was then **verified by me against the file** before it was written
down — five by executing the real code in the test sandbox, eleven by reading the
exact lines. Findings that survived neither are marked as such.

That verification step is not ceremony. Of the candidates returned, several were
correct in mechanism but wrong in reach, and one whole class (the `Object.assign`
bridge) was correctly *rejected* by the reader who noticed the file ships as a
classic `<script>`, not a module.

**28 candidates. 16 verified so far, listed below. The rest are recorded with
their status and are the first work of any P5 follow-up.**

### Verified by executing the real code

| # | Where | Defect | Proof |
|---|---|---|---|
| P5-01 | `:613` `titleSimilarity` | Overlap counts A as a **multiset** while the denominator is the shorter title's word count, so one repeated word can push similarity to 1.0 | `looksDuplicate({title:'Grade 3 and Grade 4 and Grade 5 Swim'}, {title:'Grade 6 Trip'})` on the same date returns **`true`** — two unrelated events merge as duplicates |
| P5-02 | `:2281` `quickRoute` | `\bstar` has no trailing boundary, so it matches "starting", "startup" | `quickRoute('What time is the concert starting?')` returns **`ask_chores`, confidence 0.95, `autoRun:true`** — a calendar question answered from the chores section with no model call |
| P5-03 | `:2965` `matchListItems` | A word that resolves to an item already matched falls through to `missing` | `matchListItems(['milk','milk'])` returns **`{matched:[milk], missing:['milk']}`** — the same item reported as both ticked off and absent |
| P5-04 | `:4871` `buildVEVENT` | `crossesMidnight` uses `<=`, so an end **equal** to the start counts as crossing | An event `09:00–09:00` exports as **`DTSTART:20260914T090000 / DTEND:20260915T090000`** — a 24-hour block in Calendar |
| P5-05 | `:2104` `validateRoute` | `date`/`time` are shape-checked, never range-checked | `validateRoute` accepts **`date:'2026-13-45', time:'99:99'`** as `ok:true` — the entry is stored and can never appear in any scope window or clash check |

### Verified by reading the exact lines

| # | Where | Defect | Consequence |
|---|---|---|---|
| P5-06 | `:7570` | `onclick="toggleAllExportPick(${JSON.stringify(ids)})"` — `JSON.stringify` emits double quotes **inside a double-quoted attribute** | The attribute is truncated to `toggleAllExportPick([`. **"Select all" / "Clear all" on the export picker is permanently dead.** |
| P5-07 | `:7684` | `dedupeKeep` is keyed by a group's **index**, but `dismissGroup()` removes a group and the list is recomputed | After "Not duplicates" on the first group, `dedupeKeep[0]` names an id in no group → `applyDedupe` deletes **both** members of the surviving group |
| P5-08 | `:9665` | `gordonAuthCard()`'s signed-out branch opens `<div class="card">` and never closes it; the signed-in branch closes both | Signed out with provider `local`, **every section below** — base URL, model, fallback, API key, capabilities — renders *inside* the amber sign-in card |
| P5-09 | `:3859` | `oldDeleted` is declared and **never called** (one occurrence in the file) | The documented 90-day tombstone window holds for events only. Lists, chores, rewards and people are destroyed on the next prune regardless of age |
| P5-10 | `:6620` | `queueErrorReport` has exactly one call site, on a row just created with `count:1`, so the `count > 1` branch at `:6575` is unreachable | A failure that happens 40 times is reported to the admin console **once, with no occurrence count** |
| P5-11 | `:3923` | `restoreSnapshot()` does `Object.assign(blank(), parsed)` with **no `migrate()` call**, unlike `load()` | Restoring an older snapshot reinstates a stale `schemaVersion` and its old settings — e.g. the Thinking model tag — until a full reload |
| P5-12 | `:10136`, `:10168` | `var(--${cond ? 'red' : 'accent'}-accent)` builds **`var(--accent-accent)`**, which is defined in neither CSS file (`grep` = 0) | An unresolvable `var()` invalidates the whole declaration: the "nothing invented" card renders with **no left border**, and a zero miss-count is not painted green |
| P5-13 | `:10077` | `compareColumn` does `esc(title)`, but both call sites pass `ico('cloud') + '…'` | The provider-comparison headings show **literal SVG markup as visible text** |
| P5-14 | `:5033` | `alreadyDone` counts exported upcoming events, but the only caller passes `force=true` (`:7600`), so those events are already in `q` — **double counted** | 5 events, 3 exported → the banner reads "4 of **8**" |
| P5-15 | `:5527` | `open = showPast \|\| !!eventSearch`, but the button still toggles `showPast` | With a search active, tapping "Past events (N)" **does nothing** |
| P5-16 | `:9925` | `GORDON_BASE_URL` is a non-empty literal and `.replace(/\/+$/,'')` cannot empty it, so `if(!base)` is unreachable | The self-test can never report "Base URL: empty". A device with nothing configured **passes a check it should fail**, silently testing the hard-coded endpoint |

### P8-03 — the suite could print "0 failed" while a test had failed  ·  REAL, found by the deploy gate

**Found 28 Aug, not by looking — by `deploy.ps1` refusing a push:**

```
4. Tests
    node tests.js
X   Tests printed '666 passed, 0 failed' but node exited 1.
X   Nothing was committed and nothing was pushed.
```

**Where:** `tests-cases.js`'s `test()` called `fn()` and counted the result
immediately. An **async** test returns a promise, so it was counted as PASSED
the instant it started, and any later rejection became an unhandled rejection —
printed by Node *after* the summary line, never counted, never seen.

`test('the comparison restores the original provider even when a side fails',
async () => {…})` had failed. The summary said **0 failed**.

**Two separate defects, both fixed:**

1. **The harness.** `test()` now registers a promise in `pendingTests`, and
   `tests.js` awaits them **before** printing the summary. An async failure is
   now a failure like any other.
2. **The test itself was passing by accident.** Being async, its assertions ran
   long after the synchronous suite had finished and other tests had moved the
   shared `S.settings` on. It only ever passed because the old
   `compareProviders` wrote `'anthropic'` back into the shared object on its way
   out. It now asserts only what is genuinely async and genuinely local — that a
   **failed** comparison still drops `aiOverride`, so no later AI call inherits
   it. The "never writes `S.settings`" guarantee is asserted synchronously,
   where it can be trusted.

**What this says about the gate.** `CLAUDE.md` rule 18 makes `deploy.ps1` check
**both** the printed summary and the exit code. That redundancy looked like
belt-and-braces. It is the only reason this was caught: the summary was lying
and the exit code was not. **I had been grepping stdout for "passed," through
eight phases and never once checked the exit code** — a straightforward failure
to validate the gate in the form the gate runs it, which is standing rule 3 of
this very review.

**Honest note on the proof.** I planted a deliberately failing async test and
confirmed it is now counted (`668 passed, 1 failed`, exit 1). My attempted
"before" control did **not** reproduce the old behaviour — reverting only the
runner's `await` still left the rejection handler attached, so it was counted
anyway. The real evidence for the old behaviour is the observed run above and
its reproduction here: `0 failed`, exit 1, `AssertionError` on stderr.

### P5 follow-up — five of the twelve verified, 28 Aug 2026

| # | Candidate | Verdict |
|---|---|---|
| `dismissOneEmail` `:7254` | dismissing an unreadable email records nothing | **CONFIRMED — and it costs money.** It filters the row off screen and never touches `seenMsgs`, so `fetchEmailQueue` offers the same msgId on the next check and the app fetches and re-extracts it. Every 20 minutes, indefinitely. `dismissPendingEmail()` has always recorded it; this path did not. **FIXED v9.64.** |
| `checkEmail` `:7019` | `pendingEmailCount` never cleared on an empty check | **CONFIRMED.** `openEmailReviewNow()` resets it on empty; `checkEmail()` saves and returns without doing so, leaving "N waiting" on the Events tab with nothing behind it. **FIXED v9.64.** |
| `extractFromEmailPayload` `:7114` | a progress note is filed as a failure | **CONFIRMED.** `'combined read found nothing; trying each part separately'` is pushed into `problems`, and `:7198` turns **every** entry into a review-box failure *and* a `logProblem()` row. An email whose per-part passes then succeed still produces a Problem Log entry and a retriable "trouble" row. Same symptom migration v7 was written to clean up. **Not fixed** — which notes count as failures is a judgement call about your Problem Log. |
| `callAI` `:4448` | the fallback toast and log are emitted before Anthropic answers | **CONFIRMED, minor.** `recordAiCall(fellBackTo)` and *"Read by Anthropic…"* both run before `return await callClaude(...)`. If Anthropic then fails, the user has already been told it succeeded. Same family as P4-01: asserting an outcome not yet achieved. |
| `retryEmailTrouble` `:7411` | retry does not de-duplicate by msgId | **NOT CONFIRMED — refuted.** `pendingMsgIds` is de-duped through `new Set` at `:7425`, and `markDuplicates(out, pendingEvents)` guards the entries. The reader's mechanism was wrong. |

### Second verification pass — three more, 28 Aug 2026

| # | Candidate | Verdict |
|---|---|---|
| `addKid` `:10547` | person colour picked by live count, so a delete makes the next person collide | **CONFIRMED by execution.** Add Ana/Ben/Cy → `#7C3AED / #0E7490 / #B45309`. Delete Ben, add Dee → **Ana `#7C3AED`, Cy `#B45309`, Dee `#B45309`** while `#0E7490` sits free. Colour is the person tag on every chip, filter and event row, so two people become indistinguishable. **FIXED v9.64** — the first *unused* colour is chosen. |
| `citedEvents` `:1667` | `\[(\d{1,2})\]` caps citations at 99 | **CONFIRMED by execution.** A "next 3 months" scope with 140 events in window emits **140 refs numbered to 140**, and `citedEvents('see [140]', refs)` returns **0**. Any citation the model makes above 99 is silently dropped and the answer shows no source. Not fixed — needs a decision on whether to widen the regex or cap the refs. |
| `daysUntil` `:475` | mixes UTC-parsed and local dates when `today` is injected | **NOT CONFIRMED — refuted.** `daysUntil('2026-08-29', new Date(2026,7,28))` returns `1`; same-day returns `0`. The mechanism does not manifest. |

**Running tally of the twelve: eight verified — six confirmed, two refuted.**
Two refutations in eight is the argument for the pass.

**Four candidates still unverified**, and they stay marked as such: `:475`
`daysUntil`, `:1667` the citation regex ceiling, `:3670` `contextFromPs`
falling back to another model's window, `:4522` the cached context never
invalidated, `:6151`/`:6156` the disambiguated `check_list_item`, `:5950` the
clarify-options gate, `:8232` `saveReview` provenance, `:9473`/`:9508` the
recipe batch counter and the discarded recipe, `:10065` the comparison setup
error, `:10464` the person-colour collision.

**One refutation out of five is the point of this pass.** A reader's report is a
lead, not a finding.

### Reported, mechanism read, NOT yet independently verified

Recorded so nothing is lost, and so the line between what I checked and what I
did not is visible: `:475` (`daysUntil` mixes UTC-parsed and local dates when the
injectable `today` is passed — no shipped caller does), `:1649` (citation regex
`\[(\d{1,2})\]` silently drops refs ≥ 100), `:3670` (`contextFromPs` falls back
to the *first loaded model's* window when the requested one is absent, against
its own "returns null rather than a guess" contract), `:4522` (probed context is
cached for the session and never invalidated when the model setting changes),
`:4404` (the "Read by Anthropic" toast and the `fellBackTo` log entry are emitted
**before** the Anthropic call is attempted), `:6151`/`:6156` (a disambiguated
`check_list_item` loses its `itemIds`; a user with no lists gets an empty
"which one?" prompt), `:5950` (`clarify` options are stored as strings and read
as `{id,name}`, behind a gate that can never open), `:6975` (`pendingEmailCount`
is never reset to 0 on an empty check, so the badge outlives its queue), `:7201`
(dismissing an unreadable email never records the msgId, so it is re-fetched and
re-extracted **forever**, at cost, on every check), `:8232` (`saveReview` stamps
batch-level `pendingSource` over per-email provenance), `:7070` (a progress note
is pushed into `problems`, producing a false "couldn't be read" row and a false
Problem Log entry when the fallback then succeeds), `:7368` (retry does not
de-duplicate by msgId → double AI cost and a duplicate entry), `:9473` (the
recipe batch counter never shows "1 of N" when a photo fails), `:9508` (a recipe
whose send fails is **discarded**, not retained for retry), `:10065` (a failure in
shared setup is recorded against Anthropic only, so the screen claims the local
model ran and found nothing when it was never called), `:10464` (person colour is
picked by live count, so deleting the middle person makes the next one collide).

### What P5 says about the codebase

The source methodology predicted this phase would be slow, boring, and find the
most *interesting* bugs. That held. None of these 28 is caught by the 656-test
suite, none produces an error in the console, and none would ever appear in a
Problem Log entry. **They are all things that are quietly, plainly wrong.**

Three deserve fixing regardless of what else the review finds:

1. **P5-06** — a control that has never worked.
2. **P5-07** — a path that **destroys both events** in a duplicate pair.
3. **P5-01** — unrelated events silently merged as duplicates.

**Verified vs diagnosed:** 16 verified against the repo at `00d6521` (5 by
execution, 11 by reading). 12 recorded from a reader's report with the mechanism
read but not independently confirmed — those are explicitly not yet findings, and
verifying them is the first task of any follow-up. **No code was changed.**


## P6 — One-way doors  ·  status: COMPLETE  ·  28 Aug 2026

**Question:** what can the user do that they cannot undo, see, or reverse?

This is the class the whole review was triggered by. **Tool:** `tools/p6-oneway.js`.

### The standard, taken from a case the app gets RIGHT

`settings.seenMsgs` has the identical *shape* to the defects — a list that grows
and suppresses things — and it is **not** a defect, because
`forgetImportedEmails()` (`index.html:6888`) empties it and the button shows the
count. So the rule this phase applies is:

> **Suppression is fine. Suppression with no way back is the bug.**

Three questions per key: can the user **undo** it, **see** what they suppressed,
**clear** it? Three "no"s is a finding.

### The result: the class has exactly two members

All **25** `S.settings.*` keys enumerated. Scalar preferences (theme, provider,
model, tone) are excluded on principle — a value that can always be set to
another value is not a door. That leaves eight accumulating keys:

| Key | Verdict |
|---|---|
| `dismissedConflicts` | **NO WAY BACK** — the trigger finding |
| `notDuplicates` | **NO WAY BACK** |
| `seenMsgs` | clearable — `forgetImportedEmails()`, count shown |
| `senderTags` | clearable — tags toggle off in the sender manager |
| `exportQueue` | clearable — `cancelExportQueue()` |
| `errorReportsOff` | **not a door** — `setErrorReports(this.checked)` from a visible checkbox (`:9352`), two-way |
| `nudgeSnooze` | **not a door** — holds today's date and expires tomorrow |
| `starCarry` | **not a door** — recomputed by `pruneData()` (`:3853`) |

**Nothing new was found.** The two already known are the whole class, and that
is now established by enumeration rather than by having noticed them.

### P6-01 — `dismissedConflicts`  ·  REAL (confirmed in P2, now enumerated)

Written once (`index.html:5706`), read twice (`:5527`, `:5554`), **never
cleared**. No undo on the dismiss, no screen listing what has been silenced, no
way to bring one back. A single tap on an unlabelled ✕ silences that pair of
events permanently.

### P6-02 — `notDuplicates`  ·  REAL, same shape

Pushed at `:7598` and `:7657`, read at `:7588` and `:7648`, **never cleared**.
Tapping "Not duplicates" on a pair is permanent. Two events that genuinely are
duplicates and were mis-dismissed can never be offered again.

### P6-03 — `startFresh()` is a one-way door done RIGHT, with one omission

`index.html:3957`. Worth recording as the standard the other two should meet:
**two** confirmations, the second naming what goes ("all events, chores, stars,
lists and recipes"), and the first saying plainly *"This cannot be undone.
Download the rescue file first if you have not."* Irreversible by nature, and
the user is told so twice before it happens.

**The omission:** it removes every key beginning `flyersnap`, and `SNAP_PREFIX`
is `'flyersnap-snap-'` (`:3888`). So it also destroys **the app's own daily
snapshots** — the thing `restoreSnapshot()` exists to read. The wording sends
the user to the rescue file, which is right, but nothing says the internal safety
net goes too. `GORDON_SESSION_KEY` (`'flyersnap.gordon.session'`, `:920`) is
also swept, which is correct and probably intended.

### Record flags — enumerated, nothing found

| Flag | set true | set false | toggled | verdict |
|---|---|---|---|---|
| `deleted` | 7 | 2 | 0 | reversible via `softDelete`'s undo toast |
| `handled` | 1 | 1 | 0 | `markHandled` offers undo |
| `done` (problems) | 4 | 1 | 0 | `reopenProblem` |
| `checked` | 1 | 1 | 1 | toggles |
| `pinned` | 0 | 0 | 1 | toggles |
| `unread` | 0 | 3 | 0 | one-way by design — "seen" does not un-see |
| `exported` | 3 | 1 | 0 | reset on re-export |

### CORRECTIONS to this phase's tool — the two that mattered most in the review so far

1. **The emptiness test ended in `\b`.** For `= []`, `= {}`, `= ''` the last
   character is not a word character and the next is `;`, so the boundary could
   never match. **21 of 25 keys were reported as never cleared** — including
   `seenMsgs`, which is the phase's own worked example of a key that *is*
   cleared. Had that gone in the log, the standard this phase rests on would
   have been listed as a defect.

2. **An empty assignment is not a clear when it is a lazy initialiser.** After
   fixing (1), the tool reported `dismissedConflicts` and `notDuplicates` as
   **CLEARABLE** — because `if(!S.settings.notDuplicates) S.settings.notDuplicates = []`
   and `S.settings.dismissedConflicts || (S.settings.dismissedConflicts = [])`
   both assign `[]`. Both mean *create it*, not *empty it*.

   **This would have overturned the two findings the entire phase was seeded
   with** — the ones already confirmed by hand in P2 and in the original
   conversation. The only reason it did not is that the new output disagreed
   with something already known to be true, and a disagreement between a tool
   and a verified fact is a bug in the tool until proven otherwise.

That is the seventh method correction in six phases. It is no longer an
incidental observation: **on this codebase, the first version of an analysis is
wrong often enough that "the tool said so" is not evidence.** That belongs in
`CLAUDE.md` as a rule in its own right, and it is the single most reusable thing
this review has produced.

**Verified vs diagnosed:** all eight accumulating keys verified by reading the
repo at `00d6521`; the two findings additionally cross-checked against P2 and
against the original conversation. Nothing reproduced at runtime — P6 is a
question about reachability, not behaviour. **No code was changed.**


## P7 — Affordance and discoverability  ·  status: COMPLETE  ·  28 Aug 2026

**Question:** can the user tell what a control does, and find it at all?

The phase the trigger finding actually belonged to, and the one the source
methodology has no equivalent of. **Tool:** `tools/p7-affordance.js`, validated
against two facts established by hand before any of its other output was
trusted: the clash-banner ✕ must appear in check A, and `dismissConflict` must
appear in check B. **Both did.**

**164 buttons** in the shipped script.

### The headline: the app has a pattern for *delete* and no pattern for *dismiss*

Delete in FlyerSnap is consistent and well signposted. It is red, it either
confirms or offers an undo toast, and it says what will go — `startFresh()`
confirms twice and names the categories; `keepOnlyEvent()` confirms *and*
undoes; `softDelete()` always offers a way back; `removeKey()` confirms.

**Dismiss has none of that**, and P6 established that dismiss is exactly as
permanent as delete. Every dismissing control in the app, enumerated:

| Control | Visible name | Red? | Permanent? |
|---|---|---|---|
| `dismissConflict` `:5570` | **✕ only** (`aria-label="Dismiss this warning"`) | no | **yes** |
| `dismissConflict` `:5618` | "Keep both — this is fine" | no | **yes** |
| `dismissGroup` `:7734` | "Not duplicates" | no | **yes** |
| `dismissOneEmail` `:7358` | "Dismiss this" | no | yes (`seenMsgs`, clearable) |
| `dismissPendingEmail` `:8179` | "Skip all from this email" | no | yes (`seenMsgs`, clearable) |
| `dismissEmailTrouble` `:8101`, `:8127` | ✕ and "Dismiss" | no | session only |

The first three write the one-way doors from P6. **None is red, none confirms,
none offers an undo, and the word "permanently" appears on none of them.** A
user tapping "Not duplicates" has no way to know it is a decision they can never
revisit — and by P6 it demonstrably is.

**This is the whole trigger finding, generalised.** It was never really about
the clash banner: the app treats *destroying a thing* as serious and *silencing
a thing* as trivial, and in this codebase they are equally irreversible.

### P7-01 — One action, two names, opposite tones  ·  REAL (the trigger)

`dismissConflict()` is reached from a bare **✕** and from a large green button
reading **"Keep both — this is fine"**. Same function, same key, same permanent
outcome. One reads as *close this*, the other as *approve this*. Neither
contains the word "dismiss", which is why the question was asked in the first
place.

Five other handlers are reached from two differently-worded controls —
`exportBackup` ("Export now" / "Export backup"), `openProblems`, `goToEvents`,
`mealPlanDiagnostic` ("Why no meals?" / "Why don't I see my meals?"),
`openUrl`. Those are the same action offered in two places with sensible
wording, **not** defects. `dismissConflict` is the only one where the two names
imply different things.

### P7-02 — Ten controls whose only name is an `aria-label`  ·  REAL, and unguarded by design

`:5570` (dismiss warning), `:8101` (dismiss trouble), `:8165` (edit this event),
`:8509` / `:8636` / `:8748` (delete chore / reward / list), plus Back and Ask.

**The existing a11y suite passes on every one of them**, because they all have
accessible names. The suite has no concept of a *visible* label, so a control
can be perfectly accessible to a screen reader and completely opaque to a person
looking at the screen. That is the gap this phase exists to name, and it is
currently guarded by nothing.

Three of them delete something. A ✕ that deletes a chore and a ✕ that dismisses
a warning look identical.

**Corrected before reporting:** the first run of the tool reported **15**
controls with no name at all. It was stripping every `${...}` expression before
looking for words — but the notes Pin button is `${n.pinned ? 'Unpin' : 'Pin'}`
and is perfectly well labelled. After the fix the real count is **zero**: every
button in the app has a name of some kind. The finding is about *visible* names,
not missing ones, and overstating it would have buried the real point.

### P7-03 — `confirm()` and undo-toast are used in near-equal numbers, by no stated rule

**12** `confirm()` calls, **11** undo toasts. `CLAUDE.md` records that v9.0
deliberately replaced confirms with undo toasts, so the intended direction is
known — but both patterns are live and the choice between them is made
case-by-case. v9.59's `keepOnlyEvent()` deliberately does *both*, for a stated
reason (the row you tap is not the row that disappears), which is the only
place the decision is written down.

Not a defect. It is a convention that exists in practice and nowhere in writing,
so each new control re-litigates it. Belongs in `CLAUDE.md` in P9.

### Reachability — the precedent that started this

The watched-senders manager is three taps deep (**Settings → Reminders and email
→ Manage watched senders**) and is **hidden entirely** unless
`watcherConfigured()` is true (`index.html:5994` — both URL *and* token saved).
Logan reported it as missing on 26 Aug. It was not missing; it was two levels
down and conditionally invisible.

That is the same class as everything above: **a capability people cannot find is
a capability they do not have**, which the app's own `setHeader` comment already
says about the Ask button. The principle is stated in the codebase and applied
in one place.

### P7 recommendations, carried to P9

1. **Give the dismiss family the same manners as the delete family** — a visible
   word, and either a confirm or an undo. They are equally permanent.
2. Put the word **"dismiss"** on the control that dismisses (P7-01).
3. A guard the a11y suite cannot currently express: a control that performs a
   **permanent** action must have visible text, not only an `aria-label`.
4. Write the confirm-vs-undo rule down.

**Verified vs diagnosed:** all counts verified against the repo at `00d6521`
with a tool validated on known-true cases first. The reachability claim is
verified in code (`watcherConfigured` gating) and corroborated by Logan's own
report. **Nothing reproduced on a device. No code was changed.**


## P8 — Is the suite honest?  ·  status: COMPLETE  ·  28 Aug 2026

**Question:** would these 656 tests fail if the code were wrong?

This project has shipped a guard that read prose instead of code **five times**
(`CLAUDE.md` rule 21 records the third; a fourth and fifth followed). So the
phase does not ask the suite politely — it attacks it.

### The experiment: delete every comment in `index.html` and run the suite

A guard that reads code cannot notice. A guard that reads prose must fail. One
mutation flushes out the entire class at once.

**Result: 653 of 656 tests still pass.**

The three failures:

| Test | Verdict |
|---|---|
| `the inlined copies match js/ exactly` | **correct** — `js/` still has its comments, the inlined copies no longer do, so they genuinely differ. The guard working. |
| `the inlined <style> matches css/ exactly` | **correct**, same reason |
| `a failed combined read falls back instead of losing the email` | **a real prose-reading guard.** See P8-01 |

**That is a good result and it deserves saying plainly.** After five recorded
occurrences, the suite now has exactly one guard of that class left in it.

### P8-01 — An ordering guarantee checked by the position of a comment  ·  REAL, occurrence six

**Where:** `tests-cases.js:1999-2005`.

```js
const src = String(extractFromEmailPayload);
assert.ok(/trying each part separately/.test(src), 'per-source passes remain as a fallback');
assert.ok(src.indexOf('Pass 1') > src.indexOf('combined read'), 'combined is attempted first');
```

The first assertion is defensible: `'combined read found nothing; trying each
part separately'` is a **string literal** the app pushes into `problems`
(`index.html:7070`, `:7072`), so it is checking a message the user can see.

The second is not. **`Pass 1` exists only in a comment** —
`index.html:7077  // Pass 1: the body text. Any model can do this.` The test's
own message says *"combined is attempted first"*, and what it actually verifies
is where an English phrase sits relative to another. Reorder the two passes for
real while leaving the comments alone and **the guard still passes**. Delete the
comment and it fails while behaviour is byte-identical — which is how it was
found.

**Fix:** assert on the operative expressions, the way the `deploy.ps1` guards
were fixed after rule 21 — those strip `#` comments first (`tests-modules.js:3054`)
and pin `$m -lt $headStamp` directly. The pattern is already in the repo.

### P8-02 — The harness's own scope is defined by two comments  ·  REAL, and nothing guards it

**Where:** `tests.js:86` and `:92`.

```js
let app = html.split(openTag)[1].split('</script>')[0]
  .split('// ---------- File input wiring ----------')[0]   // :86
app = app.split('// Bridge for inline handlers.')[0]        // :92
```

**The suite decides how much of the app to execute by splitting on two comment
banners.** Reword either one — a perfectly ordinary edit, and nothing in the
repo says not to — and the suite silently changes what it runs.

This is not hypothetical. **The first run of this phase's experiment did exactly
that**: stripping comments removed the "File input wiring" banner, the sandbox
then loaded code it normally excludes, and the entire suite died with
`TypeError: document.getElementById(...).addEventListener is not a function`
before a single test ran. A hard crash is the lucky outcome; the same edit made
the other way would silently *shrink* the tested surface with everything still
green.

**Fix:** a guard asserting both markers still exist verbatim in `index.html`, or
a marker that is code rather than prose. Two lines.

### Nothing else was wrong, and that is a result

- **Assertion-free tests: zero.** All 650 parsed test blocks contain at least
  one `assert`.
- **Skipped or disabled tests: zero.** No `test.skip`, no commented-out `test(`.
- **Test files not loaded by the runner: zero.** All three on disk
  (`tests-cases.js`, `tests-refactor.js`, `tests-modules.js`) are loaded by
  `tests.js`.

### The load-bearing guards, mutation-tested

`CODE-REVIEW-PLAN.md` P8 says to check these specifically, because they are what
the whole workflow rests on and nothing guards *them*.

| Guard | Mutation | Result |
|---|---|---|
| inlined copies match `js/` | `ASSUMED_MINUTES` 60 → 61 in `js/conflicts.js` | **RED** (done in P1) |
| refuses a build older than its commit | `$m -lt $headStamp` → `$false` | **RED** |
| written for PowerShell 5.1 | inject `&&` into `deploy.ps1` | **RED** |
| tests gate the push on the summary line | `0 failed` → `0 failures` | **RED** |

All four fire. The rule-21 fix held: the stale-build guard pins the operative
expression, not the words next to it.

### CORRECTION — my ninth method error in eight phases

My first pass at "tests with no assertion" reported **28** of them in
`tests-modules.js`, including several I wrote myself this week and know contain
asserts. The block-extractor was brace-matching, and braces occur inside
template literals and regexes, so it truncated bodies early. Re-parsed by
splitting on `test(` boundaries instead: **the real number is zero.**

Caught only because the output named tests I personally wrote. That is luck, not
method — and it is the same shape as P6's near-miss, where the tool disagreed
with a fact already established by hand.

**This is now the most consistent finding of the entire review.** Nine analysis
tools, nine first drafts wrong. The rule it produces is not "be careful"; it is
concrete: **an analysis result is not evidence until it has reproduced something
already known to be true.** Every tool from P6 onward was validated that way
first, and that is the only reason P6 and P7 did not publish false findings.

**Verified vs diagnosed:** every claim here was verified by running the suite —
the comment-strip experiment and four separate guard mutations, all executed.
**Nothing in P8 is diagnosed-only.** No code was changed.


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

## P9 — Prevention  ·  status: COMPLETE  ·  28 Aug 2026

**Question:** what stops each class recurring?

There is no lint layer to put a rule in, so every guard here is a **test**, and
every one was **mutation-tested** — broken deliberately, watched go red.

### Guards added (3 tests, +3 → 659 passing)

| Guard | Class | Mutation | Result |
|---|---|---|---|
| `tests.js` refuses to run if a harness boundary marker is gone | P8-02 | reword `// ---------- File input wiring ----------` | **clear early failure** naming the marker, instead of a stack trace |
| …and a test that the early check itself is not deleted | P8-02 | comment out its `process.exit(1)` | **RED** |
| the meal-plan storage key is named once, not twice | P3-01 | reintroduce a raw `'mealplan-out'` literal | **RED** |
| the app and the watcher agree on every Anthropic constant | P3-02 | drift the model | **RED** |
| " | P3-02 | drift `anthropic-version` | **RED** |
| " | P3-02 | rename the watcher's `unauthorized` string | **RED** |

**One design decision worth recording.** The boundary guard was first written as
an ordinary test — and mutation-testing showed **it could never fire**.
Rewording a marker crashes the sandbox at load time, before any test executes;
the suite died with a stack trace and my guard never ran. The check had to move
into `tests.js` itself, ahead of `runInContext`. *A guard that runs after the
damage is not a guard*, and only mutation testing revealed the difference.

### The one fix applied in this phase

`mealPlanDiagnostic()` now reads `MEALPLAN_KEY` instead of a raw
`'mealplan-out'` literal (`index.html:9381`). **One word**, no behaviour change —
applied because a guard for that class cannot exist while the violation does.
Everything else remains listed, not fixed.

### Rules added to `CLAUDE.md` (25–28)

Each names the bug that justifies it. A rule with no bug behind it gets ignored.

**25. An analysis result is not evidence until it has reproduced something
already known to be true.** Nine tools were written for this review and **all
nine were wrong on their first run**. Two would have published false findings;
one would have *deleted* two confirmed ones. This generalises rule 21 from
guards to the things written to check the guards.

**26. Dismiss is as permanent as delete here, and wears none of its manners.**

**27. A constant shared with `gmail-watcher.gs` has no import path — pin it.**

**28. The instrument you reach for when something is wrong must not be the thing
that is wrong.** Three independent instances in one review.

### What is NOT guarded, and why

Honest scope. A guard cannot pass while the thing it forbids is still present,
so these need their fix first:

| Class | Guard blocked by |
|---|---|
| every empty `catch` states a reason | 22 empty catches (P4) — 11 already comply, so the convention exists |
| a permanent control has visible text | the dismiss family (P7) |
| an accumulating settings key has a clearing path | `dismissedConflicts`, `notDuplicates` (P6) |
| the working copy matches the repo | needs a `git ls-files` check in `deploy.ps1` (P1-01) |

Each is one guard away, on the far side of one fix.

---

# The review, in summary

Nine phases, `00d6521` (v9.61) → **659 passing, 0 failing**.

| Phase | Result |
|---|---|
| P1 reachability | **zero dead code**; 4 documentation inconsistencies |
| P2 write paths | **1 real defect**, reproduced: `compareProviders` persists `aiFallback:false` |
| P3 one fact one place | 9 shared facts, **1 guarded** → now 3 |
| P4 silent failures | 111 catches; **5 worth acting on**, 1 security-adjacent |
| P5 index.html read | **28 candidates, 16 verified** — the richest phase |
| P6 one-way doors | class enumerated: **exactly 2 members** |
| P7 affordance | the trigger finding, generalised |
| P8 suite honesty | **653/656 survive comment deletion**; 1 prose guard, 1 harness hazard |
| P9 prevention | 3 guards, 4 rules, 1 fix |

## FIXED in v9.63 — 28 Aug 2026

All five, each with a regression test that fails without the fix, each
mutation-tested (six mutations, six killed).

| # | Fix | Guard |
|---|---|---|
| **P5-07** | `dedupeKeep` is keyed by the group's member ids (`dedupeGroupKey`), not its position, and a keep-id that belongs to no member of the group is refused | 2 tests; a full revert to index keying turns 4 tests red |
| **P4-01** | `clearGordonSession()` reads the key back and returns whether it is really gone; `gordonSignOutUI()` alerts and logs a Problem instead of claiming success | 1 test driving a throwing `removeItem` |
| **P2-01** | `compareProviders` forces a provider through an in-memory `aiOverride` and never writes `S.settings`; `aiFallbackOn()` is now the single read point for the fallback | 2 tests, one pinning that `S.settings.x =` appears nowhere in the function |
| **P5-06** | `toggleAllExportPick()` takes no argument and derives the ids from `exportCandidates()` — the same helper the screen renders from | 2 tests |
| **P5-01** | `titleSimilarity` compares **sets**, not multisets (fixed in `js/matching.js`, the source, and re-inlined) | 1 test asserting the false match is gone AND the real matches still work |

Two follow-on improvements fell out of the fixes rather than being sought:
`exportCandidates()` gives "which events can be exported" one definition
instead of two, and `aiFallbackOn()` collapses four scattered reads of one fact
into one — both P3 wins for free.

**Three existing tests had to be updated**, none of them loosened: two dedupe
tests called `setDedupeKeep(0, …)` and now use the group key; the comparison
test pinned the *old* mechanism (`aiFallback = false`) and now pins the new one
plus the guarantee it buys. A fourth — `Gordon is a display name, never a
provider` — read only the **first line** after `function aiProvider(`, so it
went red when the function grew a second line while behaving correctly. Same
defect as the `nav()` guard in v9.61; widened to read the whole body.

---

**The five, before they were fixed**, in the order they were tackled:

1. **P5-07** — `applyDedupe` deletes **both** events after a group is dismissed.
2. **P4-01** — sign-out reports success it never verified.
3. **P2-01** — `aiFallback:false` persisted for the length of two model calls.
4. **P5-06** — "Select all" on the export picker has never worked.
5. **P5-01** — unrelated events silently merged as duplicates.

**The finding that outlives all of them** is rule 25. Nine tools, nine wrong
first drafts, on a codebase whose own conventions file already had a rule about
reading prose instead of code. The method is not "be careful". It is: point the
instrument at a known answer before believing anything else it says.

