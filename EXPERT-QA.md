# FlyerSnap — questions an expert panel will ask, and honest answers

**For:** Logan, presenting to industry professionals · **Version:** v9.6 · **Tests:** 289
**Rule for using this doc:** every answer here is true. Where something is a
weakness, it is written as a weakness with the reasoning and the mitigation —
that lands better than a defence, and it cannot be knocked over.

---

## The numbers, so nothing is guessed on stage

| | |
|---|---|
| `index.html` (the shipped artifact) | 4,667 lines · ~4,343 of them script |
| Functions | 277 |
| Source modules | `js/` 6 files · `css/` 2 files (~595 lines) |
| Tests | **289**, in ~3,400 lines across 4 files |
| Lighthouse (mobile) | Performance 99 · **Accessibility 100** · Best Practices 100 · SEO 100 |
| Dependencies at runtime | **zero** |
| Build step | **none** |

---

## Architecture

### "Why is this one giant HTML file? That's not how anyone builds software."

It isn't one file — it's modular source compiled to a single artifact, which
is exactly what Vite, webpack and Rollup do. The difference is the compile step
is 40 lines instead of a dependency tree.

`js/` and `css/` are the source of truth: small, documented, individually
tested. `index.html` is a build artifact carrying inlined copies, and **tests
fail the build if the copies drift**.

The reason delivery is self-contained is not preference, it's an incident.
Versions 8.1–8.5 shipped with real ES module imports. In an installed iOS web
app, a failed subresource import kills the entire script silently — blank
screen, no error, no console the user can reach. It reached production. It was
emergency-reverted in v8.6.

So there are now three tests that fail the build if the shipped file ever
gains a `<script type="module">`, a `<script src>`, a `<link rel=stylesheet>`,
or an `import`/`export` of its own. They were mutation-tested by re-applying
the original breaking change and confirming they catch it.

**The honest weakness:** ~4,300 lines in one scope is more than one scope
should hold, and it caused a real bug — two functions named `logProblem`, the
second silently winning. The fix in progress is extracting more into `js/`,
which is why the extraction tool has its own test suite.

### "Why not a framework?"

For this app the framework would be most of the payload. There's no build
step, no lockfile, no dependency audit surface, and nothing to break when a
transitive dependency ships a bad release. The app is offline-first on a phone,
and every kilobyte is a kilobyte the service worker has to hold.

That said: **the render loop is the naive one.** Every state change re-renders
the whole screen with `innerHTML`. That's fine at this data size and it was
measured, not assumed — Lighthouse performance is 99. If the event list grew
by an order of magnitude, a keyed diff would be the first thing to add.

### "Why not rewrite it object-oriented?"

Because classes wouldn't have prevented the bug that raised the question. Two
classes in one file collide identically — the failure was one global
*namespace*, not a missing object model. Scope is the fix, and modules give
scope.

There's also a concrete reason state stays plain JSON: it's persisted,
migrated and snapshotted. Wrapping it in class instances would add a
serialization problem the app doesn't currently have.

### "Why is `state.js` not extracted like the others?"

A real constraint, not laziness. `S` is *reassigned* (`S = load()`,
`S = Object.assign(blank(), parsed)` on restore), and ES import bindings are
read-only — an importing module cannot reassign one, so `state.js` cannot
simply `export let S`. Three documented ways out (export a container, use
accessors, or leave `S` in the shell). Currently the third, because the
genuinely dangerous logic — the migration — is already isolated and tested on
its own.

---

## Data, privacy and security

### "Where does the family's data live?"

On the device, in `localStorage`, as JSON. It is never uploaded to any server
of mine — there is no server of mine. Extraction calls go directly from the
browser to Anthropic's API.

### "localStorage? That's not durable."

Correct, and it's handled rather than ignored:

- **Never start empty.** If the saved data won't parse, the app does not fall
  back to a blank state — because the next save would overwrite the only copy.
  It quarantines the bytes, locks writes, and shows a recovery screen.
- **Rolling snapshots.** One per day, three kept, restorable from the UI.
- **Export/restore.** Full JSON backup to a file, plus a nudge if the user has
  never taken one.
- **Migrations.** A versioned schema with a guard for every step, tested for
  idempotence and for never dropping rows.

**The honest weakness:** iOS can evict web app storage under pressure, and
there is no cloud sync. `navigator.storage.persist()` is requested, but it is
a request. A family that never exports a backup and whose phone clears site
data loses their events. Multi-device sync is the natural next thing to build
and does not exist today.

### "The Anthropic API key is in the browser. Isn't that a security problem?"

Yes, and it deserves a straight answer rather than a deflection.

The key is stored in `localStorage` on the user's own device and sent directly
to `api.anthropic.com` with the `anthropic-dangerous-direct-browser-access`
header — the header is named that way by Anthropic precisely because this is
not the recommended production pattern.

Why it is defensible **here**: this is a single-family app, the key belongs to
the person typing it in, it is stored on their own phone, and it is sent to
exactly one origin — its issuer. There is no multi-tenancy, no other user who
could read it, and no server-side store to breach.

Why it would **not** be defensible in a product with real users: anyone with
device access reads the key, it can't be rotated or scoped centrally, usage
can't be metered per user, and an XSS bug becomes a key disclosure. The correct
production shape is a thin backend proxy holding the key server-side.

**That trade is deliberate and would be the first thing to change on the path
to shipping this to anyone else.**

### "What about XSS? You're building HTML with template strings."

Real risk, taken seriously. Every interpolation of user or model data goes
through `esc()`, which is tested against each injection route. Two structural
decisions back that up:

- Sheet button labels stay `textContent`. When icons were added, they were
  given a separate `icon:` field rather than allowing markup into labels —
  because those labels carry person names and event titles.
- Toast messages are `textContent` for the same reason.

**The honest weakness:** it's a discipline, enforced by review and tests,
rather than a framework that makes the mistake impossible. A single missed
`esc()` in a new template would be a hole. A framework with automatic escaping
removes that class of bug outright; that's a genuine argument against the
current approach.

---

## The AI layer

### "How do you stop it hallucinating dates?"

Prompt design, and it's specific rather than generic. The persona is modelled
on professional minute-taking, and **every rule exists because of a failure
that was actually observed**:

- *"Owner, task, deadline — an item missing a date is not an item"* → stops
  vague, unusable entries.
- *"Never invent clarity. A missing field is null. Inventing a plausible
  detail is the worst error you can make"* → the direct fix for inferred dates.
- *"A suggestion is not a decision"* → stops "maybe we'll do X" becoming a
  calendar event.
- *"Restraint vs elaboration"* → stops a whole dance week collapsing into one
  generic item.

**The honest weakness:** prompt discipline reduces hallucination, it does not
eliminate it. That's why nothing is written without the user reviewing it
first, and why every event keeps an `aiSource` field recording which model
read it — so a bad batch can be traced to a provider rather than guessed at.

### "How do you know the extraction is any good? Is there an eval set?"

Yes — `eval/cases.json` plus `tools/eval-extraction.js`. It runs each case
through a provider and scores the result against hand-labelled expected
events, reporting precision, recall and **per-field** accuracy.

Three design choices worth defending:

- **Wrong date is never a partial match.** An extracted event pairs with an
  expected one only if the dates are identical. A right-looking title on the
  wrong day is not a near-miss, it is the exact failure this app exists to
  prevent, so the scorer refuses to give it credit.
- **Hallucinations are reported separately**, not folded into precision. A
  missed flyer gets noticed; an invented event quietly gets trusted. It is the
  worse failure and gets its own number.
- **The benchmark reads the shipping prompt** out of `js/prompts.js`, so it
  can never measure something the app does not actually send.

The corpus covers the failure modes the prompt was written against: deadline
vs event, schedule grids, notes scattered away from the item, a time range,
a weekday that disagrees with its date, two items on one day, a vague date
that must NOT be resolved, and a source containing no events at all. The
scorer has 12 of its own tests, including a self-check that a perfect answer
scores perfectly — a benchmark you cannot trust is worse than none.

**The honest weakness, stated plainly:** the seed cases are synthetic —
written to cover known failure modes, not collected from real paperwork.
Ten real labelled flyers would be worth more than fifty invented ones, and
adding them is the obvious next step. The harness is built; the corpus needs
feeding.

Alongside it:

- A **provider comparison** that runs the same flyer through Anthropic and the
  local model side by side, forcing fallback off during the run so one
  provider can't silently answer for the other.
- An **8-stage self-test** for the local model that verifies the thing rather
  than assuming it: server reachable, model installed, text works, *thinking
  actually suppressed* (verified, not assumed), vision works, and extraction
  returns real JSON from a realistic dated sample.

Run it before and after any prompt change: `node tools/eval-extraction.js`
(or `--local <url> <model>` for the local provider, `--dry` to check the
scorer without spending anything). Scores land in `eval/last-run.json`, which
is committed so the history is visible.

### "Why support a local model at all?"

Cost and privacy — school paperwork contains children's names, schedules and
locations. A local vision model means that never leaves the house. It's
additive: Anthropic remains the default and is fully intact, with the local
option behind a setting and a fallback toggle.

The assistant is *displayed* as "Gordon" regardless of which model runs, but
the real model is shown wherever truth matters — Settings, the self-test, and
each event's provenance. A friendly name should never obscure what actually
processed your data.

---

## Quality and process

### "276 tests on a personal project — is that theatre?"

Judge it by what the tests caught, not the count. Several were written *after*
a bug reached production, and each one now fails the build on that exact
failure:

| Test | The bug it exists for |
|---|---|
| Fixed-position safety | A `transform` on an ancestor made `position:fixed` buttons anchor to content — the scan button vanished in production |
| Self-contained boot | The v8.1–v8.5 blank screen |
| Inlined copies match `js/` | Source and shipped artifact silently drifting |
| Every inline handler resolves | 94 inline handlers resolve against global scope; moving one into a module silently kills a button |
| Icon sprite integrity | A typo'd icon name renders a blank gap, no error |
| WCAG contrast, both themes | Caught two contrast failures that had already shipped |
| Undo restores byte-for-byte | Replacing `confirm()` with undo |
| Swipe intent | Edge zones belong to iOS's own gesture |

The contrast test is the clearest example: it computes real WCAG ratios from
the design tokens and **found two failures that were live in the app** —
caption text at 4.14:1 and a checkbox border at 1.8:1.

The refactoring tool has its own suite structured as **six oracles** drawn
from the refactoring-tools literature (Soares et al.; Daniel et al.) —
syntactic validity, conservation, overly-weak and overly-strong preconditions,
round-trip, order-independence. It found two real bugs in the tool on first run.

### "How do you verify what a test can't see?"

Three layers, because each catches what the others can't:

1. **`node tests.js`** — 276 source-level and behavioural tests.
2. **`tools/preview.js`** — renders every screen in a real browser, light and
   dark. Caught two icon bugs no Node test could see, including a CSS
   `:only-child` rule that silently mis-targeted every labelled button icon.
3. **`tools/a11y-audit.js`** — audits the *rendered* DOM. Found delete buttons
   whose accessible name computed to nothing at runtime, which the
   source-level tests had passed.

And then the installed PWA on a real phone, every release, because Chromium
is not WebKit and the Node sandbox cannot see rendering at all. That lesson
was expensive: the module tests passed by faking imports, and gave false
confidence right up until production went blank.

### "Accessibility 100 on Lighthouse only means it passed automated checks."

Correct — automated tools catch roughly a third of real accessibility issues.
Beyond the score: 44px tap targets (WCAG 2.5.5 AAA), visible focus via
`:focus-visible`, `prefers-reduced-motion` honoured, `aria-current` on the
active tab rather than colour alone, real `<label for>` on every input
(placeholders are not labels — they vanish on the first keystroke), a polite
live region so undo offers are announced, and focus moving to the content on
navigation.

One catch worth mentioning: the viewport carried `user-scalable=no`, blocking
pinch-zoom — a WCAG 1.4.4 failure. Mobile Safari ignores that flag in a
browser tab but **honours it in an installed web app**, which is exactly where
this app lives. Removed in v9.1.

**The honest weakness:** no testing with an actual screen-reader user. VoiceOver
was exercised by the developer, which is not the same thing.

---

## Design

### "Why did this look like a hobby project until recently?"

It did, and the specific tells were fixable: emoji used as UI chrome, ad-hoc
colours, no dark mode, plain-text empty states. All addressed across v8.8–v9.1.

The icon system is now a 40-symbol inline SVG sprite using `currentColor`, so
icons inherit state and theme with no icon-specific rules. Some emoji remain
**deliberately** — the reward stars, the celebration, and the example inside
the chore-title placeholder. Those are content, not controls, and the
distinction is encoded in a test's allow-list rather than left to memory.

### "You replaced confirmation dialogs with undo. Isn't that riskier?"

The opposite, and it's a deliberate call. A confirm dialog interrupts *before*
the fact and gets dismissed reflexively; undo costs nothing on the happy path
and is fully recoverable. It's safe here specifically because these deletes
were *already* soft deletes — undo is a flag flip, not a resurrection. Tests
cover "undo restores byte for byte" and "deleting a chore keeps the stars
already earned."

---

## The questions worth asking that nobody usually does

Have these ready; volunteering a weakness before it's found is stronger than
defending one afterwards.

1. **The benchmark corpus is synthetic.** The harness, scorer and per-field
   reporting are real and tested; the eight seed cases were written rather
   than collected. Real labelled flyers are the missing ingredient.
2. **No sync, no multi-device.** One phone, one copy, manual backups.
3. **Single-user threat model.** The browser-held API key is fine for a family
   app and wrong for a product.
4. **Escaping is a discipline, not a guarantee.** One missed `esc()` is a hole.
5. **~4,300 lines in one scope.** Shrinking, not shrunk.
6. **Chromium-verified, WebKit-shipped.** The automated visual and a11y checks
   run in Chromium; the app runs in an installed WebKit web app. Every release
   gets manual on-device verification because of exactly that gap.

---

## One-line framing if you only get a sentence

*"It's a zero-dependency offline PWA that turns school paperwork into calendar
reminders — and the interesting part isn't the AI, it's that every production
bug it ever had is now a test that fails the build."*
