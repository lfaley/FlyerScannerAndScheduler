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
**Current version:** v9.1 · **Tests:** 260 passing (`node tests.js`)

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
- `state.js` is NOT extracted: `S` is reassigned (`S = load()`), and ES import
  bindings are read-only. See ARCHITECTURE-PLAN.md for the three options.

Everything else (rendering, state, handlers) still lives in index.html's
script; extracting more of it via `tools/extract.js` (string-aware, tested by
tests-refactor.js's six oracles) into js/ is welcome — inline the result.

## Rules that exist because something burned

1. **Never remove/replace a feature without asking Logan.** Add alongside.
2. **Never guess — verify in the repo, a browser, or research before asserting.**
3. `grep` for a function name before writing it (duplicate `logProblem` incident).
4. Nothing outside `:root`/dark block may name a raw color — the contrast test
   enforces AA in both themes and a no-raw-colors sweep (kid palette + webkit
   tap-highlights excepted).
5. No `transform`/`perspective`/`filter` (even animated-then-filled) on
   ancestors of `.fab` — `position:fixed` descendants lose the viewport as
   containing block. Shipped as the v8.6 "missing scan button" bug; test
   "Fixed-position safety" guards it.
6. PowerShell 5.1: never `2>&1` a native command under `$ErrorActionPreference
   = "Stop"` — deploy.ps1 uses Start-Process file redirection instead.
7. iOS PWA quirks: no new tabs from installed apps (use downloads), separate
   storage from Safari, service worker cache list needs manual bumping
   (`sw.js` `CACHE` const — bump every release), and the iOS 26 short-viewport
   bug (nav::after paints white below the nav on purpose).
8. Run `node tests.js` before every deploy; add a regression test with every
   bug fix; document every fix the turn it ships.

## Verification tooling

- `node tests.js` — 260 tests: data safety, migrations, inline-handler
  resolution, module drift, CSS drift, icon-sprite integrity, no-emoji-chrome,
  fixed-position safety, accessibility, WCAG contrast in both themes.
- `node tools/a11y-audit.js` — accessible names and tap targets in the
  RENDERED DOM. The source tests cannot see a name that computes to nothing
  at runtime; this found exactly that in v9.1.
- `node tools/preview.js [outDir]` — Playwright-Chromium screenshots of every
  tab, light AND dark, seeded demo data. Review design changes here first;
  it would have caught the v8.6 button bug. NOT a Safari substitute — Logan
  verifies on the installed PWA before each release is called done.
- `node tools/inline.js --check` — CSS source/inline drift check (also a test).

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
Status: Phases 1-4 DONE (v8.8 tokens/dark mode, v8.9 icons, v9.0 components,
v9.1 accessibility). Next: Phase 5 — PWA hygiene (maskable icons, manifest
id/screenshots, Lighthouse run). Then Phase 6 — EXPERT-QA.md.

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
