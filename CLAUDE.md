# CLAUDE.md — read this before touching anything

> Companion doc: **HANDOFF.md** — current state of play, recent work and
> open items. This file is the architecture and the rules.

FlyerSnap: family-organization PWA for Logan. Scans flyers/PDFs/emails → AI
extracts events → calendar reminders. Plus chores/stars, lists, read-only meal
plan (fed by a separate recipe app), Gmail watcher, and AI.

**THE AI IS GORDON — LOGAN'S OWN MODEL — AND ANTHROPIC IS THE FALLBACK.**
Decided 23 Aug 2026. The self-hosted Ollama model on Logan's desktop is the
intended primary provider; Anthropic covers the gap when that desktop is asleep
or unreachable, automatically (`S.settings.aiFallback`, on by default). Both
paths stay — a scan must never simply fail because a machine at home went to
sleep — but **the default direction of travel is local, and new work should not
add Anthropic-first assumptions.**

**`aiProvider()` LOOKS LIKE IT SAYS THE OPPOSITE. IT DOES NOT.** The expression
reads `S.settings.aiProvider === 'local' ? 'local' : 'anthropic'`, and it is
easy to read that as Anthropic-by-default. The stored value is `'local'` by
default — `blank()` sets it, and the one-time `from < 5` migration moved every
existing install onto it. Measured 3 Sep 2026 in a real browser: a fresh install
and an old save with no setting both come up **local**; an explicit
`aiProvider:'anthropic'` on a current-schema save **sticks**. This trap has
already cost one wrong statement to Logan and one wrong "correction" written
into EMAIL-AUTOREAD-PLAN section 0. **Reading an expression is not measuring a
default** — boot the app and print the value.

Two things this does NOT mean, both easy to get wrong:

- **"Gordon" is not a provider.** `aiName()` returns `ASSISTANT_NAME`; it is
  the assistant's display name whichever model answers, and it has been since
  v9.7. Code and docs must keep saying *which model* — the real name shows in
  Settings and in each event's `aiSource`, and that honesty is the point.
- **Anthropic is not deprecated.** It is the reason the app works at 11pm with
  the desktop off. Removing it is a feature removal (rule 1) and was explicitly
  rejected on 23 Aug.

**WHERE THIS IS HEADING (23 Aug 2026): Gordon SHIPS WITH THE APP, behind a
login that gates GORDON — not the app.** The local model stops being something
each user points at and becomes something the app comes with, so that not just
anyone can spend Logan's GPU. **The app itself still opens for anyone who has
it**: events, chores, lists and hand-typed events (v9.28) work with no account
and no network. Sign-in unlocks scanning and Ask.

That scope was chosen on the kid question — children need to SEE their
schedule, not to scan; a hard gate would show a login form to a child standing
outside school. Full reasoning in SECURITY-PLAN.md §1a. Three consequences bind
anyone working here before it lands:

- **`Authorization: 'Bearer local'` is a hardcoded constant** (`index.html:4064`,
  `:4112`, `:8334`), identical in every copy. It is safe only because
  `localBaseUrl` is a private Tailscale address — the URL's secrecy IS the
  security. Publishing that URL with the app makes the constant worthless.
  **Anything built toward shipped-Gordon replaces it.**
- **The gate is on a SESSION, never on Firebase being reachable.** The SDK
  cannot be inlined without a build step, so gating on "can I reach Firebase"
  reproduces the v8.1–v8.5 blank screen. The check is a `localStorage` read
  answered offline; the SDK is fetched only for the sign-in itself. Boot still
  fetches nothing. See SECURITY-PLAN.md §1a.
- **KIDS SEEING THEIR EVENTS IS A SYNC PROBLEM, NOT A LOGIN PROBLEM.** There is
  no sync — every install is an island of `localStorage`, so a child who
  installs the app gets an empty one. What works TODAY is Share Events
  (`index.html:6374`): tick events, send a calendar file. The per-person
  machinery for a future read-only sync already exists (`personIds`,
  `eventFilter` at `:3560-3562`); the missing piece is sync. If it is ever
  built, **kids are read-only** — otherwise every child on the allowlist can
  spend the GPU the login exists to protect.

`S.settings.aiProvider` still DEFAULTS to `'anthropic'` for a fresh install,
because `localBaseUrl` defaults to empty and a default of `'local'` with no URL
would give a new install nothing but "No local model URL saved." Flipping that
default is a real change with a worse first-run, not a one-line edit — see
HANDOFF.md.

**Live:** https://lfaley.github.io/FlyerScannerAndScheduler/ (GitHub Pages, deploys on push to main)
**Local repo:** `C:\Users\Logan\Desktop\Repos\FlyerSnap` (moved here Aug 2026 — older docs may name `FlyerAndScheduler\flyersnap-pwa`; that path is dead)
**Current version:** v9.83 · **Tests:** 800 passing (`node tests.js`)

## Architecture — source-modular, delivery-single-file. This is deliberate.

The shipped `index.html` is a **build artifact**: one self-contained file with
all CSS and JS inlined. Real `<script type="module">` imports **broke the
installed iOS PWA in production** (v8.1–v8.5): a failed import kills the whole
script silently — blank screen, no error. Emergency-reverted in v8.6. Do NOT
reintroduce module loading into the shipped file without genuine on-device PWA
verification (the Node sandbox faked imports and gave false confidence).

Source of truth lives in small files; the inlined copies in index.html are
synced copies, and **tests fail the build if they drift**:

- `js/format.js`, `js/matching.js`, `js/prompts.js`, `js/migrate.js`,
  `js/icons.js`, `js/conflicts.js`, `js/intents.js`, `js/router.js`,
  `js/assistant-actions.js`, `js/ai-actions.js`, `js/conversation.js`,
  `js/theme.js`, `js/ailog.js`, `js/errorReport.js`, `js/local-limits.js` —
  pure logic modules,
  individually tested. Inlined by hand
  into index.html's script (guard: "the inlined copies match js/ exactly").
- `css/tokens.css` (all design tokens, light + dark), `css/components.css` —
  synced into index.html's `<style>` by `node tools/inline.js`
  (guard: "the inlined <style> matches css/ exactly"). Edit the css/ files,
  never the inlined copy.
- `state.js` is NOT extracted, and this is a real constraint, not laziness:
  `S` is *reassigned* (`let S = load()`, `S = Object.assign(blank(), parsed)`
  on restore), while ES import bindings are read-only — an importing module
  cannot reassign one, so `state.js` cannot simply `export let S`. Three ways
  out, if it ever stops being comfortable:
    1. Export a container — `export const store = { S: null }`, everything
       reads `store.S`. Mechanical, ~400 sites, no behaviour change.
    2. Accessors — `getState()` / `replaceState()`. Cleaner, bigger diff.
    3. Leave `S` in the shell; `state.js` exports only pure helpers.
  Current choice is (3), and there is no urgency: the dangerous logic
  (`migrate`) is already isolated and tested on its own.

Why not rewrite this object-oriented? Classes would not have prevented the
bug that prompted the question (a duplicate `logProblem`, second definition
silently winning). Two classes in one file collide identically — the failure
was one global *namespace*, not a missing object model. State is also
deliberately plain JSON because it is persisted, migrated and snapshotted;
wrapping it in class instances would add a serialization problem the app does
not currently have.

Everything else (rendering, state, handlers) still lives in index.html's
script; extracting more of it via `tools/extract.js` (string-aware, tested by
tests-refactor.js's six oracles) into js/ is welcome — but the result must be
INLINED, never linked. `tools/extract.js` writes to `js/` only; it must never
be wired to emit real imports into the shipped file.

(The old ARCHITECTURE-PLAN.md was deleted in v9.2. It predated the v8.1–v8.5
incident and recommended shipping `<script type="module" src="js/app.js">` —
exactly the change that blanked the app. Its surviving conclusions are above;
the full text is in git history if it is ever wanted.)

## THE WORKING SEQUENCE — follow this order, always

**Research → Plan → Scaffold → Code → Verify.** Not one of these steps is
optional, and they do not get reordered.

1. **Research.** Read primary sources — the actual spec, the actual docs, the
   actual published guidance — and quote them. Recalled best practice is
   guessing wearing a hat. Every production incident in this repo traces back
   to acting on an assumption that a five-minute check would have killed.
2. **Plan.** Write it down before writing code: what is being built, why, what
   is deliberately NOT being built, and what could go wrong. Plans live as
   `*-PLAN.md` in the repo.
3. **Scaffold.** Structure first — the module boundaries, the data shapes, the
   registry, the seams a test can reach. Get this reviewed by reality (a test,
   a browser) before filling it in.
4. **Code.** Implement into the scaffold.
5. **Verify.** Tests, then the browser harnesses, then Logan on the installed
   PWA. A guard that has never been proven to fail is decoration — mutation-test
   the important ones by reintroducing the bug and watching them catch it.

If a step feels skippable because the task is small, it is still not skippable.
Say what was researched and what was verified; do not assert a cause without
having checked it.

## Rules that exist because something burned

1. **Never remove/replace a feature without asking Logan.** Add alongside.
2. **Never guess — verify in the repo, a browser, or research before asserting.**
3. `grep` for a function name before writing it (duplicate `logProblem` incident).
4. **Never ship a file that must FETCH something to boot.** No
   `<script type="module">`, no `<script src>`, no `<link rel=stylesheet>`,
   no `import`/`export` in index.html's script. This is the v8.1–v8.5
   blank-screen incident, and three tests under "Shipped file boots with no
   subresources" now fail the build on it. If real modules are ever wanted
   again, they need verification on an actual installed PWA first — the Node
   sandbox faked imports and gave false confidence. Do not delete the guard
   to make it pass.
5. Nothing outside `:root`/dark block may name a raw color — the contrast test
   enforces AA in both themes and a no-raw-colors sweep (kid palette + webkit
   tap-highlights excepted).
6. No `transform`/`perspective`/`filter` (even animated-then-filled) on
   ancestors of `.fab` — `position:fixed` descendants lose the viewport as
   containing block. Shipped as the v8.6 "missing scan button" bug; test
   "Fixed-position safety" guards it.
7. **NEVER run git through the folder bridge** (`device_bash` on the mounted
   repo). The bridge cannot delete files, so any git command that takes
   `.git/index.lock` leaves it behind and WEDGES the repo — Logan then cannot
   commit until he deletes the lock by hand. This actually happened: a
   diagnostic `git status` blocked his v9.7 commit. Reading files through the
   bridge is fine; running git is not. Ask Logan to run git in his own
   PowerShell and paste the output.
8. **Act on a warning the moment it appears.** That same command printed
   "unable to unlink index.lock: Operation not permitted" and it was noted in
   passing rather than fixed. A warning in tool output is a finding.
9. **Hand Logan ONE PowerShell block he can copy and paste in a single go.**
   His standing preference, stated in v9.14. The block must open with
   `Set-Location <absolute path>` followed by a location guard that `throw`s if
   the shell is not where it should be — a pasted block can lose a newline and
   silently join two lines (`cd ...FlyerSnapgit push`), after which everything
   runs in whatever directory the shell was already in, which once meant the
   wrong repo entirely. The guard turns that into an immediate stop instead of
   a mystery. Gate the git commands on `$LASTEXITCODE` from `node tests.js`, so
   a failing suite cannot be committed by a paste that ran past it. No `&&` —
   PowerShell 5.1 does not have it.
10. PowerShell 5.1: never `2>&1` a native command under `$ErrorActionPreference
   = "Stop"` — deploy.ps1 uses Start-Process file redirection instead.
11. iOS PWA quirks: no new tabs from installed apps (use downloads), separate
   storage from Safari, service worker cache list needs manual bumping
   (`sw.js` `CACHE` const — bump every release; since v9.20 the worker is
   CACHE-FIRST, so in `sw.js` the network request and `e.waitUntil()` must both
   start SYNCHRONOUSLY in the fetch handler — `waitUntil` after an `await` is
   outside the dispatch and silently does nothing, leaving the app permanently
   stale with no error anywhere. The handler must never be `async`.), and the iOS 26 short-viewport
   bug (nav::after paints white below the nav on purpose).
12. iOS filters the SHARE SHEET BY FILE TYPE. A `File` typed
   `application/json` is offered to almost nothing — Gmail among the apps that
   never declare it — and the sheet looks broken rather than picky (v9.24:
   "the export only has Outlook as an option"). Ship anything meant to be
   emailed as `text/plain` with a `.txt` name; the bytes are unchanged and
   `tools/diagnostics.js` parses by content, never extension. Always offer a
   **Copy** route as well: a share sheet that will not list the user's mail app
   must not be the only way out.
13. WORDING OF FALLBACK MESSAGES IS A CORRECTNESS PROBLEM. "Local model
   unavailable — using Anthropic" produced a bug report saying Anthropic could
   not be reached, on runs where Anthropic answered every time. Lead with the
   outcome, name the thing that failed second, and never put a working
   provider's name next to the word that describes the failure.
14. THE LOCAL MODEL'S CONTEXT WINDOW IS NOT OURS TO SET, so the app measures
   it instead (`js/local-limits.js`, v9.25). Ollama defaults to **4096 tokens**
   on any machine with under 24 GiB of VRAM, a flyer prompt measures ~2,300,
   and this app asks for up to 4,000 of answer — so the request was nearly
   double the window and could not have succeeded from any model. Ollama's own
   OpenAI-compatibility docs say *"the OpenAI API does not have a way of
   setting context size"*, so `num_ctx` must never be sent on `/v1`; detect via
   `/api/ps`, clamp the ask to what is left, and name `OLLAMA_CONTEXT_LENGTH`
   in the message. **A detection failure must always read as "unknown" and
   change nothing** — a probe that can ground a working call is worse than no
   probe.
15. ON `/v1/chat/completions`, THINKING IS DISABLED BY `reasoning_effort`,
   NOT BY `think`. `think` is a native `/api/chat` field and is absent from
   Ollama's supported-field list for the OpenAI endpoint, so it was silently
   ignored on every call this app ever made — which is why a thinking model
   kept thinking with `think:false` sitting in the request. Keep sending
   `think` and `chat_template_kwargs` for native proxies; they are free.
16. A BENCHMARK THAT CRIES WOLF GETS IGNORED. The router scorer compared
   entity names with string equality while the app resolves them by
   containment (`resolveEntity`), so "the bins" for a chore called "Bins"
   scored as a failure. Seven of eight parameter failures in Logan's first q8
   run were the scorer, not the model — 56% reported where 76% was true. Score
   a parameter the way the app CONSUMES it, and prove the loosened rule can
   still fail (`namesSameThing` rejects a value that is the whole sentence).
17. A REFUSAL MUST SAY WHY. `validateRoute` rejects for four distinct
   reasons and they need four distinct fixes; `unknown` alone cannot tell them
   apart. `scoreCase` carries `why`, `summarise` groups it as
   `byRefusalReason`, and both the export and the results screen show it.
18. DEPLOY WITH `.\deploy.ps1 "what changed"`, not by hand. It gates on the
   tests, refuses a push where `index.html` changed without `APP_VERSION`
   moving or `APP_VERSION` moved without `sw.js` `CACHE` moving, stops for
   `gmail-watcher.gs`, and polls the live URL afterwards — a green push is not
   a deploy. `-DryRun` checks everything and pushes nothing. Written for
   PowerShell **5.1**; guard tests forbid `&&`, `Invoke-WebRequest`, and
   `$ErrorActionPreference = "Stop"` in it, because none of those fail on the
   7.x that a test run would use.
19. AN AGENT'S WORKING COPY IS NOT THE REPO. v9.25 was built on a copy that
   predated `dd75b80`, so its `index.html` had no inlined `errorReport.js` and
   writing it over the repo would have silently removed a shipping feature.
   Before dropping files in, diff against `HEAD`: **a file missing from the
   copy looks exactly like a file that was deleted on purpose.** The drift and
   collision guards caught this one — do not weaken them, and never "fix" them
   by deleting the js/ file they are complaining about.
20. ONE AGENT AT A TIME PER REPO. On 23 Aug two sessions wrote to this folder
   within minutes; each overwrote the other's `index.html`, producing a deploy
   that passed at 529 tests and then failed at 486 with no edit in between.
   Two commits both called themselves v9.25. Recovery worked only because
   **`js/` is the source of truth and `index.html` is a build artifact**: merge
   at the `js/` layer and re-inline, never pick one `index.html` over another.
   A second session must re-read from disk immediately before writing.
21. A GUARD THAT READS THE WORDS NEXT TO THE LOGIC IS NOT READING THE LOGIC.
   The first version of the stale-build test asserted `LastWriteTimeUtc` and
   `git log --format=%cI` were present — and passed with the comparison itself
   replaced by `if ($false)`. Text guards on files the suite cannot execute
   (`deploy.ps1`) must pin the OPERATIVE EXPRESSION, and every one of them must
   be mutation-tested. Third time this project has shipped a guard that read
   prose or vocabulary instead of code.
22. EVERY OBJECT THE APP OWNS NEEDS A PATH THAT DOES NOT GO THROUGH THE AI.
   Until v9.28, `S.events.push` existed at exactly one site — the review flow
   for AI-extracted events — so with no API key a new user could not create an
   event by scanning, by asking Gordon, or by typing. Chores and lists always
   had hand-entry; events did not, and nobody noticed because every developer
   test starts with a key. When adding a create path, check the other two ways
   in still work with `aiEnabled()` false and no key.
23. A NEW SETTINGS CONTROL MUST BE ADDED TO `mustSurvive` THE DAY IT SHIPS.
   That list is an ALLOWLIST — adding a control never breaks it — so a control
   left out gets **no** protection from the one test that exists to stop
   controls vanishing in a reorganisation. Registering it is itself a guard, so
   mutation-test the registration.
24. Run `node tests.js` before every deploy; add a regression test with every
   bug fix; document every fix the turn it ships.
25. AN ANALYSIS RESULT IS NOT EVIDENCE UNTIL IT HAS REPRODUCED SOMETHING
   ALREADY KNOWN TO BE TRUE. The Aug 2026 code review wrote nine analysis
   tools; **all nine were wrong on their first run** -- reading comments as
   code, matching after a dot, brace-matching through template literals, a
   `\b` that can never match after `[]`, an index mixed up between absolute
   and relative. Two of those would have published false findings and one
   would have DELETED two confirmed ones. The only reason they did not is
   that each tool was pointed at a fact already established by hand before
   its other output was believed. This generalises rule 21: it is not just
   guards that read prose instead of code, it is the things you write to
   check the guards. Validate the instrument on a known answer first.
26. DISMISS IS AS PERMANENT AS DELETE HERE, AND WEARS NONE OF ITS MANNERS.
   Delete is red, confirms or offers undo, and says what goes. Dismiss --
   `dismissConflict`, `dismissGroup` -- writes a suppression that NOTHING in
   the app can ever clear (`dismissedConflicts`, `notDuplicates`), from a
   control that is not red, does not confirm, offers no undo, and in one case
   is an unlabelled x. Logan asked "how am I supposed to dismiss one of
   these?" on 26 Aug and the answer was that he already could, from two
   different controls, neither of which said "dismiss". Any new suppression
   needs a way back, a visible name, and the same warning weight as a delete.
27. A CONSTANT SHARED WITH `gmail-watcher.gs` HAS NO IMPORT PATH -- PIN IT IN A
   TEST. The watcher is pasted by hand at script.google.com and does not
   deploy with the push, so the two surfaces drift silently and for weeks.
   That is exactly what the 24 Aug queue-shape bug was, and it swallowed every
   email. The Anthropic model, API version, endpoint and the `unauthorized`
   error string are now pinned by a test that reads both files.
28. THE INSTRUMENT YOU REACH FOR WHEN SOMETHING IS WRONG MUST NOT BE THE THING
   THAT IS WRONG. Three independent instances in one review:
   `compareProviders` persisting `aiFallback:false` for the length of two model
   calls; `mealPlanDiagnostic` reading a raw key literal instead of
   `MEALPLAN_KEY`, so a rename would make the "why no meals?" tool report
   nothing while the app read correctly; and `downloadQuarantine` building the
   rescue file inside an empty catch, so a partial dump downloads silently at
   the one moment the data is already in trouble. Diagnostics, comparisons and
   recovery paths get MORE care than features, not less.

29. AN EMPTY COLLECTION IS TRUTHY, AND A QUESTION WITH NO ANSWERS IS NOT A
   QUESTION. `askWhich('lists', liveLists())` with no lists rendered "Which one
   did you mean?", zero buttons and a "Neither" link -- because `[]` passed the
   `t.choices &&` gate. The same shape shipped twice more: a clash banner whose
   only "choice" was to destroy three events, and a notes filter bar drawn over
   an empty vocabulary. Before rendering a chooser, check `.length`, not
   truthiness, and have a sentence ready for the case where there is nothing to
   choose between.
30. A GUARD THAT PASSES FOR THE WRONG REASON IS WORSE THAN NO GUARD, AND YOU
   ONLY FIND OUT BY MUTATING IT. Four times in this stretch: a key-pinning test
   that passed because `removeFromClash` filters by membership anyway, so
   deleting the pin killed nothing; a `clarifyChoices` test that called the
   helper directly and never checked the app used it, so reverting the call
   site was invisible; a `deploy.ps1` guard that matched its own comment
   ("clasp pushes a DIRECTORY") rather than the call; and a probe whose "no
   AbortController" setup failure read as the finding it was aimed at. EVERY
   new guard gets its mutation run, and the mutation must be a real revert of
   the fix -- not a variant that happens to trip something else.
31. ASYNC TESTS INTERLEAVE WITH SYNC ONES, SO NOTHING GLOBAL SURVIVES AN
   `await`. The harness registers async tests in `pendingTests` and carries on
   running the sync ones, so `boot(null)` in a later test replaces `S` while an
   earlier async test is suspended. A probe that set `S.settings.localModel`,
   awaited, and read it back got the DEFAULT and "failed" for a reason that had
   nothing to do with the app. Two consequences: write tests that read no
   global state after an await, and treat "the value is the default" in an
   async test as a harness question before it is a product one. The app fix
   that fell out of this is real and general -- `probeLocalContext` now reads
   its inputs once, up front, because the user can change the settings while a
   request is in flight.
32. `Test-Path` FINDS HIDDEN FILES; `Get-Item` WITHOUT `-Force` DOES NOT. The
   freshness gate in `deploy.ps1` guarded with `Test-Path` and then called
   `Get-Item`, which returned nothing for Visual Studio's hidden `.wsuo` -- and
   the next line called a method on that null. It ran on Logan's machine, not
   here, and broke his only deploy path. Any `deploy.ps1` change is parse-
   checked with `[Parser]::ParseFile` AND exercised on its failure paths with
   stubs, because the container has no Windows and "it looks right" has already
   been wrong.
33. WHAT DOES NOT SHIP WITH THE PUSH IS WHERE THE ROT SETS IN. `gmail-watcher.gs`
   deploys by hand (rule 27), and rule 27 was not enough: on 29 Aug Logan asked
   "i thought we automated pushing the watcher code???" and the honest answer
   was that only the DETECTION was automated. Step 5 of `deploy.ps1` now really
   deploys it via clasp, and every trap on the way there was a silent one --
   pushing under the wrong filename would duplicate every function, pushing a
   hand-written manifest would rewrite the project's OAuth scopes, and
   `clasp deploy` without `-i` mints a NEW /exec URL while the app keeps
   calling the old one. A deployment that can half-succeed must verify itself
   afterwards and fall back to the manual step, never continue on the
   assumption that it worked.

## Verification tooling

**One-time setup.** `tests.js` needs nothing but Node. `tools/a11y-audit.js`
and `tools/preview.js` drive a real browser, so they need Playwright and its
Chromium, installed once per machine from the repo root:
`npm install` then `npx playwright install chromium`. Both are devDependencies
in `package.json`; the app itself still has no dependencies and no build step
(rule 4), and `node_modules/` is gitignored, so a fresh clone that skips this
gets `Cannot find module 'playwright'` from those two tools and nothing else.
`npm test`, `npm run audit` and `npm run preview` are aliases for the three
commands below.

- `node tests.js` — 933 tests: data safety, migrations, inline-handler
  resolution, module drift, CSS drift, icon-sprite integrity, no-emoji-chrome,
  fixed-position safety, accessibility, WCAG contrast in both themes,
  and the self-contained-boot guard.
- `node tools/a11y-audit.js` — ALL 52 entries in its `SCREENS` table, in the
  RENDERED DOM: accessible names, tap targets, ARIA state, horizontal
  overflow, **whether anything is sitting on top of a control** (v10.1), and
  exactly one `<h1>`.
  **IT CANNOT TELL YOU A SCREEN IS REACHABLE.** It opens each one by setting
  `view` directly — which is what lets it audit them at all, and exactly why it
  is blind to a screen nothing navigates to. That has now happened twice: the
  local-model self-test (fixed v10.8) and the Emails screen (v10.9, orphaned
  the same day it was written, caught in v10.10). `tests-modules.js` now fails
  the build on any sub-screen whose name appears nowhere but its own
  registration.
  The source tests cannot see a name that computes to nothing at runtime;
  this found exactly that in v9.1, and a 24px back button in v9.15.
  `--only=<key>` for one screen. **Adding a sub-screen means adding it to the
  `SCREENS` table in that file** — a test fails the build otherwise, because
  a screen nobody audits is how the v9.12 defects survived v9.1.
- `node tools/browser-check.js` — BEHAVIOUR in a real browser: real keystrokes,
  real clicks on inline `onclick` handlers, real localStorage read back after
  the tap. **This is the only harness that can see what `tests.js` cannot.** The
  vm sandbox's `getElementById` returns a fresh stub per call, so an input's
  value is unreadable there and an inline handler is never dispatched. Proved on
  31 Aug: a build with the events-search `value=` attribute deleted reported
  **851 passed, 0 failed** from `tests.js` and three failures here — and this
  harness found the live `#newItem` draft-wipe on its first honest run. It is
  also SEVEN TIMES FASTER than the vm suite (8s vs 60s), so there is no reason
  not to run it. Not wired into `deploy.ps1`: it needs Playwright, and the
  deploy gate must work on a machine that has not run `npm install`.
  **v10.1: this harness found a bug three other checks could not.** The nav was
  `z-index:30` against the sheet's 20 and its overlay's 15, so the nav sat ON TOP
  of every sheet in the app — the last button of each one (`Cancel`,
  `Remove event`, `Delete N events`) was unreachable, and a tap there switched
  tabs and left the sheet floating over another screen. Source reading cannot see
  it (three rules in three places; the bug is the relationship). The a11y audit
  does not cover it — **it renders the 48 SCREENS, and a sheet is not a screen.**
  The vm harness has no layout at all. If a control's problem is *where it is*,
  only this harness can tell you.
  28 checks as of v10.10. Two of them exist because the vm harness structurally
  cannot reach the code: `saveEventEdit` opens with `syncEventForm()`, which
  re-reads the live inputs (every stub reports `value:''`), and the assistant's
  second "which one did you mean?" is pushed from inside `confirmPendingAction`
  and only wired to an id when `pendingAction` is set.
- `node tools/preview.js [outDir]` — Playwright-Chromium screenshots of every
  tab, light AND dark, seeded demo data. Review design changes here first;
  it would have caught the v8.6 button bug. NOT a Safari substitute — Logan
  verifies on the installed PWA before each release is called done.
- `node tools/inline.js --check` — CSS source/inline drift check (also a test).
- `node tools/eval-extraction.js` — extraction accuracy against the labelled
  corpus in `eval/`. Costs API tokens, so it is NOT in `node tests.js`; run it
  before and after any prompt change and commit `eval/last-run.json`.
  `--dry` self-checks the scorer for free.
- **Settings → "How well does Gordon understand you?"** — the routing
  benchmark run IN THE APP (v9.17). The API key lives in the phone's browser
  storage, so a desktop script cannot reach the provider actually in use; this
  is the only run that measures what Logan really has configured. It exports a
  file, read with `node tools/eval-router.js --read <file>`.
  **The runner classifies and scores and must NEVER act** — the corpus
  contains "Delete the dentist appointment", and a runner that reached
  `performRoute` would offer to delete a real event. A test enforces it.
  `js/bench-cases.js` is GENERATED from `eval/router-cases.json` by
  `tools/build-bench-corpus.py`; edit the corpus, then regenerate, or the
  drift test fails.
- **Settings → "How well does it read paperwork?"** — the EXTRACTION benchmark
  run IN THE APP (v9.19). Same reason as the routing one: the key is on the
  phone. It must extract and score and **never save** — no `pendingEvents`, no
  review screen, no writes; a test enforces it. `js/extract-cases.js` is
  GENERATED from `eval/cases.json` by `tools/build-extract-corpus.py`.
  Both benchmarks share the runner and `benchState.kind` picks the scorer.
- `node tools/eval-router.js` — ROUTING accuracy against `eval/router-cases.json`.
  Three tiers: `--dry` (scorer self-check), `--offline` (the properties that
  need no model — this tier also runs inside `node tests.js`), and the default
  run which costs tokens. Accuracy is NOT the headline: four safety counts are
  reported separately and must be ZERO — destructive escalation, write
  escalation, invented parameters, missed refusal. Commit
  `eval/router-last-run.json`.
- `node tools/diagnostics.js <file>` — read a diagnostics export off Logan's
  phone (see AI CALL LOGGING below). `--errors`, `--all`, `--json`.

SETTINGS IS A HUB (v9.22). `renderSettings` is a MENU of six rows, each
opening a real sub-screen (`setPeople`, `setAI`, `setCapabilities`,
`setReminders`, `setAppearance`, `setBackup`, `setTrouble`). It was one
5,794px scroll — 6.8 phone screens, 11 sections — and is now 590px.
  - Hub-and-spoke, not accordions: NN/g find accordions on mobile "conserve
    space but can also cause disorientation and too much scrolling", and
    drill-down is what iOS Settings already teaches every user.
  - **Do not put fields back on the hub.** A test fails on an `<input>`,
    `<textarea>` or `.sect` heading appearing there; that is how it slides
    back into being a long scroll.
  - Every row shows CURRENT STATE ("Appearance / Dark"), amber when it wants
    attention. A test checks the hub reads live state rather than static text.
  - A test lists 24 controls that must stay reachable somewhere in the family,
    so a reorganisation cannot quietly drop a feature. The section helpers
    (`diagnosticsSection`, `appearanceSection`, `aiCapabilitySection`) count as
    reachable — the pages call them rather than inlining their markup.
  - Adding a settings page means adding it to `tools/a11y-audit.js` SCREENS.

ASK IS REACHABLE FROM EVERY SCREEN (v9.21). `openAsk()` records
`{tab, sub, data}` in `askOrigin`; `closeAsk()` restores all three. Plain
`back()` cannot be used to leave Ask — it drops to the top of a tab and would
strand anyone who asked from a list or a half-filled form. `nav()` clears the
origin, because choosing a tab is a deliberate departure.
  - It stays a SCREEN, not an overlay, on evidence: NN/g's overlay-dismissal
    study found users "lose their work" picking the wrong dismissal method and
    recommends "avoiding overlays entirely when possible, preferring separate
    pages". Ask holds a typed draft and sometimes a pending confirm-this-action.
  - `renderEventEdit` builds its header by hand (Back must cancel the edit), so
    its Ask button is added explicitly. Any other hand-built header needs the
    same or it becomes the one screen without it.

THE ASSISTANT CAN ACT (v9.14, `js/assistant-actions.js`). Gordon does not
only answer. Ten intents in `js/intents.js` change something; five only read.
The safety properties below are each enforced by a test, and none of them is
optional:

  - `performRoute()` NEVER writes. It resolves an entity and proposes.
    `confirmPendingAction()` is the ONLY path in the app that turns an
    assistant sentence into a change.
  - Resolution refuses rather than guesses. `resolveEntity()` returns
    `ok | none | ambiguous`; two candidates means ASK, never pick.
  - Every write is undoable — an explicit Undo toast, or one of the app's own
    helpers (`softDelete`, `markHandled`, `completeChore`) which carry theirs.
  - Call the app's own functions; do not reimplement a write. `toggleChore`
    exists because a chore belonging to nobody needs the "who did it?" sheet.
  - Undo by id, never by text. Undoing an assistant add must not delete an
    identically-named row the user added.
  - `quickRoute()` short-circuits ONLY to read-only intents. Its change-verb
    guard is a safety mechanism: widen it when adding a verb, never narrow it.
  - `quickRoute()` also requires the sentence to MENTION something this app
    holds (`mentionsAppTopic`, v9.16). Being question-shaped used to be
    enough, which sent "what's the capital of France?" to the calendar prompt
    at 0.95 confidence instead of letting it refuse and disclose. Making this
    optimisation stricter is always safe; returning null costs one round trip.
    The caller passes in the user's people/list/chore names.

`destructive: true` on an intent is a flag, not a fifth consequence class.
The consequence set (answer / navigate / draft / confirm) is closed and
tested. The flag gives the confirm button a red treatment and an action name
("Delete Recital"), per Apple App Intents' `actionName`.

If you add an acting capability: declare it in `js/intents.js` with a non-AI
`fallback`, give it a `performRoute` branch that resolves-then-proposes, give
it a `confirmPendingAction` case with an undo, and add its example to the
registry so the chips can find it. `js/ai-actions.js` is the user-facing
disclosure list and must be updated too — it exists so the promise a user
reads cannot drift from what the code does, and it HAS drifted before.

WHEN A GUARD TEST READS PROSE IT IS NOT READING CODE. Twice in one session a
test split on a token that also appeared in a nearby COMMENT -- `e.waitUntil(`
in sw.js, `AbortError` in shareDiagnostics -- so deleting the real code still
passed. **Strip comments before analysing a function's source in a test.**

AN ASYNC TEST BODY USES `atest`, NEVER `test` (v9.98). `test()` calls `fn()`
the instant it is declared, so an `async` body runs only as far as its first
`await`; the remainder is a continuation that resumes at the END of the file,
alongside every other async continuation, over one shared `S` / `pendingAction`
/ `askState`. Measured with a controlled pair: a probe that clears `S.lists`
from its continuation, declared beside `P5-C2`, turns P5-C2 red
("Cannot read properties of undefined") with both on `test()` and green with
both on `atest()` — same probe, same victim, same order. `atest` defers the
whole body until the previous one has finished. A guard in `tests-modules.js`
fails the build on any `test('...', async` in `tests-cases.js`.
`return p.then(...)` inside a plain `test()` is fine: everything that touches
state there happens synchronously, before the promise is returned.
Mutation-test every new guard; that is what caught both.

AI CALL LOGGING (v9.13, `js/ailog.js`): every AI call is recorded in
`S.aiLog`, rolling 200 entries, both providers, success and failure. Field
names follow the **OpenTelemetry GenAI semantic conventions** (`op`,
`provider`, `reqModel`/`resModel`, `inTokens`/`outTokens`, `finish`, `ms`,
`errorType`) so the log means what an engineer expects.

**Prompt text, answer text and the API key are NEVER logged, and that is not
negotiable.** Those conventions exclude prompt/completion bodies because they
"routinely contain names, emails, account numbers" — and in THIS app the
prompts are children's names, schools, addresses and schedules. `redact()`
scrubs error strings, which are the one place a provider can hand back
something sensitive unasked. If a future change would put request or response
content into a log entry or the diagnostics file, it is wrong.

`callAI(blocks, maxTokens, system, op)` — the 4th argument names the
operation. Every call site must pass one; a test fails the build otherwise,
because an unnamed call logs as `unknown` and answers no question. Logging is
wrapped in try/catch: it must never break the call it is logging about, and
turning the Anthropic fallback OFF must not silently turn logging off with it.

Settings → *When something goes wrong* exports a diagnostics file that is
deliberately NOT the backup: AI log + manual problem log + version context,
and **no events, chores, lists, notes or API key**, because that file gets
emailed around. Read it with `node tools/diagnostics.js <file>`.

CONVERSATION MEMORY (v9.10, `js/conversation.js`): the assistant's chat
persists in `S.ask.turns` across launches, until "New chat" clears it. Two
things are deliberately SEPARATE and must stay that way:
  - what is SHOWN: the whole saved conversation.
  - what is SENT: `contextTurns()` — today's turns only, at most 2.
Every answer is date-relative ("this week", "in 2 days"). Replaying
yesterday's answer as context invites the model to repeat a claim that has
since become false. A conversation spanning midnight stays visible under an
"Earlier" divider but starts a fresh context, and says so.

THEME (v9.9): DARK SHIPS BY DEFAULT. The bare `:root` in css/tokens.css IS
the dark palette; light is an opt-in override on `:root[data-theme="light"]`,
applied by `applyTheme()` in JS (CSS alone cannot express "follow the phone
only when the user has not chosen"). Setting lives at `S.settings.theme` =
dark | light | system. An inline script paints the attribute BEFORE first
render so there is no flash.

iOS 26 leaves a strip below the layout viewport that NOTHING inside the page
can paint — the old `nav::after` cover could never have worked, and on-device
measurement showed 186 device px of page background still showing. Only the
CANVAS paints there, and it takes its colour from `<html>`. So
`html{background:var(--card)}` (nav colour) + `body{min-height:100vh}`.
Do not "simplify" either of those away.

THE ASSISTANT (v9.8): the model does ONE job — turn a sentence into
`{intent, params, confidence}` and stop. It never acts, never loops, never
calls a tool. This is Anthropic's ROUTING workflow, chosen because their own
criteria rule out an agent here (high-frequency, low-complexity, verifiable
output, compounding per-call error). Control flow lives in `performRoute()`,
in code.

- `js/intents.js` — the capability registry, modelled on Apple App Intents.
  One intent per action, variants via parameters. Every intent declares a
  CONSEQUENCE: `answer`/`navigate` may run immediately; `draft` goes to the
  existing review screen; `confirm` needs an explicit yes. There is no class
  that writes silently, and a test loops the whole registry to prove it.
- `js/router.js` — treats model output as UNTRUSTED: string-aware brace
  scanning, unknown intents refused, wrong-typed values DROPPED never coerced,
  invented params discarded, low confidence refused. A routing failure becomes
  capability disclosure, not a dead end.
- Entity resolution (`resolveEntity`) is code, never the model. Two possible
  matches ASK; they never get picked. Exact match beats fuzzy.
- `quickRoute()` classifies obvious QUESTIONS with no model call at all — the
  router otherwise adds a whole round-trip in front of every answer. It only
  ever short-circuits to a read-only intent; anything that could change data
  still goes to the model and through every check. Tested both ways.
- Suggestion chips come from the registry — NN/g: a chat box "places the
  burden of discovering an app's capabilities upon the user".
See ASSISTANT-PLAN.md for the sources.

AI FEATURES: every AI capability is declared in `js/ai-actions.js` with a
risk class — `read` (changes nothing), `propose` (draft, user reviews before
anything is saved) or `derive` (NO model at all, plain code). There is
deliberately no class meaning "writes on its own"; adding one means editing
that file and its test. Settings renders the can/cannot text straight from
this registry so the promise cannot drift from the code. `aiEnabled()` is the
global off switch and every model-backed surface must respect it while its
manual fallback keeps working. See AI-INTEGRATION-PLAN.md for the research.

Clash warnings (`js/conflicts.js`) are deliberately NOT AI — overlap is
arithmetic with an exact answer, and a model would trade certainty for
latency, cost and the chance of being wrong. Keep it that way.

FOLDER RULE: everything in `js/` SHIPS (it gets inlined into index.html).
Tooling-only code belongs in `eval/` or `tools/`. The drift test enforces
this — if it fails on a new file, the file is probably in the wrong folder.

REMOTE ERROR REPORTING (v9.24, `js/errorReport.js` + glue beside logProblem;
plan: ERROR-REPORTING-PLAN.md). Every NEW problem logged by `logProblem` is
also queued to the shared Firestore `errorReports` collection (the recipe
app's project), where the ADMIN CONSOLE lists it under a `flyersnap` badge.
Report ids lead with an INVERTED 13-digit timestamp so the Firebase data
browser (which lists by id ascending) shows newest first — same scheme in all
three apps.

**THIS IS A THREE-APP ARRANGEMENT, AND THIS REPO IS NOT ITS AUTHORITY.** The
collection is `errorReports` in the recipe app's project `meal-planner-f7f2f`;
the Firestore rules live in the RECIPE APP's repo; the contract lives in
`ERROR-LOGGING-STANDARD.md` in `C:\Users\Logan\Desktop\Repos\AdminConsole`;
this repo's participation is summarised in `ERROR-LOGGING-HANDOFF.md` and
planned in `ERROR-REPORTING-PLAN.md`. The rules allow ANYONE to create a
shape-valid report — **≤24 keys, message ≤4000 chars** — and only Logan to read
or manage. (Read from `firestore.rules` by the Admin Console session and
confirmed: `isValidErrorReport` requires reportId/type/message strings,
`data.keys().size() <= 24`; anonymous `create` only, admin-only
read/list/update/delete, deny-by-default elsewhere.) Measured against the cap: a maximal FlyerSnap report is **13 keys**,
and `redact()` caps `message` at **400** chars, so both limits have wide margin.
Consequences for anyone editing this:

- **AN AUTOMATIC REPORT IS DIAGNOSTICS-ONLY** (ruling 2026-08-23,
  `ERROR-LOGGING-STANDARD.md` §6). Model names, status codes and versions: yes.
  The thing the app was PROCESSING: never, not automatically. A deliberately
  user-filed report is the one exception, on the one-tap consent model —
  FlyerSnap has no such path today, so nothing is exempt. `redact()` does NOT
  give you this for free: it scrubs API keys and email ADDRESSES only, so the
  Gmail watcher's `where` was covered and the email SUBJECT it passed as
  `detail` was not. `toReportDoc` routes every detail through
  `isThirdPartyContent(where)`; **a new content source is added to THAT
  function**, never as a second condition somewhere else.
- **Shape changes are ADDITIVE ONLY**, and coordinated through the standard doc
  — the server-side cap is enforced from a repo that is not this one, so a
  breaking change here fails silently as a 403 on a user's phone.
- **New failure paths belong in `logProblem`**, the single funnel. Remote
  reporting then happens for free; a bespoke reporting path bypasses the
  privacy rule, the outbox and the guards.
- **The reporter must NEVER call `logProblem`** — a failing reporter reporting
  itself is a loop. Everything in that section is try/catch-silent.
- The database is expected to carry **sign-in** later, not just error reports.
  Anything done to it now should assume that. Delivery is a plain `fetch` POST to the Firestore REST API — no SDK, nothing
at boot (rule 4 holds), localStorage outbox (`flyersnap-error-outbox`) so a
killed page still leaves a record, delivered next launch. Text passes through
`redact()` — the AI-log privacy rule applies unchanged: no event content, no
prompt text, no API key, ever. The glue must NEVER call `logProblem` (loop).
Opt-out: `S.settings.errorReportsOff = true` (no UI yet — adding one touches
the settings-hub tests). Rules-side contract: ERROR-LOGGING-STANDARD.md in
the AdminConsole repo; `firestore.rules` lives in the recipe-app repo.

## Deploying

Logan pushes; agents never do. After changes: run tests, bump the version
stamp in index.html (`FlyerSnap vX.Y · one-line note`) and `sw.js` CACHE,
then hand Logan a copy-paste PowerShell block:
`cd C:\Users\Logan\Desktop\Repos\FlyerSnap` → `node tests.js` → `git add -A`
→ `git commit -m "..."` → `git push`. If `gmail-watcher.gs` changed, tell him
explicitly — it must be re-pasted at script.google.com (Deploy → Manage
deployments → new version). If it didn't change, say so.

`deploy.ps1` (zip-based flow) predates direct folder access and still works;
it expects a `flyersnap-vNN*.zip` in Downloads and must itself be shipped
inside any zip (it self-updates).

## Current work: UI modernization (see UI-MODERNIZATION-PLAN.md)

Six phases toward a design that holds up in front of design professionals.
Status: ALL SIX PHASES COMPLETE (v8.8 tokens/dark mode, v8.9 icons, v9.0
components, v9.1 accessibility, v9.3 PWA hygiene, v9.5 EXPERT-QA.md).
v9.4 added swipe navigation. EXPERT-QA.md is also the best single summary of
the project's design decisions and its known weaknesses — read it before
proposing architectural changes.

Icons are GENERATED: `python3 tools/build-app-icons.py` draws every app icon
from the palette. Never hand-edit the PNGs. Maskable icons must stay
full-bleed with artwork inside the 80% safe circle; apple-touch-icon.png must
stay opaque (iOS fills alpha with black). Tests check all of this.
Lighthouse baseline (mobile): 99 / 100 / 100 / 100 —
`bash tools/run-lighthouse.sh`.

Swipe navigation (`js/gestures.js`): the edge zones belong to iOS's own
back/forward gesture, which a web app CANNOT disable — never handle a swipe
starting within SWIPE.EDGE of a screen side, and never preventDefault on
these listeners. Decisions go in the pure `swipeIntent()` so they stay
testable.

Accessibility rules now enforced by tests: never reintroduce
`user-scalable=no` or `maximum-scale<2` (SC 1.4.4); every input needs a
`<label for>` or `aria-label` (a placeholder is NOT a name); an icon-only
button carries its own `aria-label` (not just a titled `ico()` inside);
the active tab needs `aria-current="page"`.

Destructive actions use `softDelete(coll, id, label)` -> undo toast, NOT
confirm(). It returns the undo function. This is only safe because deletes
were always soft (deleted=true); never make a delete hard without revisiting
it. `toast(msg, {label, fn})` renders the action button.
Empty screens use `emptyState(icon, title, body, cta)`.

Icons: `ico('name')` renders `<use href="#i-name">` against the sprite in
index.html's body. Add a symbol to `tools/build-icons.py`'s SYMBOLS map AND
the sprite in index.html (tests catch a mismatch either way). Emoji must
never come back as chrome — a test enforces it; the allowed content emoji
are listed in that test.

## Gmail watcher (RAW_MODE)

`gmail-watcher.gs` queues lightweight references only (Script Properties cap:
9KB/value). The app fetches one message on demand (`action=message&msgId=`),
combined body+attachments read first, per-source fallback. Tables flattened
via `tablesToPlainText()` (rowspan/colspan resolved; PLAIN beats HTML/markdown
for LLM table extraction). Duplicate detection has a user-facing "Not
duplicates" dismiss (`S.settings.notDuplicates`).
