# FlyerSnap — Handoff Notes

**Updated:** August 22, 2026 · **Live version:** v9.2 · **Tests:** 263 passing
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
**HANDOFF.md** (this file), **UI-MODERNIZATION-PLAN.md** (the design work),
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

**Next up: Phase 5** — PWA and platform hygiene: maskable icons with safe-zone
padding, `apple-touch-icon` at 180px, manifest `id`/screenshots, a recorded
Lighthouse run. Then **Phase 6**, `EXPERT-QA.md`: the anticipated questions and
honest answers for the presentation.

## Recent work in detail (v8.7 – v9.2)

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

- `node tests.js` — 263 tests. Data safety, migrations, inline-handler
  resolution, module/CSS drift, icon integrity, no-emoji-chrome,
  fixed-position safety, accessibility, WCAG contrast in both themes, and the
  self-contained-boot guard.
- `node tools/preview.js [outDir]` — screenshots every tab, light and dark.
- `node tools/a11y-audit.js` — accessible names and tap targets in the real DOM.
- `node tools/inline.js --check` — CSS source/inline drift.
- **Logan on the installed iPhone PWA.** Non-negotiable: the Node sandbox
  cannot see rendering, and Chromium is not WebKit. Every phase above was
  verified on-device before the next one started.

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
- Phases 5 and 6 of the UI plan (see above).
