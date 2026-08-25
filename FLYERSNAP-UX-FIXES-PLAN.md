# FlyerSnap UX Fixes — Plan of Attack

**From:** the usability review (heuristic evaluation of the Problem Log + Ask Gordon).
**Date:** 2026-08-25 · **Method:** Research → Plan → Scaffold → Code → Docs.
**Architecture constraints (non-negotiable, from CLAUDE.md):** single-file PWA; `js/`
modules are hand-inlined into `index.html` and the inline-copy test compares them
whitespace-normalized — a `js/` change must be mirrored into the inlined copy or the
suite fails; every release bumps **`APP_VERSION`** *and* **`sw.js` CACHE** together;
ship only on `deploy.ps1` printing `… passed, 0 failed`; never remove a feature.

---

## 0. Model-tag repair + 429 handling — the real reason Gordon fails *(designed; awaiting go)*

The live error report (2026-08-25) settled the "keeps defaulting to Anthropic" mystery:

```
message:  Local model: Fell back to Anthropic: model error 429: {"error":"rate limited"}
detail:   qwen3-vl:8b        appVersion: v9.38
```

Two real bugs, independent of the UX work below:

- **Stale bare thinking tag.** The device still requests `qwen3-vl:8b` (the Thinking
  edition — reasons to budget, never answers), not `qwen3-vl:8b-instruct-q4_K_M`. The
  v9.32 migration wrote the bare tag into `S.settings.localModel` and stamped
  `schemaVersion = 5`; the v9.38 `from < 5` block in `js/migrate.js` now targets q4_K_M
  but **cannot re-run** on an already-v5 device. This is the recipe-app bug exactly.
  **Fix:** bump `SCHEMA_VERSION` to 6 with a `from < 6` block that force-rewrites any
  saved `localModel` in the bad-tag set (`qwen3-vl:8b`, `…-thinking*`, `…-q8_0`,
  `qwen2.5:14b-instruct`) to `qwen3-vl:8b-instruct-q4_K_M` — mirror the recipe app's
  `migrateModelTag()`. Mirror the change in `js/migrate.js` **and** its inlined copy;
  add a migration test.
- **429 rate-limited → silent Anthropic.** The proxy's rate limiter returned 429 and the
  app fell back silently. A 429 is not "the model didn't answer" — it's "wait a moment."
  **Fix:** `classifyError` already buckets 429 as `rate_limit`; surface it on the Ask
  error path with a "Gordon is busy — try again shortly" message and (P1) a short backoff
  before falling back, rather than immediately spending the Anthropic budget. Proxy-side,
  review the per-user limit in `server/ollama-proxy.mjs` (infra decision — Logan's call).

> This is item 0 because it's the actual cause of Logan's complaint. It is small and
> ready; it is held out of the P0 commit only to keep commits clean. Greenlight → ship
> as its own version bump before or alongside P0.

---

## P0 — Make errors & answers copyable *(this pass)*

**Why first:** both screens fail the same way — the app produces text a person needs to
take somewhere (an error to send, an answer to keep) and won't let them take it. On a
phone the Problem Log is a dead end: you can see the error and can't get it out. That is
the Critical finding (PL-1) and the reason "I can't copy them on the phone" happened.

### Scaffold (pure, unit-tested — `js/format.js`)
- `formatProblemForCopy(p)` → plain-text block: message, where, count, last, detail.
- `formatAnswerForCopy(turn)` → the assistant's answer text, tolerant of a missing turn.
- Both exported, mirrored into the inlined `format.js` block in `index.html`
  (contiguously, after `esc`, to satisfy the inline-copy guard), and added to the
  format export-presence test. New behaviour tests in `tests-modules.js`.

### Code (impure glue + wiring — `index.html`, inline only)
- `copyTextValue(text, note)` / `shareTextValue(text)` — `navigator.clipboard.writeText`
  inside the tap handler (works on iOS Safari in a user gesture) with a toast; share uses
  `navigator.share` where present. Mirrors the existing `shareAsText()` pattern.
- `copyProblem(id)` / `shareProblem(id)` / `copyAnswer(i)` — look up by id/index (no
  string-escaping in `onclick`), format, copy/share.
- **`renderProblems`:** a per-row **Copy** + **Share** action row (reuses `.linkbtn`,
  already a 44 px target), and the `detail` field re-rendered **full-contrast,
  monospace, selectable** — it is the payload of the screen, not a footnote (fixes PL-2).
- **`renderAsk`:** a **Copy** control under every Gordon turn (fixes AG-1).
- Bump `APP_VERSION` `v9.38 → v9.39`; `sw.js` CACHE `flyersnap-v121 → v122`.

### Not in P0 (kept honest): Retry, streaming, bubbles, composer, chips — see P1/P2.

---

## P1 — Make the wait & the errors honest *(queued)*
- **AG-2:** stream tokens, or staged progress ("waking desktop… reading… writing…") with
  elapsed seconds and a **Cancel**, for local-model calls (NN/g: past 10 s show progress +
  an escape). Keep the honest "if asleep, waits then falls back" note.
- **AG-4 / PL-3:** show the plain-language `explainError()` reason + **Retry** in the Ask
  error card, and as a per-row hint in the Problem Log (auth → sign in; rate_limit → wait;
  timeout → wake desktop). Ties directly to item 0's 429.
- **PL-4:** tier Problem-Log stripes by `errorType` (red = won't self-heal, amber =
  transient, grey = resolved).

## P2 — Finish the chat conventions *(queued)*
- **AG-5:** bubble alignment (user right, Gordon left + label) so turn-taking is spatial.
- **AG-3:** multiline auto-growing `<textarea>`; Enter sends, Shift+Enter newline; hint.
- **AG-6:** real `<button>` suggestion chips (keyboard-operable).
- **AG-7 / PL-5:** source note on `--t-cap`; relative timestamps with exact on tap.

---

## Test & rollout
- Scaffold lands with tests before wiring (`node tests.js` green locally on device).
- Every change is a self-contained edit to `index.html` (+ mirrored `js/` where relevant),
  shippable behind one version + SW-cache bump.
- Deploy is Logan's: `deploy.ps1 "<msg>"` after `… passed, 0 failed`. Claude never runs git
  through the bridge.

## Status
- **P0: SHIPPED to the working tree (2026-08-25), tests green.** `js/format.js` gained
  pure `formatProblemForCopy` / `formatAnswerForCopy` (+ inlined copy, verified matching);
  `index.html` gained `copyTextValue` / `shareTextValue` / `copyProblem` / `shareProblem` /
  `copyAnswer`, per-row **Copy + Share** on the Problem Log, full-contrast selectable
  monospace `detail`, and **Copy** on every Gordon answer; new tests in `tests-modules.js`.
  Full suite validated in a mirrored container copy: **605 passed** (only failure was a
  missing-asset artifact of the partial copy — PNGs that exist on the device). Ships under
  the working tree's existing **v9.39 / sw v122** bump (not made by this pass). Deploy is
  Logan's: `deploy.ps1`.
- **Item 0 (model-tag repair + 429): SHIPPED to the working tree (2026-08-25), tests green.**
  `js/migrate.js` (+ inlined copy, verified matching) bumped to `SCHEMA_VERSION = 6` with a
  `from < 6` block that force-rewrites a saved `localModel` of `qwen3-vl:8b` / thinking
  variants / `q8_0` / `qwen2.5:14b-instruct` → `qwen3-vl:8b-instruct-q4_K_M` — repairing
  devices stuck at schema 5 that the `from < 5` block can never reach (Logan's exact case).
  `index.html`'s fallback toast now names a 429 as "Gordon is busy (rate limited); try again
  shortly" instead of the generic "did not answer." New migration test + the two `tests-cases`
  schema assertions updated 5→6. Bundled with P0 under **v9.40 / sw v123**. Proxy-side per-user
  rate limit remains Logan's infra call. Deploy: `deploy.ps1`.
- **P1a: SHIPPED to the working tree (2026-08-25), tests green (v9.41 / sw v124).**
  AG-4 — the Ask error card now offers **Retry** (re-runs the remembered last question) and
  **Copy**, alongside the plain-language reason it already showed. PL-3/PL-4 — Problem Log
  rows get a one-line "what to do" hint and a **red (act) / amber (transient)** stripe, from a
  new pure `problemGuidance(text)` in `js/format.js` (tested, inlined) that reads the entry's
  own text — no schema change. **Bonus fix (your "74 failed" report):** `summarize()` no longer
  counts a call that **fell back to Anthropic** as *failed* — "failed" now means no answer at
  all, fell-backs are reported separately. That's why the Diagnostics line read "74 failed"
  while the Problem Log showed one grouped entry. Regression-guarded in `tests-modules.js`.
- **P1b (queued):** the slow-wait UX for Ask — token streaming, or staged progress + elapsed +
  **Cancel** (AG-2). Held back because it threads an abort signal through the async call path
  and deserves its own careful pass.
- **P2 (queued):** bubble alignment, multiline composer, accessible chips, relative timestamps.

## Field confirmation (2026-08-25)
- The schema-6 migration **worked**: a live error report now shows
  `model: qwen3-vl:8b-instruct-q4_K_M` on v9.40 (was the bare thinking tag). And an on-device
  extraction benchmark on q4_K_M scored **F1 0.96** (precision 0.93, recall 1.0; title/kind/
  endTime 100%) in ~2.2 s/case — the correct model performs well.
- Remaining Gordon failure is the proxy **429 rate limit** (`server/ollama-proxy.mjs` per-user
  cap) — infra, Logan's call — now surfaced honestly as "Gordon is busy; try again shortly."

## Shipped — final status (2026-08-25) — supersedes the "(queued)" notes above

The whole plan plus several follow-on requests are built, tested (609 passing), and
committed. FlyerSnap moved **v9.40 → v9.47** across this effort:

- **v9.40** — item 0: schema-6 model-tag repair + honest 429 message.
- **v9.41** — P1a: Ask Retry/Copy on errors; Problem Log per-row hint + red/amber tier
  (`problemGuidance`); the "74 failed" summarize fix.
- **v9.42** — P1b: Ask elapsed/staged progress + **Cancel** (generation-token, no network
  abort so it never trips the fallback); growable spell-checked composer (main + review
  boxes); overlap banner shows time · place · who per event.
- **v9.43** — recovered fallbacks no longer logged as problems + schema-7 prune of stale ones.
- **v9.44** — P2: Ask chat bubbles (you right, Gordon left with a label).
- **v9.45** — P2: keyboard-operable suggestion chips (AG-6); relative timestamps
  (`relativeTime`, exact-on-tap) in the Problem Log (AG-7).
- **v9.46** — overlap banner: each row taps straight to **reschedule** that event; a
  "See next clash" **stepper** to page multiple conflicts without dismissing.
- **v9.47** — the "N emails had trouble" box rebuilt (research: NN/g error-message
  guidelines + bulk-import patterns): retitled non-blaming, **dismissible**, **Try N again**
  for transient failures (retains `msgId`), "no dates to import" for the rest, points to the
  Problem Log. `extractFromRawItems` now returns `{ out, failures }` with structured failures.

Everything verified with `node tests.js` and, for the visual items, rendered screenshots.
Nothing in this plan remains queued. Related, outside this repo: Gordon confirmed working
(model + proxy rate limit 20→120/min); recipe app got recipe-preview-before-save + a
FlyerSnap-style "new version ready" reload prompt.
