# Architecture review: should FlyerSnap be rewritten?

> ## ⚠ PARTLY SUPERSEDED — read this box before acting on anything below
>
> Written **before** the v8.1–v8.5 production incident. Sections 5 and 6 below
> propose shipping `<script type="module" src="js/app.js">` with real ES
> imports. **That was tried and it broke the installed iOS PWA**: a failed
> module import kills the whole script silently, leaving a blank screen with
> no error. It reached production and was emergency-reverted in v8.6.
>
> **What actually holds today (see CLAUDE.md):** source is modular in `js/`
> and `css/`; the shipped `index.html` is a single self-contained file with
> those sources *inlined*, and tests fail the build if the copies drift. Do
> not reintroduce module loading into the shipped file without real
> installed-PWA verification — the Node test sandbox faked imports and gave
> false confidence.
>
> Still valid and worth reading: the analysis in sections 1–4 (why to
> modularise, why NOT to rewrite object-oriented, the inline-handler hazard),
> and the `state.js` constraint — `S` is reassigned and ES import bindings are
> read-only, which is why `state.js` is still not extracted.


Short answer: **modularise, yes. Rewrite object-oriented, no.** And do it in
stages, never as a big bang.

The reasoning, and the plan, below.

---

## 1. What the numbers actually say

| | |
|---|---|
| index.html | 4,078 lines |
| of which JavaScript | 3,892 lines |
| functions | 254 |
| inline `onclick=` handlers | **101** |
| tests | 209, all passing |

3,892 lines in one scope is genuinely past the point where it should be split.
The duplicate `logProblem` we hit this session is the proof: two functions with
the same name, the second silently winning, and nothing to catch it. That is a
**scope** failure.

## 2. Why OO is the wrong prescription

Classes would not have caught that bug. Two classes in one file collide exactly
the same way. The problem is not "no objects", it is "one global namespace".

What actually fixes it is **module boundaries** -- each file with its own scope,
exporting a named surface. That is a different axis from object-orientation, and
it is the one that hurts today.

There is a second reason to be wary. Most of this code is not shaped like
objects. It is:

- pure functions (`fmt12`, `normTitle`, `looksDuplicate`, `cleanModelText`)
- render functions that take a DOM node and write HTML
- one state object, `S`, deliberately kept as plain serialisable JSON so it can
  round-trip through `localStorage` and the backup file

Wrapping `S` in a class would actively hurt: it is persisted as JSON, migrated
across schema versions, snapshotted, and restored from a backup file. Plain data
is the right representation for something whose defining property is that it
survives serialisation.

**A class earns its place where state and behaviour genuinely travel together.**
There are a few such places here -- the local model client, the watcher client,
the problem log. Those are worth making into small objects. The other 200
functions are not.

## 3. Why a rewrite is the wrong plan

This app carries a lot of hard-won, non-obvious knowledge:

- corrupt-load locking, quarantine, rolling snapshots -- written **after real
  data loss**
- four schema migrations that must keep working for existing installs
- iOS-specific workarounds: installed-PWA download behaviour, the JSONP
  transport for Apps Script, safe-area insets, the two-alarm limit
- duplicate matching tuned against real failures (Hell Week vs Livi-Mini Jazz)

A rewrite risks quietly dropping any of these, and the failure would surface as
lost data rather than a red test. The 209 tests are a safety net for *this*
code's shape; many would need rewriting alongside it, which removes the net at
exactly the moment it is most needed.

## 4. The constraint nobody mentions in the tutorials

**101 inline `onclick="someFunction()"` handlers.** Inline handlers resolve
against the global scope. The moment a function moves into an ES module it stops
being global and **every one of those handlers silently breaks** -- no error at
load time, just buttons that do nothing when tapped.

We have already lived through "the button does nothing" twice this month. Doing
it 101 times at once would be miserable.

So event handling must be migrated *before or alongside* the modules, not after.
Two options:

- **(a) Explicit re-export:** modules attach their public functions to `window`.
  Ugly, but a one-line change per module and zero risk.
- **(b) Event delegation:** one listener on `main`, handlers keyed by
  `data-action`. Cleaner, and the right end state, but touches all 101 sites.

Recommendation: **(a) first**, to get module boundaries safely, then **(b)**
gradually as each screen is touched for other reasons.

## 5. Do we need a build step?

No, and we should not add one. ES modules load natively in every browser we
target. The usual objection -- that a deep dependency tree costs a network
roundtrip per level -- does not bite here:

- the tree is shallow (2 levels) and small (~10 files)
- GitHub Pages serves HTTP/2, which multiplexes
- the service worker caches everything after the first load

The current no-build, no-dependency setup is a genuine asset: no npm audit
noise, no lockfile, no toolchain to break. Keep it.

---

## 6. Target structure

```
index.html          shell: markup, styles, <script type="module" src="js/app.js">
js/
  app.js            boot, wiring, the render loop
  state.js          S, load/save, migrations, snapshots      (no DOM)
  format.js         dates, fmt12, friendly, esc              (pure)
  events.js         event model, filters, duplicate matching (no DOM)
  ai/
    client.js       provider dispatch, callAI                (class)
    anthropic.js    the Anthropic transport
    local.js        the Ollama transport
    prompts.js      persona, grounding, prompts              (pure)
  watcher.js        Apps Script client, JSONP                (class)
  problems.js       the problem log                          (class)
  ui/
    events.js       renderEvents and friends
    settings.js     renderSettings
    review.js       renderReview
    ...
```

Rule of thumb: **extract pure logic first, DOM last.** Pure modules are already
well covered by tests, so moving them is verifiable. Render functions are where
the inline-handler risk lives.

## 7. Staged plan

Each stage ends green, is deployable on its own, and can be abandoned without
leaving a mess.

**Stage 0 — scaffold and prove the pattern.** Set up `js/`, extract ONE pure
module (`format.js`), teach the test runner to load modules, confirm 209 still
pass. Small, reversible, answers "does this work at all".

**Stage 1 — pure logic.** `format.js`, `events.js` (matching/filters),
`ai/prompts.js`. No DOM, no `S` mutation. Highest confidence, best payoff.

**Stage 2 — state.** PARTIALLY DONE. `js/migrate.js` is extracted: it is pure
(takes a save, returns it upgraded) and is the single most consequential
function in the app, so isolating and testing it was the highest-value part.

**The rest of state is blocked on a real constraint.** `S` is *reassigned*:

```js
let S = load();
S = Object.assign(blank(), parsed);   // on restore
```

ES module imports are read-only bindings -- an importing module cannot reassign
one. So `state.js` cannot simply `export let S`. Options, in preference order:

1. **Export a container:** `export const store = { S: null }`, and everything
   reads `store.S`. One mechanical change per reference (~400 sites), no
   behaviour change.
2. **Accessors:** `getState()` / `replaceState()`. Cleaner, but every read
   becomes a call, which is a bigger diff.
3. **Leave `S` in the shell.** `state.js` exports only pure helpers
   (`blank`, `migrate`, validation) and the shell keeps ownership.

Recommendation: **(3) for now, (1) later** if it stops being comfortable. There
is no urgency -- the dangerous logic is already isolated and tested.

**Stage 3 — clients as objects.** `ai/client.js`, `watcher.js`, `problems.js`.
These are the genuine objects: state plus behaviour, and each has a natural
interface.

**Stage 4 — UI, one screen at a time.** Each screen moves with its handlers
converted to `data-action` delegation. This is the long tail; do it as screens
get touched anyway.

**Stage 5 — retire the shims.** Remove the `window.*` re-exports once nothing
depends on them.

## 8. What could go wrong, and the mitigation

| Risk | Mitigation |
|---|---|
| Inline handlers break silently | Stage 0 adds a test that every `onclick` name resolves |
| Service worker caches a half-updated set of files | Bump the cache version every deploy; it already does |
| A migration breaks and eats data | `state.js` moves as one piece, tests unchanged, deploy alone |
| The refactor stalls half-done | Every stage ships green; a half-done refactor still works |
| Tests stop reflecting reality | Runner updated in Stage 0, before anything depends on it |

## 9. Honest cost

Stages 0-3 are the ones with real payoff: roughly 60% of the JavaScript, and
they remove the scope hazard that caused the duplicate-function bug. Stage 4 is
the long tail and can be done opportunistically, or never.

The single-file app is not broken. It is past the size where one namespace is
comfortable, and it has already produced one bug because of that. That is a
reason to modularise deliberately -- not a reason to start over.
