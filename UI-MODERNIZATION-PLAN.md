# FlyerSnap — UI Modernization Plan

**Written:** August 22, 2026 · **Baseline:** v8.7 (239 tests passing)
**Status:** Phases 1–4 SHIPPED (v8.8–v9.1 — 260 tests). Phases 5–6 pending.

> Progress log
> - **v9.1 / Phase 4 done:** `user-scalable=no` removed (SC 1.4.4 — an
>   installed iOS web app honours it where a Safari tab does not); 13 visible
>   `.label` divs became real `<label for>`, every remaining input got an
>   `aria-label`; `aria-current="page"` on the active tab; screen title is an
>   `<h1>`, empty-state titles `<h2>`; landmarks named; toast is a polite live
>   region; focus moves to `<main>` on navigation. 8 source-level a11y tests +
>   `tools/a11y-audit.js`, which audits the RENDERED DOM and caught a gap the
>   source tests could not — delete buttons whose only accessible name lived
>   on the `<svg>` inside; names now sit on the buttons. All five screens
>   audit clean.
> - **v9.0 / Phase 3 done:** `emptyState()` helper — empty screens now carry a
>   tinted icon tile, title, one line of copy and at most one action (Events,
>   Chores, Lists, Meals, Rewards); Meals' orphaned right-aligned link became
>   a three-up `.actionrow`; **confirm() replaced by an undo toast** on list,
>   chore and reward delete via `softDelete()` — safe because those deletes
>   were always soft, and it returns the undo handle so tests exercise the
>   real path (5 new behaviour cases, incl. "undo restores byte for byte" and
>   "deleting a chore keeps its earned stars"); toast gained an action button
>   with pointer-events only when interactive; header 17px/700 -> 19px/800.
>   Fixed two icon bugs found in the render harness: `.ico:only-child` matched
>   every labelled button icon (CSS ignores text-node siblings) — replaced by
>   an explicit `ico-solo` class; and the skillet glyph read as a coffee cup
>   at 24px — redrawn as a lidded pot.
> - **v8.9 / Phase 2 done:** 40-symbol inline SVG sprite (`<symbol>` defs in
>   index.html's body) + `ico()` helper in `js/icons.js`; ~65 call sites
>   converted across nav, capture, sheets, chores, lists, meals and settings;
>   `showSheet` gained an `icon:` field so sheet labels stay `textContent`
>   (data never becomes markup); icon-only controls carry `aria-label`, all
>   others are `aria-hidden` beside their real text label. Content emoji kept
>   deliberately: reward ⭐, celebration 🎉, and the 🦷 example in the
>   chore-title placeholder. Three guards added: every referenced icon exists
>   in the sprite, no unused symbols, and no emoji in UI chrome — the last one
>   caught four sites the manual sweep missed. Also renamed the confusing
>   "🔔 New 27" chip to "27 unseen" (Phase 3 item, done early since the chip
>   was already being edited).
> - **v8.8 / Phase 1 done:** every color tokenized (css/tokens.css is the only
>   place colors live — enforced by test); dark palette via
>   prefers-color-scheme; dual theme-color metas; WCAG-AA contrast test over
>   every used pair in both themes (it immediately caught two contrast
>   failures that had shipped in v8.6: light --faint at 4.14:1 and the empty
>   checkbox border at 1.8:1 — both fixed); tools/preview.js screenshot
>   harness (all tabs × light/dark, seeded demo data); CSS extracted to
>   css/tokens.css + css/components.css with tools/inline.js sync +
>   drift test, mirroring the js/ pattern; CLAUDE.md added for agents.

**Goal:** a visual system that reads as professionally designed to a design-literate audience, with every known "pokeable" item addressed — without changing what any feature does.

## Ground rules (from hard-won incidents — do not relax)

1. **Never remove or replace a feature.** Every change here is visual, structural, or additive.
2. **Single-file delivery stands.** All CSS/SVG stays inline in index.html. No build step, no CDN, no web fonts (offline PWA + the v8.1–v8.5 module incident).
3. **Every phase ships as its own version** and is verified on the installed iPhone PWA before the next phase starts. The Node sandbox cannot see rendering bugs — v8.6's floating-button bug proved it.
4. **Tests before every deploy; document every fix in the same turn it ships.**
5. Keep the existing green identity (#2D5A4A family). Refine it; don't rebrand.

## Phase 1 — Design tokens + dark mode (ship as v8.8)

The token foundation already exists (`:root`: 5-step type scale, 4px spacing grid, 44px tap targets — cite these to experts, they're the right answers). This phase completes it:

- **Full palette as tokens.** Audit for hardcoded colors outside `:root` (`#fff` on nav/cards, `nav::after`, rgba shadows, chip/badge colors) and move them into tokens. Nothing may name a raw color outside `:root` when this phase ends.
- **Dark palette** under `@media (prefers-color-scheme: dark)` — true dark surfaces (not inverted), desaturated green ramp, elevated-card tone instead of shadows, amber/red adjusted for dark-background contrast.
- **`<meta name="theme-color">` twice** with `media` attributes (light + dark) — iOS 26 Liquid Glass samples chrome tint from fixed elements and falls back to page backgrounds, so header/nav token colors must be deliberate in both themes.
- **Automated contrast guard:** a new test parses the `:root` (and dark) tokens and computes WCAG contrast ratios for every text/background pair in use — fails the build below AA (4.5:1 body, 3:1 large text). This is the kind of oracle this repo is built on.
- **Preview harness:** `tools/preview.js` (Playwright Chromium, already proven by the v8.7 repro) renders every tab at iPhone viewport in light AND dark and saves PNGs — design review without a deploy, and screenshot evidence for each later phase.

## Phase 2 — Iconography (ship as v8.9)

Emoji-as-icons is the single loudest "hobby project" signal to professionals: platform-dependent rendering, no styling, no active states.

- **Inline SVG sprite** (`<svg><symbol>` defs at the top of body, `<use>` at call sites). Stroke-based, 24px grid, 1.75px stroke, `currentColor` — icons inherit text color, so active states and dark mode come free.
- **Replace:** the 5 nav icons; capture actions (camera, photo library, clipboard, PDF, link, email); row actions (share, calendar, edit, delete ✕, search); settings glyphs. Keep genuinely *content* emoji (star rewards ⭐, celebration) — they're personality, not UI chrome; be ready to say that on purpose.
- **Accessibility built in:** every icon `aria-hidden="true"` with the existing text labels doing the work; icon-only buttons (the list ✕) get `aria-label`.
- **Guard:** test asserting no emoji codepoints remain inside `nav` markup or `class="btn"`/`class="linkbtn"` templates (inventory first, then lock).

## Phase 3 — Component & screen polish (ship as v9.0)

- **Header:** larger title weight/size, count subtitle where useful; consistent back-button treatment.
- **Cards:** tighter elevation system (one soft shadow token in light, border+surface tone in dark), consistent radius, aligned right-edge metadata (the "2 days" pills).
- **Empty states:** small inline-SVG illustration + one-line copy + single CTA, replacing plain-text blocks (Chores/Meals/Events empty views).
- **Events:** rename the unseen chip so "🔔 New 27" next to "25 upcoming" stops looking like a bug — label it "27 unseen" (count logic untouched; it correctly includes past events).
- **Meals:** the orphaned right-aligned "📷 Scan a recipe" link becomes a proper action row alongside "Recipe app"/"Shopping list".
- **Lists:** replace the `confirm()` dialog on list delete with a modern **undo toast** ("Deleted 'Costco' — Undo", 5s). Delete is already a soft delete (`l.deleted=true`), so undo is a one-line restore; keep the ✕ but give it the 44px target. Same pattern later for event remove if it feels right.
- **Motion:** keep the opacity-only screen fade + card rise; add subtle press states. NOTHING animates transform on an ancestor of a fixed element (guarded since v8.7).

## Phase 4 — Accessibility audit (ship as v9.1)

Strong bones already: 44px targets, `:focus-visible`, `prefers-reduced-motion`. Close the rest:

- VoiceOver pass: `aria-current="page"` on the active tab, labels on icon-only buttons, `role`/heading structure per screen, form inputs labeled.
- Keyboard/switch-control order check in the preview harness.
- Contrast verified by the Phase 1 automated guard (both themes).
- Statement ready for Q&A: which WCAG 2.2 criteria the app meets and which are N/A.

## Phase 5 — PWA & platform hygiene (ship as v9.2)

- **Maskable icons:** regenerate icon-192/512 with safe-zone padding, add `"purpose": "any maskable"`; proper 180px `apple-touch-icon`.
- Manifest: add `id`, screenshots, richer description; verify `background_color` per theme guidance.
- **Lighthouse run** (headless Chromium in the workspace): target ≥95 on PWA/accessibility/best-practices; record scores for the presentation.
- Offline check: airplane-mode open of the installed app (Logan, on phone).
- iOS 26 items: bottom-gap cover shipped in v8.7; verify chrome tinting in both themes on-device.

## Phase 6 — Presentation prep (no code)

- **EXPERT-QA.md:** anticipated questions with honest answers — why a single file (the v8.1–v8.5 production incident + the inline-copies-match test is a *good* story: evidence-driven architecture); why no framework; where data lives (on-device localStorage, snapshots, migration system); API key handling (stored locally, never leaves the phone except to Anthropic — and its limits, stated plainly); AI provenance (`aiSource` per event, Gordon display-name vs real model in Settings); the six-oracle refactoring test suite; the 239-test culture of one-regression-guard-per-shipped-bug.
- Demo script: seeded demo data path, reset steps, flyer + email + compare-providers flow order.
- Before/after screenshots from the preview harness for the deck.

## Sequencing & risk

Phases are ordered so the app is presentable after every single ship. Tokens (P1) must precede icons/components (P2–P3) or work gets redone. Each phase: change → `node tests.js` green → deploy → **Logan verifies on the installed PWA against a written checklist** → next phase. Rollback for any phase is `git revert` of that phase's commit and redeploy.

**Estimated shape:** P1 and P2 are the heavy lifts; P3 is many small precise edits; P4–P6 are audit/verify/write. Comfortable inside a week with checkpoints.
