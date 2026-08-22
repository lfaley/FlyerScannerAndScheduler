# CLAUDE.md — read this before touching anything

> Companion doc: **HANDOFF.md** — current state of play, recent work and
> open items. This file is the architecture and the rules.

FlyerSnap: family-organization PWA for Logan. Scans flyers/PDFs/emails → AI
extracts events → calendar reminders. Plus chores/stars, lists, read-only meal
plan (fed by a separate recipe app), Gmail watcher, Anthropic or local-Ollama
AI provider ("Gordon" is the display name; the real model shows in Settings and
in each event's `aiSource`).

**Live:** https://lfaley.github.io/FlyerScannerAndScheduler/ (GitHub Pages, deploys on push to main)
**Local repo:** `C:\Users\Logan\Desktop\Repos\FlyerSnap` (moved here Aug 2026 — older docs may name `FlyerAndScheduler\flyersnap-pwa`; that path is dead)
**Current version:** v9.8 · **Tests:** 343 passing (`node tests.js`)

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
  `js/icons.js` — pure logic modules, individually tested. Inlined by hand
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
9. **Hand Logan ONE self-contained command per line.** A pasted multi-line
   block can lose a newline and silently join two lines
   (`cd ...FlyerSnapgit push`), after which everything runs in whatever
   directory the shell was already in — including, once, the wrong repo.
10. PowerShell 5.1: never `2>&1` a native command under `$ErrorActionPreference
   = "Stop"` — deploy.ps1 uses Start-Process file redirection instead.
11. iOS PWA quirks: no new tabs from installed apps (use downloads), separate
   storage from Safari, service worker cache list needs manual bumping
   (`sw.js` `CACHE` const — bump every release), and the iOS 26 short-viewport
   bug (nav::after paints white below the nav on purpose).
12. Run `node tests.js` before every deploy; add a regression test with every
   bug fix; document every fix the turn it ships.

## Verification tooling

- `node tests.js` — 343 tests: data safety, migrations, inline-handler
  resolution, module drift, CSS drift, icon-sprite integrity, no-emoji-chrome,
  fixed-position safety, accessibility, WCAG contrast in both themes,
  and the self-contained-boot guard.
- `node tools/a11y-audit.js` — accessible names and tap targets in the
  RENDERED DOM. The source tests cannot see a name that computes to nothing
  at runtime; this found exactly that in v9.1.
- `node tools/preview.js [outDir]` — Playwright-Chromium screenshots of every
  tab, light AND dark, seeded demo data. Review design changes here first;
  it would have caught the v8.6 button bug. NOT a Safari substitute — Logan
  verifies on the installed PWA before each release is called done.
- `node tools/inline.js --check` — CSS source/inline drift check (also a test).
- `node tools/eval-extraction.js` — extraction accuracy against the labelled
  corpus in `eval/`. Costs API tokens, so it is NOT in `node tests.js`; run it
  before and after any prompt change and commit `eval/last-run.json`.
  `--dry` self-checks the scorer for free.

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
