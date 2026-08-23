# FlyerSnap — Handoff Notes

**Updated:** August 23, 2026 · **Live version:** v9.27 · **Tests:** 541 passing
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

Save the files into the repo folder, then:

```powershell
cd C:\Users\Logan\Desktop\Repos\FlyerSnap
.\deploy.ps1 "what changed"
```

`deploy.ps1` was rewritten in v9.25 for this workflow — the old one hunted for
a zip in Downloads and extracted it into `FlyerAndScheduler\flyersnap-pwa`, a
path that has not existed since the repo moved, so it could not have worked.
The new one checks the five things that have actually gone wrong here and
pushes only if every one passes:

1. **Tests** must end `N passed, 0 failed` — and the exit code and the printed
   summary must agree, so a runner that dies before printing cannot pass.
2. **`index.html` changed but `APP_VERSION` did not** — refuses.
3. **`APP_VERSION` moved but `sw.js` `CACHE` did not** — refuses. This is the
   one that silently leaves every installed phone on the old app.
4. **`gmail-watcher.gs` changed** — stops and waits, because that file does not
   deploy with the push; it must be re-pasted at script.google.com
   (Deploy → Manage deployments → pencil → New version → Deploy).
5. **The push worked but the site never updated** — after pushing it polls the
   live URL for up to three minutes (cache-busted, since Pages sits behind a
   CDN) and only then calls the deploy done.

Flags: `-DryRun` runs every check and pushes nothing; `-NoVerify` skips the
live poll; `-Repo <path>` for a different folder. Written for Windows
PowerShell 5.1 — no `&&`, no `Invoke-WebRequest` without `-UseBasicParsing`,
and `$ErrorActionPreference` deliberately left at `Continue` (under `Stop`, one
harmless stderr line from a PASSING node run aborts the script; that killed the
old version twice).

Manual equivalent, if the script is ever in the way:

```powershell
cd C:\Users\Logan\Desktop\Repos\FlyerSnap
node tests.js
if ($LASTEXITCODE -eq 0) { git add -A; git commit -m "<what changed>"; git push }
```

## Current state — August 2026

The repo moved from `FlyerAndScheduler\flyersnap-pwa` to `Repos\FlyerSnap`;
older docs may still name the old path, which is dead.

Docs in the repo, as they ACTUALLY exist (checked v9.25 — the list below was
stale and named three files that are not here):

| File | What it is |
|---|---|
| **CLAUDE.md** | Architecture and the rules. Read first. |
| **HANDOFF.md** | This file — state of play, per-version log, open items. |
| **EXPERT-QA.md** | Presentation prep; the clearest single summary of the project and where it is weak. |
| **UI-MODERNIZATION-PLAN.md** | The six-phase design work, with a progress log. |
| **AI-INTEGRATION-PLAN.md**, **ASSISTANT-PLAN.md**, **ASSISTANT-ACTIONS-PLAN.md** | How the AI features and the acting assistant were designed. |
| **FORM-UI-REVIEW.md** | The form-usability research behind v9.12. |
| **SECURITY-PLAN.md** | **ON HOLD** pending the admin console. §3 findings still valid. |
| **ADMIN-CONSOLE-CONTRACT.md** | What FlyerSnap exposes to the console being built. |
| **ERROR-REPORTING-PLAN.md** | The Firestore problem-backlog design that shipped in v9.24. |
| **ERROR-LOGGING-HANDOFF.md** | Written by the Admin Console session, 23 Aug. The three-app arrangement and the rules for agents touching it. Not authoritative — see below. |
| **ERROR-LOGGING-FINDINGS.md** | This session's reply to it: two findings. **Both accepted.** |
| **ERROR-LOGGING-RULINGS-REPLY.md** | The Admin Console session's rulings on those findings, and the authorisation for the v9.27 change. |
| **GMAIL-WATCHER-SETUP.md** | Apps Script setup for the watcher. |
| **DEPLOY.md** | Historical one-time GitHub Pages setup. |

Also present: **AI-INTEGRATION-PLAN.md**, **ARCHITECTURE-PLAN.md**,
**LOCAL-MODEL-PLAN.md**, **VISION-MODEL-SETUP.md**,
**RETIRED-CODE-REFERENCE.md**, and the **RECIPE-APP-\*.md** integration notes.

> An earlier draft of this table claimed four of those files did not exist.
> They do. The claim came from a working copy that was missing them, and it is
> recorded here because it is the same root cause as the v9.25 near-miss below:
> **a stale working copy looks exactly like a deleted file.**

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
| v9.23 | Failures say what to do about them; diagnostics send in one tap |
| v9.24 | Problems also report to the shared Firestore backlog (admin console shows them under a `flyersnap` badge) — `js/errorReport.js` + ERROR-REPORTING-PLAN.md |
| v9.25 | Report ids sort newest-first in the Firebase data browser (inverted-timestamp ids, all three apps) |
| v9.24 | Diagnostics share as text so Gmail appears; the fallback toast stopped blaming Anthropic |
| v9.27 | Automatic error reports are diagnostics-only — the email subject stops leaving the device (ruling 2026-08-23) |
| v9.26 | The app measures the local context window and plans against it; thinking actually turned off; router scorer stopped failing names the app resolves; refusals say why; a wrong-day event is no longer called a hallucination; self-test collapses |

**v9.24 — two bugs that were both about wording.** Logan reported "multiple
alerts that Anthropic couldn't be reached" while uploading two pages. The
diagnostics file he sent said the opposite: Anthropic answered both times, in
5.7s and 11.3s. What failed was the *local* model — `qwen3-vl:8b`, twice,
after 48s and 27s, with "the model produced only reasoning and no answer". The
toast read *"Local model unavailable — using Anthropic"*, and on a phone that
scans as "unavailable ... Anthropic". It now leads with the outcome: **"Read by
Anthropic instead — your local model did not answer"**. Same event, opposite
impression.

That failure also classified as `unknown`, the least useful thing a classifier
can say about something it can name exactly. It is now `thinking_only`, and its
message names the actual fix, which is not in this app: raise the model's token
limit, or use one that does not reason first (`qwen2.5vl`, `llama3.2-vision`).
The no-fallback path throws that same explanation instead of a flat "Local
model unavailable", so the advice appears wherever the failure does.

**And the share sheet.** Logan's sheet offered Outlook and not Gmail. iOS
filters it by file type and `application/json` is one many mail apps never
declare; the file now goes as `.txt` / `text/plain`, byte-identical inside
(`tools/diagnostics.js` parses by content, never by extension). **Copy** was
added beside **Save to Files** so a share sheet that will not list your mail
app is never the only way out. All three routes now build through one
`buildDiagnosticsFile()`, so they cannot drift apart.

**THE SHARED DATABASE IS NOW REAL, AND IT IS GROWING INTO SIGN-IN.**
`ERROR-LOGGING-HANDOFF.md` (Admin Console session, 23 Aug) documents what
FlyerSnap joined in v9.24: the `errorReports` collection in the recipe app's
Firestore project `meal-planner-f7f2f`. Three apps write to it, Logan reads it
in the Admin Console's Logs tab under a `flyersnap` badge, and the same database
is expected to carry **sign-in** later.

**Where authority lives, because it is not here.** The contract is
`ERROR-LOGGING-STANDARD.md` in `C:\Users\Logan\Desktop\Repos\AdminConsole`.
The Firestore rules are in the RECIPE APP's repo. This repo holds an
implementation and a summary. A shape change made here that the standard does
not know about fails as a **403 on a user's phone**, silently — the outbox
treats 403 as permanent and drops the report.

Verified against the caps that doc states (anyone may create; ≤24 keys; message
≤4000): a maximal FlyerSnap report is **13 keys**, and `redact()` caps `message`
at **400** characters. Both have wide margin. This also settles a question
SECURITY-PLAN.md left open — the anonymous-create posture is now documented, if
still not read from the rules file itself.

### Two places that doc and the code disagree

Both verified by running the code, not by reading it.

1. **`occurrenceCount` can never be sent.** ACCEPTED; the console now counts by
   `fingerprint` and shows a ×N badge per bug group. **No FlyerSnap change was
   wanted** — threshold re-queues were explicitly rejected, and the field stays
   optional and advisory. The doc lists it in the report
   shape. `logProblem` queues a report only in the `else` branch for a NEW
   problem (`index.html:5824`), where `count` is always 1; `toReportDoc` sets
   the field only `if(problem.count > 1)` (`js/errorReport.js:78`). A repeat
   increments `hit.count` and never re-queues — and the deterministic
   `reportId` means a later delivery would 409 anyway. **A bug that recurs 50
   times reports as one occurrence, forever.**

2. **"no event content, ever" is not what ships.** `index.html:6221` sets
   `label` to the email's subject line, and `:6236`/`:6240`/`:6245` pass it as
   `logProblem`'s `detail`, which becomes the report's `description`. `redact()`
   scrubs API keys and email addresses only, so the SENDER is redacted and the
   SUBJECT is not. Run against a realistic school email, what leaves the device
   is:

   ```
   message    : Email: [redacted]: No dates found in this email
   description: Braelyn's Field Trip Permission Slip - Maple Elementary
   ```

   A child's name and school, posted automatically to a shared database, with
   no opt-out UI (`S.settings.errorReportsOff` is read at `index.html:5872` and
   `:5889` and assigned nowhere — the handoff doc notes this is deliberate,
   since adding one touches the settings-hub tests). The local Problem Log and
   the diagnostics file carry the same text, but those are shared one tap at a
   time, by Logan, to a recipient he picks.

   **RESOLVED in v9.27.** Raised in the AdminConsole repo first, per Logan;
   both findings were accepted and the standard now records them
   (`ERROR-LOGGING-RULINGS-REPLY.md`).

   **The ruling: every field of an AUTOMATIC report is diagnostics-only.**
   Third-party or processed content never leaves the device automatically;
   `description` is for model names and status codes, never for the thing being
   processed. A deliberately user-filed report is the exception, on the one-tap
   consent model — FlyerSnap has no such path, so nothing is exempt.

   Implemented at the boundary, not the call sites, so the split is:

   | | email subject |
   |---|---|
   | Automatic Firestore report | **withheld** |
   | Local Problem Log | kept — it is the only thing saying WHICH email failed |
   | Diagnostics file | kept — shared one tap at a time, by Logan |

   Verified through the real `logProblem` → outbox path in a browser: two
   problems queued, no name or school in the payload, `qwen3-vl:8b-instruct-q8_0`
   still present.

   **The question I could not answer from here was the important one.** The
   recipe app had the same exposure *and wider* — its click-tracker recorded
   button labels verbatim (recipe titles, list items) and shipped them in
   `actionTrail` on every automatic report. Fixed on that side the same day.
   Asking beat assuming: one app's bug was three apps' bug.

**TWO AGENT SESSIONS WERE EDITING THIS REPO AT ONCE, and it cost two rebuilds.**
On 23 Aug both a Cowork session and a second Claude session wrote to
`C:\Users\Logan\Desktop\Repos\FlyerSnap` within minutes of each other. Each
had its own working copy, neither could see the other's, and each overwrote
`index.html` and `tests-modules.js` with a build derived from its own base. The
symptom on Logan's machine was a deploy that passed at 529 tests, then failed at
486 with three drift errors, with no edit in between — because the files under
it had changed.

Two commits both called themselves v9.25 (`e867988` and this one), which is why
this release is **v9.26**.

What made it recoverable rather than a merge nightmare: **everything in `js/`
is the source of truth and `index.html` is a build artifact.** Both sessions'
`js/` files survived side by side; only the inlined copy had to be rebuilt. The
drift and collision guards then proved the rebuild was complete — they fail the
moment a `js/` file is present but not inlined, which is exactly the state
`e867988` was committed in. **That commit does not pass its own test suite.**

**`deploy.ps1` now catches this before the tests do.** Step 3 compares every
changed file's mtime against the last commit's timestamp. A file you are about
to commit whose contents predate the commit you are sitting on was written
against a different base — so it almost certainly lacks what that commit added,
and committing it reverts the difference. It refuses by name, lists the files
with both timestamps, and says to merge at the `js/` layer rather than re-run.
Verified by reproducing the incident in a scratch repo: session A writes at
04:00, session B commits at 14:02, session A's deploy is refused.

The guard's own test was wrong first: it asserted `LastWriteTimeUtc` and
`git log --format=%cI` were present, and passed happily with the comparison
replaced by `if ($false)`. It now pins `$m -lt $headStamp` itself. That is the
third guard on this project to read the vocabulary around the logic instead of
the logic — see CLAUDE.md rule 21.

> **The rule, learned twice in one day:** one agent at a time per repo. If a
> second one has to run, it must re-read the files from disk immediately before
> writing, not trust the copy it started from. And when two builds collide,
> merge at the `js/` layer and re-inline — never pick one `index.html` over the
> other, because each one silently contains work the other lacks.

**v9.25 nearly deleted v9.24's error reporting, and the drift guard stopped it.**
Two v9.24s existed in parallel: `dd75b80` on `main` (Firestore problem backlog,
`js/errorReport.js`, 488 tests) and a separate one built in a session whose
working copy predated it. The second one's `index.html` therefore had no
inlined `errorReport.js` at all. Writing it over the repo would have removed a
shipping feature silently — the app would have booted, looked fine, and quietly
stopped reporting problems.

Nothing subtle caught it. `node tests.js` failed on **"the inlined copies match
js/ exactly"** and **"no inlined module declares a name the app already uses"**,
on Logan's machine, before the push — which is the entire reason those two
guards exist. The fix was a real three-way merge: `git diff 9c5dbed HEAD` gave
the errorReport change set, which applied to the v9.25 tree with only the two
version-stamp hunks rejected. 523 + 6 = **529 tests**, both branches intact.

> **The lesson, and it is a process one:** an agent's working copy is not the
> repo. Before writing files into it, compare against `HEAD` — a file that is
> merely *missing from the copy* is indistinguishable from a file that was
> *deliberately deleted*, and only one of those should ever be acted on.

**v9.25 — the three real causes, and the first measured numbers.**

**1. The window, not the model.** Ollama allocates **4,096 tokens** on any
machine with under 24 GiB of VRAM (his RTX 5060 Ti has 15.9). His flyer prompts
measured **2,327 and 2,346 tokens**, and FlyerSnap asked for **4,000** tokens of
answer. Prompt plus ask was nearly double the window: those calls were lost
before they were sent, and no model would have saved them. `js/local-limits.js`
now reads the real window from `/api/ps`, reads prompt sizes from the AI log
(`inTokens` is finally recorded for local calls — it never was), and **clamps
the ask to what is left**. On his exact numbers that is 1,641 tokens; Anthropic
answered those same two pages in 243 and 687, so the clamped call was winnable
all along. When the prompt nearly fills the window it refuses in a second
instead of burning three minutes, naming `OLLAMA_CONTEXT_LENGTH`. **`num_ctx`
is never sent** — Ollama's OpenAI-compatibility docs say the OpenAI API has no
way of setting context size, so this is detect-and-explain, never fix.

**2. Thinking was never off.** The request carried `think: false` from the day
the local provider shipped. `think` is a native `/api/chat` field and is **not**
in Ollama's supported-field list for `/v1/chat/completions`, so it was silently
ignored on **every call this app has ever made**. `reasoning_effort: 'none'` is
the field that endpoint accepts, and it is now sent. This is why a thinking
model kept thinking with the switch apparently on.

**3. The benchmark was lying, in the model's disfavour.** His first q8 run
scored 19/34. Seven of the eight parameter failures were entity names the app
resolves perfectly — "the bins" for a chore called "Bins", "shopping list" for
"shopping", "the dentist appointment". `resolveEntity` matches by containment
either way; the scorer demanded string equality. Corrected (`namesSameThing`),
the same run is **26/34 (76%)**. The loosened rule still fails a value that
names nothing in particular — "Move the recital to the 12th" as an event name —
which was a genuine failure in that run.

### Measured on qwen3-vl:8b-instruct-q8_0 (Aug 23)

| Benchmark | Result |
|---|---|
| **Reading** (the app's primary job) | **P 0.92 / R 0.92 / F1 0.92**, 8 cases in 21s. Titles 100%, times 83%, locations 75%. 1 missed and 1 invented, both in `schedule-grid` |
| **Routing** | intent accuracy **79%** (floor is 85%), 26/34 after the scorer fix |

**Reading is good enough to use.** Routing is not, and the shape of the failure
is specific: **six over-refusals** — plain write commands ("Dentist for Braelyn
next Tuesday at 3", "Permission slip is due Friday", "Olivia makes her bed every
morning for one star") coming back `unknown`. Not dangerous — zero destructive
escalations, zero missed refusals, zero invented parameters, and the four
ambiguous cases all correctly refused — but it will feel deaf. Both of those
runs predate the `reasoning_effort` fix, so **they are worth re-running**: a
model that was still silently thinking is not the model that ships in v9.25.

**The self-test screen can be shrunk.** One failed check prints its whole raw
error — a parse failure ran to 731 characters — which pushed the check that
actually failed off the top and buried the "Run again" button. Long details are
now clamped to three lines with **"Show all N characters"**, and when a run has
both passes and failures there is a **"Show only the N that failed"** filter.
Measured in the browser: 563px → 381px filtered, and 789px → 563px with one
error collapsed.

Two things it deliberately does NOT do. Nothing is truncated permanently —
`slice()` and ellipses are forbidden by a guard test, because on this screen the
text *is* the diagnostic. And the open/filtered state is a module-level `let`,
never `S`: it is one screen's preference for one run, and in `S` it would be
migrated, backed up, and shipped inside the diagnostics export. The open-state
is keyed against the FULL result list, so hiding the passing checks cannot
renumber the rows and silently open a different detail. Both states are in the
a11y audit (`selfTest`, `selfTest-filtered`).

**And the routing benchmark now says WHY it refused.** Six over-refusals with
`got: unknown` and nothing else is four different bugs wearing one face: no JSON
in the reply, an intent id that does not exist, a confidence below the 0.6
floor, or a required parameter dropped. `scoreCase` now carries `why` from the
validator's own reason string, `summarise` groups them under
`byRefusalReason`, the export keeps it and the results screen prints "refused
because: …". Guessing between four causes from an aggregate is how a benchmark
becomes decoration.

**The leading hypothesis, which that field will confirm or kill.** The routing
call asks for `max_tokens: 300`, and those runs were made while thinking was
still silently on. 300 tokens is not enough to reason and then emit JSON, so
`parseRoute` would find no object and `validateRoute` would reject with
"nothing usable came back". The timing supports it — 34 cases in 17.5s, ~514ms
each, which is a model stopping at a cap rather than finishing an answer. If
that is right, `reasoning_effort:'none'` fixes the over-refusals as a side
effect and the re-run should land well above the 85% floor.

Checked and ruled out first: `quickRoute` returns null for all six sentences,
so none of them was refused deterministically before the model ever saw it.

> **Next, in order:** re-run both benchmarks on v9.25 — the export will now name
> the refusal reason; run the reading one against Anthropic for a baseline;
> then, only if refusals persist, look at write-intent confidence.

**The model advice was wrong, and his own machine proved it.** v9.24 first told
Logan to switch to `qwen2.5vl` or `llama3.2-vision`. Reading his Ollama install
directly showed that is not the problem:

- `AppData\Local\Ollama\server.log`: *"template selection
  model=registry.ollama.ai/library/qwen3-vl:8b **renderer=qwen3-vl-thinking
  parser=qwen3-vl-thinking**"*, and the manifest layer is inherited
  `from: qwen3-vl:8b-thinking-bf16`. **The bare `qwen3-vl:8b` tag IS the
  Thinking edition.** Instruct is one tag away: `qwen3-vl:8b-instruct`.
- Same log: `llama_context: n_ctx = 4096`, against prompts of **2,327 and
  2,346 tokens**. Under 1,800 tokens were left for an answer the app asked to
  be up to 3,000 — the request could not have succeeded even from a model that
  did not think first. Ollama's default context, not a model property.
- Hardware, from `inference compute`: **RTX 5060 Ti, 15.9 GiB total / 14.4 GiB
  usable**, 31.7 GiB system RAM, CUDA 13. The 30B and 32B VL builds are 20–21GB
  and do not fit; `8b-instruct` is 6.1GB and `8b-instruct-q8_0` is 9.8GB, so
  both fit with room for a much larger context.

`explainError('thinking_only')` now names the tag and the context default
instead of sending him after a different model family.

> **Open, app side:** FlyerSnap asks for `maxTokens: 3000` without knowing the
> server's context length. When `prompt + maxTokens > n_ctx` the call is doomed
> before it is sent, and nothing in the app notices. The local self-test could
> read `n_ctx` from `/v1/models` or a probe call and say so.

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

**v9.23 — a failure that says what to do, and a way to send it.**

Logan, mid-session: *"i need a way to get the errors that occur on my phone to
be sent in… i am trying to have two pages uploaded… multiple times i got alerts
that anthropic couldnt be reached."*

His wording is not a string in the app, so the cause was not guessed at. What
IS true is that v9.13 is already live on his phone, so the AI log has recorded
every one of those calls with its `errorType`, HTTP status and a redacted
detail. **The answer to the incident is the export, not a theory.** Two things
were done to make that loop work properly.

**1. The alert was uninformative by construction.** The app classified every
failure correctly and then said `Extraction failed: Load failed` — the
browser's words for a symptom, with nothing to act on. `explainError()` in
`js/ailog.js` turns each of the ten error classes into a sentence that names
what to do, and the provider actually in use:

| what happened | what it used to say | what it says now |
|---|---|---|
| network | `Extraction failed: Load failed` | "Could not reach Anthropic. Check your connection and try again." |
| rate_limit | `Extraction failed: API error 429: …` | "Anthropic is busy or you have hit a rate limit. Wait a moment and try again — nothing was lost." |
| auth | `Extraction failed: API error 401: …` | "Anthropic rejected the API key. Check it in Settings → Gordon and AI." |
| timeout (local) | `Extraction failed: timed out…` | "A big photo on a slow machine can exceed three minutes. Try one page at a time." |

The raw provider string deliberately does NOT reach the alert — it can be long,
it can be JSON, and it is the one place a key could be echoed back. It stays in
the diagnostics file. A test asserts every class produces a message that tells
the user what to DO, and that a 401 body carrying `sk-ant-…` cannot leak into a
dialog.

**2. Diagnostics now send in one tap.** A download alone means finding the file
in Files and attaching it by hand, which on an installed PWA is several steps
and easy to abandon. `shareDiagnostics()` uses the Web Share API to hand the
file straight to Mail, Messages or AirDrop. Feature-detected, with the download
kept as "Save it to Files instead" — and a CANCELLED share is not an error, so
it must not fall through to a download the user did not ask for.

Verified in a browser with `navigator.share` stubbed: the shared file is
899 bytes, contains no events, no people and no key (seeded with "Zylphinar"
and "Wexlorb", both absent), reports `hasApiKey: true` without the key itself,
cancelling shares nothing, and removing share support falls back to download.

**A guard bug worth recording, because it is the second this session.** The
share test checked `/AbortError/` and matched the word inside the COMMENT
explaining the AbortError case — so deleting the actual handling still passed.
Comments are stripped before the check now, exactly as in the `sw.js` guard
that had the same flaw. **A guard that reads prose is not reading code**, and
this is now a pattern to watch for in this repo.

**Consolidation pass (still v9.22).** Six versions were stacked unpushed, so
rather than add a seventh feature: the new Settings pages were checked visually
and two printed their own title twice — "When something goes wrong" in the
header bar and again as the first line of the body, and "Gordon" under a page
already called "Gordon and AI". `diagnosticsSection(false)` now suppresses its
heading when the page already carries it.

**The boot guard had a hole, and it is closed.** The rule that keeps
`index.html` self-contained matched `import(` only at the START of a line, so
all three of these walked past it:

```
const m = await import('https://cdn/firebase.js');
p.then(() => import('./big.js'));
if(x) import('./y.js');
```

A dynamic import is not automatically wrong — unlike a static one it fetches
only when called, so a lazy post-boot dependency is a legitimate design (see
SECURITY-PLAN.md §3.5). What is wrong is one arriving by accident. There are
zero today, so zero is the assertion, and adding one has to be a deliberate act
that updates the test. Mutation-tested — and the first mutation I tried was
invalid JS (top-level `await` in a classic script), which killed the runner
before any test ran; a mutation that does not compile proves nothing.

`CLAUDE.md` was two versions stale in its header (v9.10, 368 tests) and is now
current, with the Settings-hub and Ask-everywhere rules written down where a
fresh agent will read them.

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

- `node tests.js` — 482 tests. Data safety, migrations, inline-handler
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
