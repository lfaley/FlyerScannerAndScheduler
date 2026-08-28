# FlyerSnap full-app code review — PLAN

**Status: DRAFT, not started. Written 27 Aug 2026, before any review work, so the
scope cannot quietly shrink later.**

Adapted from the methodology proved on `meal-planner-shoppin` (the portable
write-up Logan supplied, referred to below as **the source methodology**). That
document was written for a React 19 + Vite + TypeScript repo of ~60k lines. This
one is written for FlyerSnap, which is a different animal, and §2 says exactly
where the two diverge and why. **Nothing here is assumed to transfer; each phase
below was re-derived against this repo and carries its own measured baseline.**

Companion documents this review will produce: `CODE-REVIEW-FINDINGS.md` (the
evidence log) and additions to `CLAUDE.md` (which is already this project's
conventions file — see §6).

---

## 0. Why this review, and the stance it runs under

The trigger, 26 Aug: Logan asked *"How am I supposed to dismiss one of these
conflicts?"* about the clash banner. The answer was that he already could — two
different controls did it — but neither said so, and once dismissed there was no
way back. **The mechanism was correct and the experience was still broken.**

That is the same shape as the source methodology's favourites bug: not a crash,
not a failing test, just a thing that is quietly wrong and that no gate in the
project could ever have caught. And it raises the same follow-up question, which
is the entire reason for this review:

> If the tests are green and the feature works, what else is quietly wrong?

**The stance, taken verbatim from the source methodology and non-negotiable
here:** a single miss is not an incident, it is evidence of a CLASS of misses.
Every finding is followed not by a fix but by a sweep for every sibling of that
finding, and the sweep states how the class was enumerated so the enumeration can
be checked.

FlyerSnap has an unusual amount of evidence that this stance is correct. Four of
`CLAUDE.md`'s 24 burned-in rules (19, 20, 21, 23) exist because a *guard* was
wrong, not because a feature was. Rule 21 records the **third** time this project
shipped a test that read prose instead of code; a fourth occurred on 24 Aug. A
suite that has repeatedly certified its own blind spots is exactly the suite this
review has to be sceptical of.

---

## 1. Standing rules for every phase

The source methodology's eight rules are adopted as written. Restated here so a
cold-start agent needs only this file:

1. **No guessing.** Every claim grounded in a file opened, a command run, or a
   cited source. Cite `file.ext:line`. "Probably" / "should be" / "typically"
   means go and check. (Already `CLAUDE.md` rule 2.)
2. **Measure, don't assume.** Counts, sizes, dates — computed, never estimated.
3. **Validate a gate in EXACTLY the form the gate runs it.** See §7 — FlyerSnap's
   gate is `deploy.ps1` under **PowerShell 5.1**, and this rule has already cost
   this project once (`CLAUDE.md` rule 18).
4. **Audit the class, not the instance**, and state how the class was enumerated.
5. **Never loosen a test to make red go green.** (`CLAUDE.md` rule 4 says the same
   about the boot guard specifically; it generalises.)
6. **Real test data only** — fixtures copied verbatim from the repo, the corpus,
   or a real diagnostics export. Never invented.
7. **Say what was verified and what was not.** "Diagnosed from code, not
   reproduced on a device" is a required disclosure.
8. **A tempting shortcut is a signal to stop and ask.** Substituting a cheaper
   method and reporting it as the instructed one is the worst possible failure,
   because it looks like success.

Four more, specific to this repo, each traceable to a real incident:

9. **Mutation-test every guard this review adds.** Not "the test passes" —
   *break the thing it guards and watch it fail.* (`CLAUDE.md` rule 21, four
   occurrences.)
10. **Re-read from disk immediately before writing.** An agent's working copy is
    not the repo; a file missing from the copy looks exactly like a file deleted
    on purpose. (`CLAUDE.md` rules 19 and 20. This bit twice during this session
    alone — the working copy was stale at v9.37 when HEAD was v9.38, and again at
    v9.39 when HEAD was v9.58.)
11. **Never remove or replace a feature without asking Logan.** Add alongside.
    (`CLAUDE.md` rule 1.) A review is not a licence to delete.
12. **One agent at a time in this repo, for the duration.** (`CLAUDE.md` rule 20.)
    A review that merges with a concurrent session cannot claim its enumerations
    are complete.

---

## 2. What is different about FlyerSnap — read this before reusing any phase

The source methodology's phases assume things FlyerSnap does not have. Taking
them at face value would produce a review that looks thorough and checks nothing.

| The source methodology assumes | FlyerSnap's reality | Consequence for this plan |
|---|---|---|
| A build step (Vite), modules resolved at build time | **No build step.** `js/*.js` is the source of truth; `index.html` carries *inlined copies*, and drift tests enforce sync. Nothing may fetch to boot (`CLAUDE.md` rule 4) | P1 becomes a **drift + reachability** audit across two layers, not a tree-shake |
| TypeScript + a typechecker | **No TypeScript.** Plain ES5/ES2015 script | The source's single highest-yield P7 finding (*"the typecheck never included test files"*) **has no analogue here.** Do not fake one |
| eslint, CI | **Neither exists.** The gate is `node tests.js`, run by `deploy.ps1` on Logan's machine | P9's prevention guards must be *tests*, since there is no lint layer to put them in |
| A database with 40 methods and real concurrent writers | **`localStorage` + a single-threaded JS app.** No DB, no worker, no server writer | The source's lock-ordering law does **not** map. What *does* map is read-modify-write **across an `await`**, and **two PWA instances** on the same origin. See P2 |
| ~60k lines, one repo | **22,063 lines total**, of which 10,493 are `index.html` and 7,031 are tests | Expect a far smaller P1 yield than the source's 53k deleted lines. If a phase reports a huge yield here, suspect the method |
| One surface | **Four surfaces that must agree**: the app, `gmail-watcher.gs` (Google Apps Script, pasted by hand — it does *not* deploy with the push), the Gordon proxy (`GordonAI` NSSM service), and the meal-planner app sharing one Ollama | A cross-surface contract phase is **mandatory**, and it is where this session's two worst bugs lived. Folded into P3 |
| Instrumented coverage available | **Not wired.** The suite runs inside a hand-rolled `vm` sandbox (`tests.js`) | P6 must **not** promise a coverage percentage until a tool is actually wired and proven. State this rather than estimating |

Two things FlyerSnap has that the source did not, both of which earn their own
phase:

- **A documented history of dishonest guards.** Hence P8 is expanded, not
  optional.
- **A user-facing surface that is the whole product.** The trigger for this
  review was a UX defect with no code defect behind it. Hence P7, which the
  source methodology has no equivalent of.

---

## 3. The phases

Each phase is one complete pass over the whole codebase through **one lens**.
Review by bug class, not by file — a bug class is what a reviewer can hold
completely in mind; a file is not.

Run them **one at a time**, in order. Each phase's output is context for the next.

### P1 — Reachability and drift
**Question:** what ships that nothing reaches, and what has drifted out of sync?

**Method, enumerated:**
- Every `export` in `js/*.js` (22 modules) traced to a real non-test importer.
- Every one of the **96** names in `Object.assign(window, {…})` traced to a real
  inline handler in the shipped file.
- Every one of the **203** `onclick="…"` handlers traced to a defined global.
  *(A handler naming a function that is defined but not exported is a button that
  silently does nothing — the exact hazard `CLAUDE.md` rule 23 was written for.)*
- Every `js/*.js` file diffed against its inlined copy in `index.html`.
- Every `tools/wire-*.py` checked for whether its anchors still exist. A wire
  script whose `rep()` targets are gone is a script that will fail loudly next
  time — better to know now.

**Expected yield: low.** Say so if it is low; a phase that finds nothing and says
so honestly is a result.

### P2 — Write-path and persistence audit
**Question:** can a write be lost?

The source methodology calls this the highest-yield phase and says to run it
first if only one phase is run. Its *mechanism* does not transfer (no DB, no
threads); its *question* transfers completely.

**Method, enumerated:**
- All **88** `save()` call sites, and all **46** direct `S.settings.* =`
  assignments. For each: is it a read-modify-write? Is there an `await` between
  the read and the write? *(That is FlyerSnap's version of an interleaving: an
  `await` yields to the event loop, and a timer, a JSONP callback or a render can
  run in the gap.)*
- Every `async` function that touches `S` — the email import path, the AI
  extraction path, the export queue, the backup/restore path.
- **Two instances of the installed PWA on the same origin.** `save()` writes the
  whole blob; a second tab that loaded earlier and saves later clobbers
  everything the first tab did. Determine whether this is real, and if so whether
  it is worth guarding.
- The **cross-surface** write paths, which are the ones already known to bite:
  the watcher's `SEEN`/`QUEUE` Script Properties versus the app's
  `S.settings.seenMsgs`. Two independent "already handled" lists, neither aware
  of the other.

**Deliverable:** the full list with a verdict per item, before any fix.

### P3 — One fact, one place (including across surfaces)
**Question:** is any single fact stored or derived in more than one place?

Two truths is a guaranteed future bug, because nothing keeps them equal.

**Already-proven instances, which seed the class:**
- The Gordon **model tag** lived in four places in the app and disagreed with a
  fifth in the meal planner. Fixed v9.37–v9.38; the fix was a guard test pinning
  all four together. *This is the template for what a P3 fix looks like.*
- The **queue entry shape** was defined once in `gmail-watcher.gs` and once in
  `index.html`, and the two disagreed about whether an entry has a `date`. The
  watcher deleted every message reference it created. Fixed v9.39.

**Method:** for every user-visible datum and every cross-surface contract
(queue item shape, sender list, model tag, auth token, error-report schema,
`ADMIN-CONSOLE-CONTRACT.md`), list every place it is stored or derived. Collapse
to one, or pin the copies together with a guard that fails on drift.

### P4 — Silent failures
**Question:** what fails, or succeeds pointlessly, without telling anyone?

**Method, enumerated:** all **108** `catch` blocks (**97** in `index.html`, **2**
in `js/`, **9** in `gmail-watcher.gs`), each classified as:
(a) genuinely ignorable, (b) should warn, (c) **a user's action failing
invisibly** — category (c) is the bug.

Plus a FlyerSnap-specific sibling the source methodology has no name for:
**computed-then-discarded diagnostics.** Verified instance:
`fetchEmailQueue()` builds a full `report` string — *"Queue: 12 item(s)… Offered:
3. Skipped — already imported: 9…"* — and **both** callers destructure only
`{ fresh }` and throw it away (`index.html:6387`). Had it been on screen, the
watcher bug above would have been a five-minute problem. Enumerate every other
value computed for a human and never shown.

Also: audit `logProblem()` coverage. A failure that reaches no `catch` *and* no
Problem Log entry is invisible twice over.

### P5 — `index.html`, read top to bottom
**Question:** what is wrong inside the file nobody re-reads?

**10,493 lines.** Read deliberately, in numbered slices, no skimming. The source
methodology says this phase is slow and boring and finds the most *interesting*
bugs; roughly a third of its total time went here and to writing tests, and it
records that ratio as correct rather than wasteful. Budget accordingly.

**Rule:** if a slice gets skimmed, say so in that turn. Method drift — starting
line-by-line and sliding into pattern-matching — is the specific failure to watch
for (§8).

### P6 — One-way doors *(new; not in the source methodology)*
**Question:** what can the user do that they cannot undo, see, or reverse?

This is the class the trigger finding belongs to, and it is **already enumerated
and confirmed to have at least two members**:

| Key | Written at | Read at | Undo? | Listing? | Clear? |
|---|---|---|---|---|---|
| `settings.dismissedConflicts` | `index.html:5675` | `:5527`, `:5554` | **no** | **no** | **no** |
| `settings.notDuplicates` | `index.html:7598`, `:7657` | `:7588`, `:7648` | **no** | **no** | **no** |

Both silence a warning **permanently**, from a single tap, with no route back
short of editing storage by hand. `settings.seenMsgs` is the same *shape* but is
**not** a defect — `forgetImportedEmails()` (`index.html:6848`) clears it and the
count is shown in Settings. That contrast is the standard: **suppression is fine;
suppression with no way back is the bug.**

**Method:** enumerate all **24** `S.settings.*` keys and every boolean the app
sets on a record (`deleted`, `handled`, `exported`, `done`, `dirty`). For each,
answer three questions: can the user undo it immediately, can they see what they
have suppressed, can they clear it? Any key answering "no" three times is a
finding.

Cross-check against `CLAUDE.md` rule 22 (*every object needs a path that does not
go through the AI*) — this is its mirror image: **every suppression needs a path
back.**

### P7 — Affordance and discoverability *(new; not in the source methodology)*
**Question:** can the user tell what a control does, and find it at all?

The trigger finding was *two* controls that did the identical thing — a large
green "Keep both — this is fine" and a bare ✕ — with the word "dismiss" appearing
nowhere on screen. Both call `dismissConflict()` with the same key.

**Method:** enumerate every consequential control in the app and check:
- Does it have a **visible** label, not only an `aria-label`? *(The existing a11y
  suite checks accessible names and passes on this one — the ✕ has
  `aria-label="Dismiss this warning"`. The suite has no notion of a visible
  label, so this class is currently unguarded.)*
- Do two controls do the same thing under different names?
- Is it reachable, and in how many taps? *(Precedent: the watched-senders manager
  was believed lost when the Settings hub landed; it had moved two levels down
  and is hidden entirely unless `watcherConfigured()`.)*
- Is a destructive control distinguishable from a benign one?

The **12** `confirm()` calls and **11** `Undo` toasts are the starting inventory:
the app deliberately uses both patterns, and which one applies where should be a
stated rule, not an accident. (v9.59's `keepOnlyEvent` uses both, on purpose,
because it is the only control where the row you tap is not the row that
disappears.)

### P8 — Is the suite honest?
**Question:** would these **623** tests fail if the code were wrong?

FlyerSnap's suite is large and its culture is good, which is exactly why this
phase matters: **a big green suite is a strong claim, and this project has been
wrong about that claim at least four times.**

**Method:**
- Enumerate every test that inspects **source text** rather than executing code
  (`html.includes(…)`, `/regex/.test(src)`, anything reading `deploy.ps1`,
  `gmail-watcher.gs`, or `index.html` as a string). For each: does it pin the
  **operative expression**, or a comment, a label, or a variable name?
- **Mutation-test them.** Break the guarded thing; the guard must go red. A guard
  that survives its own mutation is decoration.
- Find tests that assert tautologies, tests never reached, and any file the
  runner does not actually load.
- Check the drift/collision guards specifically — they are load-bearing
  (`CLAUDE.md` rules 19–20) and nothing guards *them*.

**Do not** claim a coverage percentage unless a coverage tool is wired and its
output is shown.

### P9 — Prevention
**Question:** what stops each class recurring?

For every class found in P1–P8, add a mechanical guard — and since there is no
lint layer, the guard is a test, mutation-tested per rule 9.

**Convention rules go into `CLAUDE.md`, not a new file.** That file already holds
24 numbered rules, each naming the bug that justifies it, and it is what agents
actually read. A rival `CONVENTIONS.md` would be a second source of truth, which
is the exact defect P3 exists to remove.

---

## 4. Depth standard

- **Enumerate, never sample.** State the count so completeness is checkable:
  88/88 `save()` sites, 108/108 `catch` blocks, 24/24 settings keys, 96/96 window
  exports, 22/22 modules.
- **Every claim carries `file:line`.** A finding without a location is a rumour.
- **Every number measured.** The baseline in §3 was measured on the working tree
  at **v9.59** (`623 passed, 0 failed`), not estimated. Re-measure at the start of
  the review; if a number has moved, the tree moved under you (rule 10).
- **Every fix gets a test that fails without the fix**, and the failure is
  demonstrated, not asserted.
- **Every phase ends with an entry in `CODE-REVIEW-FINDINGS.md`, including the
  corrections.** A findings log with no self-corrections is a marketing document.

---

## 5. Findings already in hand

Carried in so the review starts from evidence rather than a blank page. All
verified in the repo at v9.59.

| # | Finding | Class | Where | Status |
|---|---|---|---|---|
| S1 | `dismissedConflicts` written once, never cleared, no undo, no listing | P6 | `index.html:5675` | **open** |
| S2 | `notDuplicates` — identical shape | P6 | `index.html:7598, :7657` | **open** |
| S3 | ✕ and "Keep both" do the same thing; neither says "dismiss" | P7 | `index.html:5541, :5589` | **open** |
| S4 | `fetchEmailQueue()` builds a diagnostic report both callers discard | P4 | `index.html:6387` | **open** |
| S5 | Watcher queue trim deleted every message reference it created | P3 | `gmail-watcher.gs:541` | fixed v9.39 — *class not yet swept* |
| S6 | Gordon model tag drifted across four sites plus a fifth app | P3 | — | fixed v9.37–38 — *class not yet swept* |
| S7 | Guard read prose, not code (4th occurrence) | P8 | `CLAUDE.md` rule 21 | *class not yet swept* |

S5–S7 are marked **"class not yet swept"** deliberately: each was fixed as an
instance. Under §1 rule 4 that is only half the work, and finishing it is what
P3 and P8 are for.

---

## 6. Deliverables

1. **`CODE-REVIEW-PLAN.md`** — this file. Approved before work starts.
2. **`CODE-REVIEW-FINDINGS.md`** — the evidence log. Per finding: what, where
   (`file:line`), how it was proven, what changed, what test now guards it, and
   any correction to an earlier claim.
3. **`CLAUDE.md`** — extended with the new rules, each naming its bug. *(Not a
   new conventions file — see P9.)*
4. **`HANDOFF.md`** — updated as the single source of truth for state and
   backlog, with superseded banners on any older doc the review contradicts.
   *(`MEAL-PLANNER-MODEL-HANDOFF.md` already carries one; that is the pattern.)*
5. **A cold-start handoff summary** — enough to resume without re-deriving
   anything.

---

## 7. Gates — and validating them in the form they actually run

FlyerSnap's gate is not CI. It is:

```powershell
cd C:\Users\Logan\Desktop\Repos\FlyerSnap
.\deploy.ps1 "what changed"
```

which runs `node tests.js`, refuses a push where `index.html` changed without
`APP_VERSION` moving or `APP_VERSION` moved without `sw.js`'s `CACHE` moving,
stops for `gmail-watcher.gs`, and polls the live URL afterwards. `-DryRun` checks
everything and pushes nothing.

Two things follow, both already burned in as `CLAUDE.md` rule 18:

- `deploy.ps1` is written for **PowerShell 5.1**. A test run under 7.x will not
  reproduce its failures. Guard tests forbid `&&`, `Invoke-WebRequest`, and
  `$ErrorActionPreference = "Stop"` for exactly that reason.
- **`gmail-watcher.gs` does not deploy with the push.** It is pasted by hand at
  script.google.com. Any P3 finding that spans app and watcher has *two* release
  steps, and the review must say so every time.

The review runs in an agent sandbox; the gate runs on Logan's machine. The loop
is: agent edits → Logan runs one command block → Logan pastes failures. Write
command blocks that are copy-paste runnable and lead with `cd`.

---

## 8. Warning signs the review is going soft

Watch for all of these; every one was observed at least once in the source run,
and several have precedent in this repo.

- A summary saying "reviewed all X" without stating how X was enumerated.
- A fix with no test, or a test written after the fix that never saw it fail.
- A guard that reads a comment, a label, or a variable name instead of the
  operative expression. *(Four occurrences here. This is FlyerSnap's signature
  failure.)*
- A finding phrased "should be fine" / "likely unaffected".
- A findings log with zero self-corrections.
- A new module added but not wired in the same batch.
- **Method drift** — starting item-by-item and sliding into batch
  pattern-matching. If the method changes mid-phase, say so in that turn.
- **Working from a stale copy.** Twice in one session here. Re-read from disk
  before writing, every time.
- Deleting something because it looks unused. `CLAUDE.md` rule 1: ask first.

---

## 9. Cost, honestly

The source run took one very long session driven by repeated "continue", plus a
follow-on session for data and documentation. FlyerSnap is roughly a third the
size, but P5 (10,493 lines read deliberately) and P8 (mutation-testing an
existing 623-test suite) are both *heavier* per line than the source's equivalents
— P8 especially, because the source had no comparable body of text-reading guards
to re-verify.

Expect several findings to be about the review's own tooling. That is normal and
it is valuable; budget for it rather than treating it as a detour.

---

## 10. The prompts, one per turn

Kickoff, to set the standard before anything else:

> Full-app code review of FlyerSnap, following `CODE-REVIEW-PLAN.md`. Standing
> rules for every phase: no guessing — read the code or measure before claiming
> anything, and cite `file:line`. Validate any gate command in exactly the form
> `deploy.ps1` runs it, under PowerShell 5.1. When you find a bug, audit the
> whole CLASS, don't fix the instance, and tell me how you enumerated the class.
> Mutation-test every guard you add. Re-read from disk before writing — the repo
> moves. Never remove a feature without asking. Tell me explicitly what you
> verified versus only diagnosed. Confirm the baseline numbers in §4 still hold,
> then stop.

Then one message per phase, P1 through P9, using the **Method** paragraph of that
phase as the instruction. Do not batch them.

Wrap-up:

> Update all documentation: `HANDOFF.md` as the single source of truth, superseded
> banners on anything the review contradicts, new rules appended to `CLAUDE.md`
> each naming its bug, and a cold-start handoff summary. Make the handoff notes
> immaculate.

---

## 11. Open questions for Logan before starting

1. **Scope of the surfaces.** Does the review cover `gmail-watcher.gs` and the
   Gordon proxy, or the app only? The two worst bugs found this month were
   cross-surface, so the recommendation is to include the watcher. The proxy
   lives in the recipe repo and is another agent's territory.
2. **P5 depth versus time.** 10,493 lines read top-to-bottom is the single
   largest cost in the plan. Worth confirming that is wanted before it starts,
   rather than abandoning it halfway.
3. **Coverage tooling.** Wire a real coverage tool for P6, or state plainly that
   coverage is unmeasured? The plan currently says "do not fake a number".
4. **Freeze.** `CLAUDE.md` rule 20 says one agent per repo. A review whose
   enumerations must stay valid needs the other sessions paused while it runs.
