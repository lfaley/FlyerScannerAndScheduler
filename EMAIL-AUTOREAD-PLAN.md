# Read the unreadable emails automatically — plan

Status: **plan only. No code changed by this document.**
Written 31 Aug 2026 against **v9.90**. Researched by four parallel agents reading
the shipped source; every claim below carries a `file:line`.

Goal, in Logan's words: *"instead of saying things couldn't be read just have
Gordon go ahead and extract the details like he would if I clicked the button…
I'll always want to know what it says."*

---

## 0. A correction I owe first

When I asked whether to cap the number of emails auto-read, I said the cost was
"compute you already own, because Gordon is your own box over Tailscale."

**That is not reliable, and the code says so.** An automatic pass can bill
Anthropic per email, in three distinct ways:

1. `index.html:4722` — `function aiProvider(){ … return S.settings.aiProvider === 'local' ? 'local' : 'anthropic'; }`
   **Anthropic is the default.** Local is only used when explicitly selected.
2. `index.html:4869` — `throw new Error('UNSUPPORTED_BLOCK:document');`
   **Any PDF attachment throws on the local model** and falls through to
   `callClaude` when fallback is on (`index.html:4790`). These are *failed*
   emails — disproportionately the ones carrying attachments.
3. `index.html:4743` — `if(S.settings.aiFallback && S.settings.apiKey) return null;`
   Signed out of Gordon with fallback armed, `aiSetupError()` returns null and
   **every call goes straight to paid Anthropic**, silently, per email.

The model on that path is `claude-sonnet-4-6` (`index.html:4417`), called with
vision blocks (`index.html:7880-7882`) and `max_tokens` 700 (`index.html:8158`).

So "no cap, read them all" may mean *N paid vision calls*, not *N free ones*.
That changes the question, so §6 asks it again with the real numbers.

---

## 1. What the button does today

`reviewEmailTrouble()` (`index.html:8098`) loops the distinct failed emails and
per email calls `fetchMessage()` then `reviewOneEmail()`, producing a brief:
sender, one-line gist, category, deadline, "this names a date", suggested action
(`index.html:8182-8190`), rendered by `emailBriefHtml` with **Add as event** and
**Dismiss this** buttons (`index.html:8205-8218`). That brief is exactly the
thing Logan wants to arrive without a tap.

---

## 2. Five things that make an automatic version unsafe as written

Each is a fact about the current code, not a prediction.

### B1 — It hijacks the screen, once per email
`index.html:8118` — `sub('busy', { msg:'Gordon is reviewing email ' + (i+1) + ' of ' + items.length + '…' …})`
and `index.html:8143` — `sub('review');` in the `finally`.
`render()` (`index.html:5669-5717`) resets scroll to 0 on any screen change
(`:5715`) and force-moves focus to `#main` (`:5713`). Automatic, that is the user
being thrown to the top of the page N times without asking.

### B2 — It opens with a blocking modal
`index.html:8100` — `if(setupErr){ alert(setupErr); return; }`
An `alert()` nobody asked for, on screen entry.

### B3 — There is no re-entrancy guard
`emailReviewBusy` is set (`index.html:8110`) but **never checked on entry**. The
only thing preventing a second run is the button's `disabled` attribute
(`index.html:9103`). A programmatic trigger bypasses that entirely.
`openEmailReviewNow()` (`index.html:7833`) has no guard either — double-tapping
"Review" already starts two batches today.

### B4 — Re-rendering destroys what the user is typing
The review screen carries an "Ask Gordon" textarea, `#reviewAskQ`
(`index.html:9115`). Its `oninput` is `autogrow(this)` (`:9119`) — it mirrors the
value **nowhere**. `renderReview` ends `m.innerHTML = html` (`index.html:9160`),
which rebuilds the textarea empty. The codebase already knows this:
`index.html:10457` — *"render() is NOT called here: it replaces #main, which
would destroy focus and the caret in the middle of a word."*

So progressive "fill the card in as each brief lands" **silently eats a
half-typed question**. The Ask screen solves it properly at `index.html:6514`
(`oninput="askState.draft=this.value;autogrow(this)"` plus re-emitting the value)
and that is the pattern to copy — as a prerequisite, not an afterthought.

### B5 — Every AI call writes the whole state to disk
`recordAiCall` ends in `save()` (`index.html:4597-4603`); `logProblem` ends in
`save()` and queues a remote report (`index.html:7440-7460`); `save()` runs
`snapshot()` then `JSON.stringify(S)` (`index.html:3960-3964`).
N emails = at least N full-state serialisations, more when a call falls back or
fails. There is **no rate limiting, queue, backoff or per-session cap anywhere**
in the codebase — verified by grep across `index.html` and `js/`. And
`fetchMessage` allows **60 s per email** (`index.html:7858`, `jsonpRequest(url, 60000)`).

---

## 3. The test hazard

If the trigger lives in `renderReview`, it fires inside three existing tests —
`tests-cases.js:2150`, `:2173`, `:2180` — unawaited. `tests.js:135` only awaits
promises returned by `test()` bodies, so a fire-and-forget run settles **after**
the test that started it and mutates `lastEmailProblems`, `emailReviews` and `S`
underneath later tests. Worse, `tests-cases.js:2629` pushes a bare string into
`lastEmailProblems` and never clears it.

**Therefore the trigger must not live in a render function.** It goes in
`openEmailReview` (`index.html:8046`) and at the end of `retryEmailTrouble`
(`index.html:8253`) — the two places a batch of failures actually arrives.

---

## 4. The disclosure obligation — and pre-existing drift

`CLAUDE.md:575` — *"every AI capability is declared in `js/ai-actions.js` with a
risk class"*. `CLAUDE.md:491` — *"`js/ai-actions.js` is the user-facing disclosure
list and must be updated too — it exists so the promise a user reads cannot drift
from what the code does, and it HAS drifted before."*

**The email-review capability is not declared there today at all.** The five
entries are `extract`, `ask`, `quickadd`, `act`, `clashes`
(`js/ai-actions.js:45-86`). `extract` covers pulling dates out of paperwork — the
call that already *failed* on these emails. The EA-style brief is a different
call with different output and no entry.

That is drift that exists before this change. Making the call automatic without
declaring it would ship a second, larger one. So a `js/ai-actions.js` entry is
**part of this work, not optional** — with `risk: RISK.READ`
(`js/ai-actions.js:27` — *"Reads data and answers. Changes nothing."*), which is
the honest class: the brief writes nothing to the user's data.

One thing the rules do **not** settle, and I will not pretend otherwise:
`js/ai-actions.js:16` says *"there is deliberately NO risk class meaning 'acts on
its own'"*, but its stated rationale at `:15` is scoped to **writes** ("nothing
writes without the user saying yes"). Whether an unprompted *read* falls under
that sentence is not resolved by the written text. I am treating it as: allowed,
but it must be disclosed in plain words.

Also worth knowing: `act.cannot` currently opens *"It never acts on its own."*
(`js/ai-actions.js:75`). It is scoped to the chat-box path, so it does not become
literally false — but it is the app's only user-facing sentence on the subject,
and it sits in the same Settings list a user would read after Gordon read their
inbox unasked. The new entry has to be explicit enough that the pair is not
misleading.

---

## 5. The shape of the change

| # | Change | Why |
|---|---|---|
| 1 | **Prerequisite:** mirror `#reviewAskQ` into a JS variable and re-emit it, copying `index.html:6514` | B4. Without this, any progressive render eats the user's typing. Ships as its own defect fix. |
| 2 | `if(emailReviewBusy) return;` at the top of `reviewEmailTrouble` | B3. Closes the hole an automatic caller opens, and the double-tap one that exists today. |
| 3 | `reviewEmailTrouble({auto:true})` — no `alert`, no `sub('busy')`, no `sub('review')` in the finally; re-renders only when `view.sub === 'review'`, re-checked after every `await` | B1, B2 |
| 4 | Trigger from `openEmailReview` and the end of `retryEmailTrouble`, never from a render function | §3 |
| 5 | Card copy follows the state: "Gordon is reading N emails…" → "N emails that didn't import — here's what they say". The button stays for anything unreviewed, as the recovery path if the automatic pass fails | Rule 28: the recovery path gets more care, not less |
| 6 | New `js/ai-actions.js` entry, `risk: RISK.READ`, saying plainly that it reads emails that failed to import, automatically, and what it does not do | §4. Also inline the module copy — guard `the inlined copies match js/ exactly` (`tests-modules.js:227`) |

Falls back to today's "subject — reason" text whenever AI is off or unconfigured
(`aiSetupError()` non-null), so the card never gets worse than it is now.

## 6. Acceptance criteria

Every guard mutation-tested by a real revert.

1. An automatic pass never calls `alert()` and never sets `view.sub` to `'busy'`.
2. A second automatic trigger while one is running does nothing.
3. Text typed into `#reviewAskQ` survives a re-render.
4. With AI off, the card renders exactly today's text and fires no call.
5. The trigger is absent from every `render*` function (source guard).
6. `js/ai-actions.js` declares the capability, and the inlined copy matches.
7. A failed automatic pass leaves the manual button reachable.
