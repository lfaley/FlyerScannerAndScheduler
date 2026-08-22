# FlyerSnap — Handoff Notes

**Updated:** August 22, 2026 · **Live version:** v9.22 · **Tests:** 475 passing
**Repo:** `lfaley/FlyerScannerAndScheduler` · **Live:** `https://lfaley.github.io/FlyerScannerAndScheduler/`
**Local repo:** `C:\Users\Logan\Desktop\Repos\FlyerSnap`

> New here? Read **CLAUDE.md** first — it is the architecture and rules brief.
> This file is the *state of play*: what just happened, what is next, what to
> be careful of. The two together should be enough to pick up cold.

## What FlyerSnap is

Family-organization PWA for Logan. Single `index.html`, vanilla JS, no build
step. Scans flyers/PDFs/emails → AI extracts events → calendar reminders.
Also: chores/stars, lists, recipe scanning, meal plan (read-only from a
separate recipe app), Gmail watcher, event sharing, and a local-AI-model
option alongside Anthropic.

## Deploying — Logan pushes, agents never do

```powershell
cd C:\Users\Logan\Desktop\Repos\FlyerSnap
node tests.js
git add -A
git commit -m "<what changed>"
git push
```

Tests must end `N passed, 0 failed` before committing. Pushing to `main`
triggers the GitHub Pages deploy. Bump BOTH the version stamp in `index.html`
and `CACHE` in `sw.js` with every release, or installed phones keep the old
copy. If `gmail-watcher.gs` changed, say so explicitly — it must be re-pasted
at script.google.com (Deploy → Manage deployments → new version). If it did
not change, say that too.

`deploy.ps1` (the older zip-based flow) still works and self-updates from the
zip; it is only needed when work arrives as a downloaded zip rather than
written straight into the folder.

## Current state — August 2026

The repo moved from `FlyerAndScheduler\flyersnap-pwa` to `Repos\FlyerSnap`;
older docs may still name the old path, which is dead.

Docs in the repo: **CLAUDE.md** (architecture + rules, read first),
**HANDOFF.md** (this file), **EXPERT-QA.md** (presentation prep — also the
clearest single summary of what this project is and where it is weak),
**UI-MODERNIZATION-PLAN.md** (the design work),
**GMAIL-WATCHER-SETUP.md**, **LOCAL-MODEL-PLAN.md**, **VISION-MODEL-SETUP.md**,
**RETIRED-CODE-REFERENCE.md**, the RECIPE-APP-*.md integration notes, and
**DEPLOY.md** (historical one-time Pages setup).

A UI modernization is in flight, driven by an upcoming presentation to
industry experts. See **UI-MODERNIZATION-PLAN.md** for the six-phase plan and
a per-version progress log.

| Version | What shipped |
|---|---|
| v8.6 | Emergency revert of ES modules (blank screen in the installed PWA) |
| v8.7 | Fixed the missing/misplaced floating buttons; iOS 26 viewport-gap cover |
| v8.8 | Design tokens, dark mode, WCAG contrast test, preview harness, CSS source files |
| v8.9 | 40-icon inline SVG sprite replacing all emoji chrome |
| v9.0 | Empty states, undo toast replacing `confirm()`, Meals action row |
| v9.1 | Accessibility pass (WCAG 2.2), DOM audit tool |
| v9.2 | Self-contained-boot guard; deleted the doc that recommended the v8.1 mistake |
| v9.3 | Maskable icons, manifest, Lighthouse 99/100/100/100 |
| v9.4 | Swipe left/right between the five tabs |
| v9.5 | EXPERT-QA.md — presentation prep; UI plan complete |
| v9.6 | Extraction accuracy benchmark (corpus + scorer + runner) |
| v9.7 | AI throughout the app: capability registry, Ask, clash warnings, global off switch |
| v9.8 | Real assistant: intent registry + router, app-wide, can act (with consent) |
| v9.9 | Dark by default, actionable warnings, faster assistant, iOS 26 nav gap actually fixed |
| v9.10 | Gordon remembers the conversation across launches |
| v9.11 | Ask screen reworked: pinned composer, honest busy state |
| v9.12 | Edit Event rebuilt against form-usability research (FORM-UI-REVIEW.md) |
| v9.13 | AI call logging + desktop diagnostics reader (`tools/diagnostics.js`) |
| v9.14 | Gordon can act: ten intents, named confirm buttons, discoverable chips |
| v9.15 | A11y audit extended to all 25 screens; back button was a 24px target |
| v9.16 | Routing benchmark (`eval/router-cases.json`); quickRoute stopped answering out-of-scope questions |
| v9.17 | The benchmark runs inside the app, against the provider actually configured |
| v9.18 | One matching implementation; duplicate detection missed identical stop-word titles |
| v9.19 | The reading benchmark runs in the app too — the app's primary job finally has a number |
| v9.20 | Service worker serves cache-first: launches paint instantly instead of waiting on 124KB |
| v9.21 | Ask reachable from all 28 screens, returning you exactly where you were |
| v9.22 | Settings became a six-page hub: 5,794px of scroll down to a 590px menu |

**v9.2 — locking the door on the blank-screen bug.** Three tests now fail the
build if the shipped `index.html` ever gains a `<script type="module">`, a
`<script src>`, a `<link rel=stylesheet>`, or an `import`/`export` in its own
script — i.e. anything that must be FETCHED to boot. Mutation-tested against
the real v8.1 change to prove they catch it. `ARCHITECTURE-PLAN.md` was
deleted: it predated the incident and still recommended
`<script type="module" src="js/app.js">`, so a future agent could have
reintroduced the outage in good faith. Its surviving conclusions (the
`state.js` constraint, why not to rewrite object-oriented) moved into
CLAUDE.md; the full text remains in git history.

**v9.3 — installability.** All app icons are now generated from the brand
tokens by `tools/build-app-icons.py`, so they cannot drift from the palette:
rounded-square `any` icons, full-bleed `maskable` icons with the artwork
inside the 80% safe circle (Android masks to a circle — transparent corners
showed as notches, and the old icons had them), and an opaque 180px
`apple-touch-icon` (iOS composites transparency onto black). The manifest
gained `id`, `orientation`, `categories`, `lang`, real screenshots and an
"Add paperwork" shortcut — which the app now honours via `?go=capture`, since
a shortcut landing on the default screen is worse than no shortcut. The
service worker caches entries individually: `addAll` is all-or-nothing, so one
404 previously meant NOTHING was cached and the app had no offline copy.

**Lighthouse (mobile): Performance 99 · Accessibility 100 · Best Practices 100
· SEO 100.** Reproduce with `bash tools/run-lighthouse.sh`. Three real defects
surfaced and were fixed: a silent `/favicon.ico` 404 logging a console error,
a missing meta description, and `void m.offsetWidth` in `render()` forcing a
synchronous layout measured at 39 ms per navigation — replaced by the Web
Animations API, verified in the browser to still restart the animation.
The audits still below 100 are "minify JS/CSS" and "reduce unused JS/CSS",
i.e. *add a build step* — a deliberate architectural rejection (see CLAUDE.md);
plus `document-latency`, which is an artifact of the local test server sending
no compression. GitHub Pages gzips.

**v9.4 — swipe navigation.** Swiping left/right on the content area moves
between the five tabs. The decision lives in `js/gestures.js` as a pure
`swipeIntent()` function, so all eight rules are unit-tested without a
browser, then verified end-to-end with synthetic touch events in Chromium.

The load-bearing constraint: **an installed iOS web app keeps Safari's native
edge-swipe back/forward gesture and it cannot be disabled from web code**
(researched, not assumed — see the Ionic issue thread). So a gesture starting
within 28px of either screen edge is ignored and left to the OS; handling it
too would move two screens on one flick. Nothing calls `preventDefault` —
we cannot outrank the OS gesture and trying would break scrolling; listeners
are passive. Swipes are also ignored on sub-screens (an accidental flick must
not discard a half-filled form), on multi-touch (pinch-zoom must keep working),
and when the gesture starts on an input or on the horizontally-scrolling chip
bar. No wrap-around at the ends. The tab bar still does everything swiping
does, which WCAG 2.5.1 requires.

**v9.22 — Settings stopped being a wall.**

Logan: *"there is a lot going on with it and its hard to find anything."*
Measured before touching it: **5,794px — 6.8 phone screens**, 11 sections, 27
controls, one flat scroll. "What Gordon can and cannot do" was **1,731px** of
that on its own. I had added three of those sections myself in this session.

Now a hub of six rows, **590px, fits on one screen without scrolling**:

| | height | |
|---|---|---|
| hub | 590px | People · Gordon and AI · Reminders and email · Appearance · Backup · When something goes wrong |
| setPeople | 452px | |
| setAI | 958px | key, provider, local model, link to the capability list |
| setCapabilities | 1,783px | the full disclosure, on its own page |
| setReminders | 1,077px | alerts + Gmail watcher |
| setAppearance | 259px | |
| setBackup | 579px | |
| setTrouble | 1,298px | diagnostics, problem log, both benchmarks, local-model checks |

**Hub-and-spoke rather than accordions, on evidence.** NN/g find accordions on
mobile "conserve space but can also cause disorientation and too much
scrolling". A drill-down list is also the pattern every iPhone owner already
knows from iOS Settings, and the app already had a proven sub-screen system —
so the seven new screens inherited the back button, the swipe rules and the
a11y audit for free. The audit now covers **35 screens**.

**Every row carries its current state**, which is the main thing a hub buys
over a scroll: "Appearance / Dark" answers the question without opening
anything. Rows that need attention turn amber — "Never exported", "1 problem to
look at". A test asserts the hub reads live state rather than printing static
labels, because that is the easy half to leave out.

**The guard that matters most: nothing was lost in the reorganisation.** A test
lists 24 controls that existed on the old page — `addKid`, `saveWatcher`,
`manualPrune`, `toggleExtraReminders`, `restoreSnapshot`, and the rest — and
fails if any becomes unreachable. Renaming one handler makes it fail, which is
mutation-tested. The section helpers count as reachable, since the pages call
them rather than inlining their markup.

The capability list kept **all** its detail. It was two screens tall inside a
seven-screen page; that is a reason to give it a page, not a reason to shorten
a disclosure that exists deliberately (HAX G1/G2) and is rendered from the same
list the code uses so it cannot drift.

Also guarded: the hub must stay a menu — a test fails if an `<input>`,
`<textarea>` or section heading reappears on it, which is how it would slide
back into being a long scroll. And the rows are divs with `role="button"`, so
Enter and Space are wired by hand and tested.

**v9.21 — Gordon is reachable from every screen.**

Logan: *"the ai chat being on every page."* It was on **5 of 28** — the five
top-level tabs. `setHeader` hid it whenever `view.sub` was set, and `openAsk()`
refused outright on a sub-screen. The reason recorded in the code was that a
sub-screen means mid-task and leaving would lose your place.

That objection was real; the fix was wrong. Leaving now **remembers exactly
where you were**: `openAsk()` captures `{tab, sub, data}` and `closeAsk()`
restores all three. `back()` could not do this — it drops to the top of a tab,
which would strand anyone who asked a question from a list or a half-filled
form. Choosing a tab from inside Ask clears the origin, because that is a
deliberate departure.

`renderEventEdit` builds its header by hand rather than through `setHeader`
(Back has to cancel the edit), so it got the button explicitly — otherwise it
would have been the one screen silently missing out.

**It stays a screen rather than becoming an overlay, and that is on evidence.**
The obvious reading of "on every page" is a slide-over panel. NN/g's study of
overlay dismissal on mobile found users "lose their work" when they pick the
wrong dismissal method, and their recommendation is to avoid "overlays entirely
when possible, preferring separate pages". The Ask screen holds a typed draft
and sometimes a pending confirm-this-action — precisely the work that an
accidental tap-outside destroys. So the research argued against what I was
about to build, and the real defect was never that it was a page: it was that
it was unreachable from 23 screens.

Verified in Chromium: all five tabs offer it; Edit Event offers it; opening
from a half-edited form and coming back leaves the edit intact ("Winter Recital
EDITED" still in the field); `listDetail` returns with its `data:{id}` payload;
the draft survives the round trip; Ask offers no button to itself; tapping a
tab clears the origin; and with AI off the button is gone everywhere. The a11y
audit covers the new button on all 28 screens.

**v9.20 — launches paint instantly, and a stale-JSONP bug went with it.**

Logan asked whether splitting the code across files, MVC-style, would shrink
`index.html`. It would not — same bytes, more requests, and it is the exact
change that blanked production in v8.1–v8.5. The source already IS split into
`js/` and `css/`; the single file is the delivery format.

Measured instead of guessed:

| | raw | gzipped |
|---|---|---|
| as shipped | 395,502 | **123,731** |
| comments stripped | 309,946 | 90,557 |
| full minify (terser) | 256,786 | 79,217 |
| split into files | 395,502 | 123,731 — **no saving at all** |

Confirmed against the live site: `Content-Encoding: gzip`, `Content-Length:
124848`. So the transfer really is ~124KB, and minifying would buy 45KB at the
cost of a build step and a readable shipped file.

**The real finding was in `sw.js`, not in the file size: it was NETWORK-FIRST.**
The whole 124KB transferred on every launch while online; the cache existed
only as an offline fallback. It now serves from cache and revalidates in the
background, which makes launch time independent of size — a bigger win than any
byte-shaving, and no build step.

Cache-first costs one launch of staleness, and that was the stated reason for
network-first, so it is not given away silently: the worker compares the new
body against the stored one and, only on a genuine change, messages the page,
which offers a one-tap **Reload** toast. Once per launch — a nag is worse than
a wait.

**A second bug fell out of reading it.** The old handler cached EVERY
same-method GET, including cross-origin ones. The Gmail watcher is **JSONP** —
executable JavaScript fetched with a `<script>` tag, so it is a GET. Under
cache-first the app would have replayed a stale email queue forever.
Network-first hid it. There is now an origin check, and the API and the local
model stop being cached too.

**Two mistakes worth recording, both found by testing behaviour rather than
reading code:**

1. `e.waitUntil()` was placed after an `await`, which puts it outside the event
   dispatch. The browser stops listening, the worker may die once
   `respondWith` settles, and the cache write never lands — so the app serves
   the same stale copy forever **and nothing reports a problem**. The browser
   test caught it; a code review would not have.
2. The first version of the guard test split on `'e.waitUntil('` and landed
   inside a *comment* mentioning it, making a correct implementation look
   broken. Comments are now stripped before the file is analysed. A guard that
   reads prose is not reading code.

The regression guard is that the fetch handler must not be `async` — with no
`async` there can be no top-level await, so the two cannot drift apart again.
Checking for the absence of `await` textually cannot work: the awaits inside
the `.then()` callback are legitimate and sit earlier in the file.

Verified in Chromium against a live server: SW activates; an unchanged file
reloads with no toast; a changed file paints the OLD build immediately, updates
the cache in the background and raises the toast; the offered reload delivers
the new build; and offline still boots.

**v9.19 — the app's primary job finally has a number.**

Reading a flyer is what FlyerSnap is FOR. The harness for measuring it has
existed since v9.6 and **had never once been run** — there is no
`eval/last-run.json` in the repo — for exactly the reason the routing benchmark
had no numbers either: the API key lives in the phone's browser storage, so the
desktop harness could never be pointed at the provider actually in use.

Settings → **"How well does it read paperwork?"** runs the 8 labelled cases
through whichever model is selected, scores them, and exports a file the
desktop reads with `node tools/eval-extraction.js --read <file>`.

- **`js/extract-score.js`** — moved from `eval/score.js`, same reasoning as
  v9.17's scorer move. `scoreCase`/`aggregate` became
  `scoreExtraction`/`aggregateExtraction`: `js/route-score.js` already owns
  those names, and every js/ module is inlined into ONE global scope. A private
  `norm` also had to become `blankToNull` — `js/intents.js` owns `norm`. Both
  collisions were caught by the guard test before they could shadow anything.
- **`js/extract-cases.js`** — GENERATED by `tools/build-extract-corpus.py`,
  with every `note` stripped.
- The two benchmarks **share the runner shell** — progress, cancel, export —
  and `benchState.kind` picks the scorer and the results screen. A test fails
  the build if `benchSummary()` stops branching on `kind`, because scoring a
  reading run with the routing scorer would produce confident nonsense.

**The screen leads with invented events, in red, above everything else.** An
event that was never in the paperwork is the worst thing this app can do: a
missed flyer gets noticed, an invented one quietly gets trusted. Precision,
recall and per-field accuracy come after.

**It measures the pipeline, not a clean-room copy of it** — `eventPrompt()`,
`GROUNDING_EVENTS` and the app's own `parseExtractedEvents()`. Calls are tagged
`bench.extract`.

Verified in a browser two ways, because a benchmark that only ever shows 100%
proves nothing: with a stub returning each case's own labels it scores 8/8 and
100% on every field; with a stub that drops one real event, corrupts a time and
invents a "Fun Run" it reports **43% precision, 46% recall, 7 missed, 8
invented, and `time` at 50%**. The export round-trips to the desktop reader.
Seeded with names appearing nowhere in the corpus ("Zylphinar", "Vorpalmart")
and confirmed absent from the file.

**Still worth saying: the 8 cases are synthetic seeds.** They cover the failure
modes the prompt was designed against; they are not real family paperwork. The
number this now produces is a regression signal, not a claim about real-world
accuracy. Ten real labelled flyers would be worth more than all of them.

**v9.18 — a duplicate-detection bug, found by removing a copy.**

`eval/score.js` carried its own `normTitle`, under a comment saying it was
"reused from the app's own duplicate matching so the two cannot diverge". It
was a copy, and it *had* diverged: the scorer handled titles made entirely of
stop-words and `js/matching.js` did not.

`normTitle` strips `the|a|an|of|for|to|at|on|in|our|your|please|note`. So
**"The Note" normalised to nothing, `titleSimilarity` returned 0, and
`looksDuplicate` reported two BYTE-IDENTICAL same-day events as not
duplicates** — the single thing that function exists to catch. Verified before
fixing, not assumed.

Now one implementation: `js/matching.js` exports `normTitle` and
`titleSimilarity`, the scorer imports them, and the stop-word case is handled
inside `titleSimilarity` by comparing raw text. `looksDuplicate` gets the fix
for free. Guarded by a regression test covering "The Note", "A", "Note" and
"the a of", plus the cases that must NOT collapse ("The Note" vs "A Note", two
untitled events, same title on different days). Mutation-tested — and the
mutation was caught by the *extraction scorer's* test, which is the
consolidation paying for itself immediately.

Also fixed: a second vacuous assertion, `assert.ok(!x === false || true)`, in
the duplicate-detection block. It could never fail. Replaced with the real
claim it was gesturing at ("Dinner" is contained in "Dinner Theater", so they
DO merge). That is the second one of these found; worth a grep for the pattern
if a third is suspected.

**Security work is ON HOLD** at Logan's request — he is building an admin
console for allowed users and a Firebase database, and the login design is
evolving. `SECURITY-PLAN.md` is marked accordingly, and
**ADMIN-CONSOLE-CONTRACT.md** is new: a walkthrough of what FlyerSnap stores,
what leaves the device, what it already logs and exports, and the constraints a
console must not break. Written so the console can be built against what the
app does rather than an assumption about it.

**v9.17 — the benchmark runs on the phone.** Logan's question: *"the
application has the key. can we use the application to run these and feed the
data back to you?"* Yes, and it is the only way this measurement can be honest
here. **The API key lives in the phone's browser storage, so a desktop Node
script cannot reach the provider actually in use** — and Logan runs his own
local model, so `ANTHROPIC_API_KEY` was never the right instruction.

Settings → **"How well does Gordon understand you?"** runs the 34 cases
through whichever model is selected, shows the results on screen, and exports
a file the desktop reads with `node tools/eval-router.js --read <file>`. The
report format is identical either way.

- **`js/route-score.js`** — moved from `eval/`. Everything in `js/` ships, and
  the rule is that tooling-only code stays out; that rule stopped applying the
  moment the app needed to score a run. One scorer, so the phone run and the
  terminal run cannot disagree.
- **`js/bench-cases.js`** — GENERATED by `tools/build-bench-corpus.py` from
  `eval/router-cases.json`, with every `why` stripped. Those reasons are for a
  person reading the repo and are most of the file; shipping them would put
  kilobytes of commentary into every download. A test fails the build if the
  two ever disagree — otherwise the two runs would be scored against different
  answers and neither number would mean anything.

**The property that matters most: the benchmark classifies and scores, and can
never act.** The corpus contains "Delete the dentist appointment". If the
runner ever reached `performRoute`, running a benchmark would offer to delete a
real event. A test greps the runner for `performRoute`, `pendingAction`,
`pendingEvents`, `choreForm`, `S.*.push`, `softDelete`, `completeChore` and
`markHandled` and fails on any of them. Verified in a browser too: a full run
leaves every collection byte-identical.

The export was checked the same way — seeded with names that appear nowhere in
the corpus ("Zylphinar", "Grumbleflop") and confirmed absent from the file.
It carries sentences and labels, which came from the repo, and nothing else.

Other details worth knowing:

- The run takes **the same path a typed sentence does**, `quickRoute`
  included. Measuring the model alone would measure something no user meets.
- It is offered for **both providers**. It measures routing, not local-model
  health, so hiding it inside the local-model branch (where the self-test
  lives) would have been wrong.
- Calls are tagged `bench.route`, so `tools/diagnostics.js` can tell them from
  real usage in its per-operation table. They do share the 200-entry AI log,
  so two runs will push out some real history — an accepted trade, since the
  latency and failures of a benchmark run against the local model are
  genuinely worth having in that log.
- It can be **stopped mid-run**. 34 calls against a local model is minutes,
  and a screen with no way out is not acceptable on a phone.
- Cost: `index.html` grew ~24KB (350 → 375). That is real, and it buys a
  quality tool that works on the device where the key actually is.

Found while building: the v9.15 audit-coverage guard failed the moment the new
screen existed, which is exactly what it is for. Both its states (mid-run and
results) are now audited.

**v9.16 — how good is the routing, actually?** v9.14 gave the assistant ten
intents that change data. Everything *around* them was tested exhaustively —
the parser is hostile, the validator drops wrong-typed values, nothing writes
without a yes — and none of that said whether "move the recital to the 12th"
reaches `edit_event`. Now there is a benchmark that does, in the same shape as
the extraction one.

- **`eval/router-cases.json`** — 34 labelled sentences across five buckets:
  `read` (must never write), `write`, `destructive`, `ambiguous` (the right
  answer is a refusal), and `injection`.
- **`eval/route-score.js`** — a deterministic grader. Anthropic's eval guidance
  is "deterministic graders where possible"; an intent id either matches or it
  does not, so there is no judge model here and no judge-model bias.
- **`tools/eval-router.js`** — three tiers. `--dry` self-checks the scorer,
  `--offline` runs the properties that need no model at all, and the default
  run makes one model call per case against the prompt that actually ships.

**Accuracy is not the headline number.** The failure modes are not symmetric,
so four safety counts are reported separately and must all be zero — no
average can hide them:

1. **destructive escalation** — a sentence that was not asking for a deletion
   routed to one. Nothing is deleted without a preview and a yes, so this is
   not data loss; it is the app *offering* to destroy something the user never
   mentioned, which is the most alarming thing it could do.
2. **write escalation** — a question routed to anything that changes data.
3. **invented parameters** — a date the sentence never stated, which is
   invisible in an intent-accuracy number and is the thing the router prompt
   forbids most explicitly.
4. **missed refusal** — something that should have come back `unknown`.

**The `--offline` tier runs inside `node tests.js`**, so those properties are
checked on every commit rather than only when someone remembers to spend
tokens: nothing short-circuits into a write, every expected intent actually
validates against the registry, every intent has at least one case, and no
safety bucket is empty.

**The defect the free tier found before a single token was spent.**
`quickRoute()` short-circuited *any* question-shaped sentence to
`ask_schedule` at 0.95 confidence — including "what's the capital of France?"
and "what is the weather on Saturday?", which went straight to the
calendar-answering prompt. Read-only, so nothing could be damaged, but the
designed failure mode never fired: an out-of-scope question is supposed to
reach the model router, come back `unknown`, and turn into a list of what the
assistant *can* do. Instead it reached a prompt with no business answering it,
and a confidently wrong answer is the thing this app exists to prevent.

The fix makes the optimisation **stricter, not smarter**: it now short-circuits
only when the sentence mentions something this app actually holds — its own
vocabulary, or one of Logan's people, lists or chores, which the caller passes
in. Returning null is always safe; it costs one round trip and the model
decides. A bare weekday deliberately does *not* count, or "the weather on
Saturday" would qualify. The honest limit is recorded in a test: "who won the
game last night?" contains *game*, which IS this app's vocabulary, so it still
passes the gate — the gate is a filter against clearly-external questions, not
a classifier for what is answerable.

**One case was relabelled rather than "fixed".** "Show me Braelyn's events" was
labelled `find_events`; `quickRoute` says `ask_schedule`. Both are read-only,
both answer the question, and two readers would not agree which is correct —
which by Anthropic's own criterion means the label was wrong, not the code. It
did surface something real, now its own case: **`find_events` is close to
unreachable**, because `quickRoute` has no branch for it and turns every
question-shaped retrieval into `ask_schedule`.

Three mutations tested: removing the topic gate, disabling the
destructive-escalation detector, and stripping a case's stated reason all fail
the suite.

**Not yet run against a model.** The default tier needs `ANTHROPIC_API_KEY`
and costs ~34 short calls. Run it before and after any change to the router
prompt or the intent registry, and commit `eval/router-last-run.json`.

**v9.15 — every screen is audited now.** This closes the gap flagged in v9.12
and it was not academic: the audit walked only the five top-level tabs, which
is precisely why the Edit Event review found two defects — chips that were
bare `<span onclick>`, and a screen with no `<h1>` at all — that the v9.1
accessibility pass should have caught and structurally could not.

Three things were wrong with the tool, not just its coverage:

1. **It only visited five screens.** It now visits **25**: the five tabs, every
   sub-screen in the app's `subs` map, and three states of the Ask screen
   (empty, pending confirm, "which one did you mean?"), each seeded with the
   state it needs to render something real.
2. **The seed data was nearly empty.** A screen with no rows renders an empty
   state, exposes no controls, and passes trivially — the least useful kind of
   green. Every collection is now populated, including a deliberate duplicate
   event so the Dedupe screen has something to show.
3. **A missing `<h1>` did not fail.** It was written to stderr and then ignored
   by the exit code, so the tool could print "no problems found" on a screen
   with no heading — the exact defect it existed to catch. Heading and
   `aria-current` counts now set the exit code.

The audit selector also grew beyond tag names to roles and `tabindex`, because
the v9.12 chips were focusable spans carrying `role="radio"` and a tag-name
selector could not see them. Added along the way: `aria-checked` presence on
anything claiming a checked state, radios that must sit inside a
`role="radiogroup"`, horizontal overflow (excluding genuinely scrolling
strips — the person filter bar is not a defect), and inputs whose only label
is a placeholder.

**The one real defect it found: the back chevron was a 24 × 39px tap target.**
The smallest control in the app, the primary escape route on seventeen
sub-screens, sitting in the corner hardest to reach one-handed. It is now a
full 44 × 44px box; negative margins absorb the extra height so the header bar
and the icon's position are unchanged (verified by measurement, not by eye:
icon x = 20px before and after). WCAG 2.5.8 sets 24px as the AA floor, so this
was not a failure — but Apple's HIG asks 44 and every other control in this
app already meets it.

Six guard tests, all mutation-tested: dropping a sub-screen from the audit
table, reverting the heading check to console-only, and reverting the back
button all fail the suite.

Worth knowing: `tools/a11y-audit.js` now exports its `SCREENS` table so
`node tests.js` can check it against the app's own `subs` map. It only runs
its browser when invoked directly (`require.main === module`) — importing a
module must never launch Chromium.

**v9.14 — Gordon can act.** Full written plan in **ASSISTANT-ACTIONS-PLAN.md**.

Logan's report was *"I should be able to have it add events, chores, etc."*
The surprise: **it already could, and had since v9.8.** Four defects made that
invisible or disappointing, and none of them was a missing feature:

1. The Ask screen's own intro said *"It cannot change anything on its own."*
2. `assistantCapabilityChips()` took the first four intents in registry order
   — four *questions*. None of the three add capabilities was ever advertised.
3. `add_event` declared a `person` parameter and then set `personIds: []`.
   `add_chore` did the same with `kidId`. The name was parsed and binned.
4. `add_event` hardcoded `kind:'event'`, so "permission slip due Friday"
   became an ordinary event — and only a *deadline* can be missed, so nothing
   ever warned about it.

NN/g's chatbot research is the diagnosis almost word for word: most in-app
bots "do a poor job of communicating what they can actually help with", and
**"the burden of figuring out what the bot can and can't do fell on the
user"**. Their prompt-control study names discoverability and education as the
first two jobs of suggestion chips. So `capabilityChips()` now guarantees one
example per consequence class — ask, draft, confirm, navigate — and a test
fails the build if the chips are all one kind again.

**Seven new intents**, all CONFIRM: `create_list`, `check_list_item`,
`complete_chore`, `mark_event_handled`, `edit_event`, `delete_event`,
`delete_chore`. Registry total is ten acting capabilities plus five reading
ones.

**The rules that make that safe, each with a guard test:**

- **`performRoute()` never writes.** It resolves and proposes;
  `confirmPendingAction()` is the only path in the app that turns an assistant
  sentence into a change. A test greps `performRoute` for `S.*.push`,
  `softDelete`, `completeChore` and `markHandled` and fails if any appear.
- **Resolution refuses rather than guesses.** `resolveEntity()` returns
  `ok | none | ambiguous`; two candidates means the user is asked which (HAX
  G10). Deleting the wrong "Recital" because two matched is the failure that
  must not happen.
- **Every write is undoable**, either through an explicit Undo toast or
  through the app's own `softDelete` / `markHandled` / `completeChore`. A test
  walks every `case` in `confirmPendingAction` and requires one or the other.
- **The assistant calls the app's own functions.** `completeChore` for a chore
  with an owner, `toggleChore` for one that belongs to nobody — the latter
  carries the "who did it?" sheet, and skipping it would drop the stars.
- **Undo removes items by id, not by text**, so undoing an assistant add
  cannot delete an identically-named item the user added themselves.

**The confirm button now says what it will do.** Apple's App Intents
confirmation API takes an `actionName` — "the name to use in the button that
confirms the action" — and every CONFIRM intent had been sharing one button
reading "Yes, do it". It is now "Add 3 items", "Create Costco", "Mark Bins
done", and for a `destructive` intent a red **"Delete Recital"** with the card
reading *"Nothing has been deleted yet. You will be able to undo it."*
`destructive` is a flag on the registry, not a fifth consequence class; the
closed set of four stays closed and stays tested.

**`js/ai-actions.js` gained a fourth RISK class, `confirm`.** That file exists
so the promise a user reads cannot drift from what the code does — and it had
drifted, still telling users the assistant "cannot ... change anything".
Widening the closed set was deliberate and required updating its test, which
is exactly the friction that class is designed to create.

Found in the browser rather than by a test: an older turn keeps `confirm:true`
forever, so a later pending action re-showed a finished action's buttons and
offered to redo it. The card now renders only on the newest turn.

One honest cost: `quickRoute`'s change-verb guard widened (`tick`, `mark`,
`done`, `did`, `move`, `rename`, `start`…), so a question like "what did
Olivia do today?" now takes the model round-trip instead of answering for
free. That is the correct side to err on, but it is a small speed regression
on a few phrasings.

**v9.13 — AI call logging.** Every AI call is now recorded, on both providers
and in both outcomes, and the record can be read on the desktop.

Field names follow the **OpenTelemetry GenAI semantic conventions** — the
vendor-neutral standard for instrumenting a model call — so the log means what
an engineer expects it to mean: `op` (`gen_ai.operation.name`), `provider`,
`reqModel`/`resModel`, `inTokens`/`outTokens`, `finish`, `ms`, `errorType`
(`error.type`). Those conventions deliberately exclude prompt and completion
bodies from standard attributes because they "routinely contain names, emails,
account numbers". That warning lands harder here than in most apps: in
FlyerSnap the prompts ARE children's names, schools, addresses and schedules.
**So no prompt text, no answer text, and never the API key** — `redact()` in
`js/ailog.js` is the last line of defence for error strings, which is the one
place a provider can hand back something sensitive without being asked.

- `js/ailog.js` — pure: `redact`, `classifyError`, `makeEntry`, `appendEntry`,
  `summarize`, `buildDiagnostics`. No DOM, no state, no clock of its own.
- Errors classify into a small stable set — `auth`, `rate_limit`,
  `provider_error`, `timeout`, `network`, `no_api_key`, `bad_response`,
  `unsupported_input`, `request_rejected`, `unknown` — because free-text
  provider messages vary and a class does not. That is what makes "how often
  does the local model time out?" answerable at all.
- `callAI(blocks, maxTokens, system, op)` gained an operation name; every one
  of its eleven call sites passes one (`extract.image`, `ask.route`,
  `email.attachment`, `compare.local`, …). A test fails the build if any site
  forgets, because an unnamed call logs as `unknown` and answers no question.
- Both transports are instrumented, in success and in failure, and the
  local→Anthropic fallback is recorded as its own line — that line is the
  answer to "why did this take three minutes". Turning the fallback OFF must
  not silently turn logging off with it; there is a test for that too.
- Rolling 200-entry cap. Logging is wrapped in try/catch: it must never break
  the thing it is logging about.

**Reading it on the desktop.** Settings → *When something goes wrong* shows a
one-line health summary and exports a diagnostics file. That file is
deliberately NOT the backup: it carries the AI log, the manual problem log and
version context, and **no events, chores, lists, notes or API key** — so it is
safe to email or AirDrop. Then:

```
node tools/diagnostics.js flyersnap-diagnostics-2026-08-22.json
node tools/diagnostics.js <file> --errors   # only the failures
node tools/diagnostics.js <file> --all      # every call, not just the last 40
node tools/diagnostics.js <file> --json     # machine-readable summary
```

It prints health, a per-operation breakdown (so "extraction is fine but Ask is
failing" reads differently from "everything is failing"), the call list with
redacted error detail, the manual reports, and a short *Worth checking* list.
That list is a shortlist, never a diagnosis — the file cannot see the network
it is describing.

Also in v9.13: `APP_VERSION` became a single constant read by both the footer
and the diagnostics file, so a bug report can never name a build that is not
the one that produced it. `tools/a11y-audit.js` takes an optional `PW_EXE`
env var for environments where Playwright's bundled Chromium is elsewhere.

**v9.12 — Edit Event rebuilt.** Full written review in **FORM-UI-REVIEW.md**,
measured against Baymard's mobile form testing, NN/g's form usability top 10
and cognitive-load principles, and the GOV.UK/Parliament design system. Ten
findings, all fixed:

The Date/Start/End row put three `flex:1` columns on a 393px screen — about
116px each — so "Start (optional)" wrapped, broke the alignment, and the End
field clipped. That is NN/g's side-by-side exception ("logically related SHORT
fields") misapplied, and Baymard's documented failure of a field too narrow to
show its own value. Date is now full width; Start and End share one row.

All-caps labels went (called out as an accessibility problem, and they were a
contributing cause of the row breaking). The Save button was clipped by the
tab bar with Cancel entirely off-screen — `main.isform` now reserves the
clearance. `alert()` validation became inline per-field errors with
`aria-invalid` and focus moved to the first bad field. Type and Who were bare
`<span onclick>` — invisible to keyboard and screen readers — and are now a
proper radiogroup and checkbox group. The screen had no `<h1>` at all. Notes
lost its duplicated inline styling. Provenance stopped masquerading as a field
label.

Eight guard tests were added, one per finding. Two notes for future work:
the a11y audit only walks the five top-level tabs, which is why F4 and F5
survived v9.1 — extending it to sub-screens is worth doing. And one guard
was written as an assertion that could never fail; it was caught and replaced,
which is the standard to hold.

**v9.11 — Ask screen UI pass.** The composer floated in the middle of the
screen and drifted as the conversation grew; it is now pinned directly above
the tab bar (measured nav height, 54px) the way every messaging UI does it,
with `main.hascomposer` reserving room so the last message never hides behind
it. The intro paragraph now shows only while the conversation is empty. Six
full-width suggestion buttons became four compact chips.

The busy state now NAMES what it is waiting on — "Asking claude-sonnet-4-6…"
or "Trying your local model (qwen3-vl:8b)…", plus a line warning that a
sleeping desktop has to time out first. Logan's complaint was "it took a long
time and then said the local model wasn't available"; the wait was explained
nowhere, which made it feel broken rather than slow (HAX G11).

**v9.10 — the assistant remembers.** The conversation now persists across
app launches, until "New chat" clears it. `js/conversation.js` holds the pure
logic; it is capped at 20 turns, drops malformed entries from the save file,
truncates long answers, and stores cited events by ID rather than freezing a
copy that would go stale when an event is edited.

The design decision worth knowing: **what is SHOWN and what is SENT are
deliberately different.** The whole saved conversation is displayed, but only
TODAY's turns — at most two — are ever sent to the model as context. Every
answer this assistant gives is date-relative ("this week", "in 2 days"), so
feeding yesterday's answer back in invites the model to repeat a claim that
has since become false, which is exactly the failure the whole app exists to
prevent. A conversation spanning midnight stays visible under an "Earlier"
divider, starts a fresh context, and tells the user so in one line.

**v9.9 — four fixes, three of them mine.**

*Dark ships by default*, with Dark / Light / Match my phone in Settings. The
bare `:root` is now the dark palette and light is the opt-in override;
resolution happens in JS because CSS cannot express "follow the phone only
when the user has not chosen". An inline script paints it before first render
so there is no flash. Both palettes still pass WCAG AA.

*The iOS 26 nav gap is actually fixed now.* The v8.7 `nav::after` cover never
worked — measuring Logan's screenshot showed 186 device px of page background
still below the tab bar. The strip sits OUTSIDE the layout viewport, where
nothing inside the page can paint; only the canvas does, and the canvas takes
its colour from `<html>`. So html is painted the nav colour and body is forced
to fill the viewport. This also fixes the light-mode version of the same gap.

*Warnings became actionable.* The clash banner could only be dismissed —
which trains you to bury problems, and directly contradicted the HAX G9
"support efficient correction" the plan cited. It now offers **Mark as
handled** and **Open it**. That also fixed a real bug: `findConflicts` checked
`e.done`, a field NOTHING in the app ever set. Dead code implying a concept
that did not exist. There is now a real `handled` field, set by the button and
undoable. Exporting to the calendar still counts, but it was a poor proxy on
its own — a form can be submitted in real life without ever being exported.

*The assistant got faster.* Routing added a full model round-trip in front of
every answer, so a simple question cost two sequential calls (three if the
local model timed out first). `quickRoute()` now classifies obvious questions
locally, for free — Anthropic's own guidance that high-frequency,
low-complexity work belongs in deterministic code. It only ever short-circuits
to read-only intents; anything that could change data still goes through the
model and every validation check, and a test asserts exactly that.

**v9.8 — a real assistant, not a chatbot.** Research-first again; see
**ASSISTANT-PLAN.md** for sources. The reframing insight: Apple App Intents
and Google App Actions show that the platform teams do NOT put a chatbot in
the app — they let the app DECLARE its capabilities as typed intents the
assistant invokes. And NN/g's usability evidence says why chat-first fails:
it "places the burden of discovering an app's capabilities upon the user",
trading recognition for recall.

So: `js/intents.js` is a capability registry (one intent per action, variants
via parameters, exposing only entities the user already sees). `js/router.js`
makes ONE model call that returns `{intent, params, confidence}` and stops —
Anthropic's routing workflow, not an agent, because their own criteria rule an
agent out here. Everything after that is tested code: validation, entity
resolution, confirmation, execution.

Every intent declares a consequence — `answer`, `navigate`, `draft`,
`confirm` — and there is no class that writes silently. Model output is
treated as hostile: unknown intents refused, wrong-typed values dropped rather
than coerced, invented parameters discarded, low confidence refused, and a
routing failure turned into capability disclosure. Ambiguity asks ("Storage
unit or Store?") instead of picking. 28 new tests including a loop over the
whole registry, so an intent added next year is covered the day it lands.

Two real bugs the verification caught, neither visible to a unit test: the
suggestion chips were dead (`runAsk` read the empty input box instead of the
tapped chip), and the chore draft called `newChoreForm()`, which takes no
arguments and RESETS the form — it would have thrown the draft away.

**v9.7 — AI across the app, on a researched footing.** Built research-first
from Microsoft's HAX guidelines, Google PAIR, Stanford HAI and IBM's
generative-AI principles; see **AI-INTEGRATION-PLAN.md** for the sources and
the reasoning.

The structural idea is a **capability registry** (`js/ai-actions.js`) where
every AI feature declares what it can do, what it cannot, its manual fallback,
and a **risk class**: `read`, `propose`, or `derive`. There is deliberately no
class meaning "writes on its own" — nothing an AI produces reaches the data
without the user accepting it, and the absence of that fourth class is
enforced by a test. Settings renders the can/cannot text from this same
registry, so what the user is promised cannot drift from what the code does.

Shipped with it: **Ask** (read-only questions over your own events — scoped in
code rather than by the model, because how much data leaves the device is a
privacy decision that should be auditable; every answer cites the events it
used, and the cited events render as real cards so the answer can be checked
in seconds). **Clash warnings** (`js/conflicts.js`) — overlapping events, a
crowded day, a deadline that slipped past — which are deliberately **not AI**:
overlap is arithmetic with one exact answer, so it is plain code that runs
offline, costs nothing and cannot hallucinate. And a **global off switch**:
with AI off, every model-backed surface disappears, the clash warnings remain
(they never used a model), and every manual path still works.

Wiring it surfaced a real collision — `js/ask.js` declared a helper called
`iso`, which the app already had. Because js/ modules are inlined into one
global scope, that silently shadows, the same shape as the old duplicate
`logProblem` bug. There is now a test that every js/ name appears exactly once
in the shipped script; it was mutation-tested by planting a collision.

**v9.6 — extraction benchmark.** `eval/cases.json` (labelled corpus),
`eval/score.js` (pure scorer, 12 tests) and `tools/eval-extraction.js` (runner
for either provider). Scoring refuses to credit a right title on the wrong
date, and reports hallucinations separately from precision — a missed flyer
gets noticed, an invented one gets trusted. The runner reads the SHIPPING
prompt from `js/prompts.js` so it cannot measure a stale copy. Not part of
`node tests.js`: it costs API tokens, so run it deliberately before and after
a prompt change. `--dry` self-checks the scorer for free.

Two things the work surfaced: a title made only of stop-words ("The Note")
normalised to nothing and could never match itself — fixed with a raw-string
fallback; and the drift test correctly rejected `js/score.js`, because
**everything in `js/` ships** and tooling belongs in `eval/` or `tools/`.
That rule is now written into the test.

**v9.5 — presentation prep.** `EXPERT-QA.md` written: anticipated panel
questions with fact-checked answers, every figure taken from the repo rather
than remembered. It deliberately states weaknesses as weaknesses (no
extraction accuracy benchmark, no multi-device sync, browser-held API key,
escaping-by-discipline, ~4,300 lines still in one scope, Chromium-verified
but WebKit-shipped), each with the reasoning and the mitigation — a stated
weakness cannot be knocked over. **All six UI-modernization phases are now
complete.**

## Recent work in detail (v8.7 – v9.3)

**v8.7 — the missing scan button.** Logan reported the manual scan button was
gone. It was not gone: `<main>`'s screen-entry animation included a
`transform`, and with `animation-fill-mode: both` the finished animation stays
applied forever. A filled transform — even the identity matrix `transform:none`
resolves to — makes `<main>` the containing block for `position:fixed`
descendants, so both floating buttons anchored to the CONTENT instead of the
viewport: mid-page overlap on Chores, pushed below 25 events on Events.
Reproduced in headless Chromium (button at y=280 where y=776 was expected).
The entry animation now fades opacity only. Guarded by the "Fixed-position
safety" test, which was mutation-tested against the old CSS.

Separately, the beige strip below the tab bar in Logan's screenshots is an
iOS 26 WebKit bug (the standalone layout viewport comes up short; fixed in
Safari 26.1, WebKit 158055568). `nav::after` paints the nav colour downward to
cover it; on a correct viewport that paints off-screen and is invisible.

**v8.8 — tokens and dark mode.** Every colour became a token in
`css/tokens.css`; a test forbids raw colours anywhere else. Dark mode follows
`prefers-color-scheme` with true dark surfaces (not an inversion) and dual
`theme-color` metas so iOS 26 tints its chrome correctly. The new contrast
test computes real WCAG ratios for every used pair in both themes and
immediately caught two failures that had been shipping: light `--faint` at
4.14:1 and the empty-checkbox border at 1.8:1. CSS moved into `css/` source
files synced by `tools/inline.js`, mirroring the `js/` pattern.

**v8.9 — icons.** Emoji chrome replaced by a 40-symbol inline SVG sprite
across ~65 call sites. `showSheet` gained an `icon:` field so sheet labels
stay `textContent` — data never becomes markup. Content emoji stay on
purpose: reward ⭐, celebration 🎉, and the 🦷 example inside the chore-title
placeholder (which invites users to use emoji in their own titles). Three
guards: referenced icons must exist, no unused symbols, no emoji in chrome —
the last caught four sites the manual sweep missed.

**v9.0 — components.** Shared `emptyState()` for every empty screen.
`confirm()` replaced by an undo toast on list/chore/reward delete via
`softDelete()`, which is safe only because those deletes were always soft
(`deleted=true`); it returns the undo handle so tests exercise the real path.
The render harness caught two icon bugs that no Node test could: `:only-child`
matched every labelled button icon (CSS ignores text-node siblings), and the
skillet glyph read as a coffee cup at 24px.

**v9.1 — accessibility.** `user-scalable=no` removed from the viewport — it
fails WCAG 2.2 SC 1.4.4 and an installed iOS web app *does* honour it, unlike
a Safari tab. Every input now has a real accessible name: 13 visible `.label`
divs became `<label for>`, the rest got `aria-label` (a placeholder is not a
label — it disappears on first keystroke). Active tab marked `aria-current`;
screen title is a real `<h1>` and empty-state titles are `<h2>`; landmarks
named; the toast is a polite live region so undo offers are announced; focus
moves to `<main>` on a genuine navigation. Eight source-level a11y tests plus
`tools/a11y-audit.js`, which audits the RENDERED DOM — and found a real
runtime gap the source tests could not: delete buttons whose only accessible
name lived on the `<svg>` inside. Names now sit on the buttons themselves.

## Verification before any deploy

- `node tests.js` — 475 tests. Data safety, migrations, inline-handler
  resolution, module/CSS drift, icon integrity, no-emoji-chrome,
  fixed-position safety, accessibility, WCAG contrast in both themes, and the
  self-contained-boot guard.
- `node tools/preview.js [outDir]` — screenshots every tab, light and dark.
- `node tools/a11y-audit.js` — all 25 screens in the real DOM: accessible
  names, tap targets, ARIA state, horizontal overflow, headings. `--only=<key>`
  for one screen while fixing it; `PW_EXE=` if Playwright's Chromium is
  elsewhere.
- `node tools/diagnostics.js <file>` — read a diagnostics export from the phone.
- **Settings → "How well does Gordon understand you?"** — the routing
  benchmark, run on the phone against the provider actually configured. This
  is the one to use: the API key is not on the desktop.
- **Settings → "How well does it read paperwork?"** — the extraction benchmark,
  run on the phone. `node tools/eval-extraction.js --read <file>` reads it.
- `node tools/eval-router.js --read <exported.json>` — read a run done on the
  phone. `--offline` runs the safety properties for free (also part of
  `node tests.js`); `--local <baseUrl> <model>` or `ANTHROPIC_API_KEY` run it
  from the terminal.
- `python3 tools/build-bench-corpus.py` — regenerate `js/bench-cases.js` after
  editing `eval/router-cases.json`. A test fails the build if you forget.
- `node tools/inline.js --check` — CSS source/inline drift.
- `bash tools/run-lighthouse.sh` — mobile Lighthouse scores.
- `python3 tools/build-app-icons.py` — regenerate every app icon from the
  brand tokens (re-run after a palette change).
- **Logan on the installed iPhone PWA.** Non-negotiable: the Node sandbox
  cannot see rendering, and Chromium is not WebKit. Every phase above was
  verified on-device before the next one started.

## Working with Logan's machine — read before touching git

The folder bridge can READ his repo but **cannot delete files**. Running any
git command through it leaves `.git/index.lock` behind and wedges the repo
until he removes the lock by hand. It has already cost him a blocked commit.
Ask him to run git himself and paste the output.

Give him **one PowerShell block he can copy and paste in a single go** — his
stated preference from v9.14. The earlier rule was one command per line,
because a pasted block can lose a newline and join two lines into nonsense
(`cd ...FlyerSnapgit push`), after which everything runs in the wrong
directory. That happened once, in the wrong repo. The single block keeps that
from recurring by opening with `Set-Location` and then a guard that `throw`s
if the shell is not in the FlyerSnap folder, and by gating the git commands on
`$LASTEXITCODE` from `node tests.js`. PowerShell 5.1 has no `&&`; use `if`.

## Traps — all of these have bitten before

1. **Never remove or replace a feature without asking.** Add alongside.
2. **Never guess.** Verify in the repo, a browser, or research first.
3. `grep` for a function name before writing one (duplicate `logProblem`).
4. No `transform`/`perspective`/`filter` on ancestors of `.fab` (v8.6).
5. No real ES module imports — or ANY fetched subresource — in the shipped
   file (v8.1–v8.5 blank screen). Enforced by tests; do not delete them.
6. PowerShell 5.1: no `2>&1` from a native command under `$ErrorActionPreference
   = "Stop"` — one stderr line from a PASSING test aborts the script.
7. Bump `sw.js` `CACHE` every release or phones serve the old app.
8. iOS PWAs cannot open new tabs (use downloads), have storage separate from
   Safari, and honour viewport flags a browser tab ignores.

## Pending / open items

- **Snacks & dessert meal slots** — FlyerSnap accepts them; blocked on the
  separate recipe app publishing them (`RECIPE-APP-SNACK-DESSERT-REQUEST.md`).
- **`state.js` extraction** — blocked on a real constraint: `S` is reassigned
  and ES import bindings are read-only. The three options are documented in
  CLAUDE.md. No urgency; the dangerous logic (`migrate`) is already isolated.
- **Logan's iOS version** — unconfirmed. If it is 26.0, updating may remove
  the bottom-gap symptom the `nav::after` cover works around.
- **Feed the benchmark corpus with REAL flyers.** *(Now more valuable than
  ever: v9.19 made the corpus runnable on the phone, so real cases would
  immediately produce a real number.)* `eval/cases.json` ships
  eight synthetic seed cases covering known failure modes. The harness is
  done; what it needs is real paperwork, labelled by hand. Ten real cases
  beat fifty invented ones. Strip surnames, addresses and phone numbers —
  the file is in a public repo.
- **Multi-device sync** — today it is one phone, one copy, manual backups.
- **A shared login page from the admin console** (Logan, v9.21). Parked with the
  rest of the security work; see SECURITY-PLAN.md §3.2 for the constraint that
  decides its shape — on an installed iOS PWA, magic link, popup and
  `signInWithRedirect` are all unavailable, so email + password is the method
  that works. Whatever the console ships must survive that.
