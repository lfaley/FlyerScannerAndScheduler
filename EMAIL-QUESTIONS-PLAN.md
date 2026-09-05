# Ask Gordon about an email — plan

Status: **Phase 1 built (v10.7). Phase 2 built (v10.9).**
Written 4 Sep 2026 against v10.6, from research into what the app actually keeps.

Logan's words: *"I need to be able to ask Gordon questions about emails. Like
today I see something about yearbooks due by a date but I need to extract how to
order them too."*

---

## 0. What was actually true before this

Researched rather than assumed, with `file:line` for every claim.

- The watcher runs in `RAW_MODE`, so the queue holds a **reference only** —
  `{msgId, subject, from, received, chars, attachments}` (`gmail-watcher.gs:480-487`).
  The body comes from a separate `action=message` call (`:299-323`).
- The app fetches that body into a **loop-local `const`** (`index.html:8457`),
  reads it for dates, and drops it. **Nothing about the body reaches `S`.**
- What survives an email: the extracted **events**, the ids in
  `S.settings.seenMsgs`, and Problem Log rows carrying sender + subject.
- `emailReviews` and `lastEmailProblems` — the one-line gists — are
  module-level `let`s (`:7668`, `:7673`). **They die on refresh.**
- The assistant's prompt has no email domain at all: `buildAskPrompt` covers
  chores, lists and events only (`js/ask.js:195-233`).

**So the yearbook email contributed a deadline and threw the ordering
instructions away, and an email with no date in it vanished completely.**

The one good piece of news: `fetchMessage(msgId)` (`:8328`) can re-fetch any
message's full text and attachments straight from Gmail by id, so it is **not**
bounded by the watcher's 60-entry queue. The content is recoverable; what was
missing was a durable way to name which message.

## 1. Logan's decisions, 4 Sep 2026

| Question | Answer |
|---|---|
| How to reach the ordering details | **"What did this email say?" on the event** — re-fetch on demand, no email text stored |
| Scope | **Any email from a watched sender**, including ones that never produced an event |

The second answer is what makes Phase 1 necessary: a dateless email leaves no
trace today, so there is nothing to attach a question to.

## 2. Phase 1 — the durable reference (v10.7, BUILT)

- **`S.emails`** — a rolling index of `{id, subject, from, at}`. Four short
  fields, **no body**, so a backup export stays free of email contents.
- **`noteEmailSeen()`**, called from `extractFromRawItems` for **every** email
  **before** extraction runs — an email that fails to read is exactly the one
  worth being able to go back to.
- **`msgId` now persists on a saved event.** `extractFromRawItems` had always
  put it on the pending row and `saveReview` had always dropped it, so an event
  knew it came from "Email" and from whom, but not which message.
- **Two bounds**: `KEEP_EMAIL_INDEX_DAYS = 365` and `MAX_EMAIL_INDEX = 300`.
  Age stops a reference outliving any use for it; count stops a heavy month
  filling the save file. Whichever bites first wins. Pruned by `pruneData`.
- No migration needed: `arrayKeys` in `adoptParsed` is derived from `blank()`,
  so a new collection is covered the day it is added.

### Tests: 922 total, from 914. Ten mutations, one at a time.

**E1 was the one that mattered and it came back GREEN.** Deleting the
`noteEmailSeen` call from `extractFromRawItems` broke nothing, because every
test called the function directly — the unit was covered and **the wiring was
not**. The feature IS the wiring. Two behavioural tests were added that stub
`fetchMessage` and drive the real `extractFromRawItems`: one for an email that
yields nothing, one for an email that throws. E1 and E2 then both went red.

## 3. Phase 2 — the question (DESIGNED, NOT BUILT)

1. **`askAboutEmail(msgId)`** — `fetchMessage(msgId)`, then one model call with
   a prompt aimed at *what to do*: links, prices, order codes, who to pay, what
   to bring, deadlines. Not a summary — the actionable content.
2. **"What did this email say?"** on an event's action sheet, shown only when
   `e.msgId` is set.
3. **An Emails screen** listing `S.emails` newest first, so an email that never
   produced an event is still reachable. Same action on each row.
4. The answer is shown, not stored. Asking twice re-fetches.

### Open, and worth deciding before building

- **Where the Emails list lives.** Under Settings is discoverable but wrong —
  it is content, not configuration. A sub-screen off Events is closer to how it
  will be used.
- **Cost.** Every question is a fetch plus a model call. On Gordon that is free;
  on the Anthropic fallback it is billed, and today everything is falling back
  (see the open Gordon issue). The v10.5 monthly cap covers it either way.
- **Whether to keep the answer.** Not storing it keeps email content out of
  backups, which was the point of the Phase 1 shape. Storing it would make the
  answer available offline and searchable. These pull in opposite directions and
  the privacy side is the reason to leave it as it is.

---

## 4. Phase 2 as built (v10.9)

### The question it answers

The app already had an email brief — `reviewOneEmail`, which returns
`{from, gist, category, deadline, missedDate, suggestedAction}`. That triages:
*does this matter, is there a date, can I bin it.* Logan's problem is one step
past that. He knows the yearbook email matters; he needs **the link, the price,
the code, and what to do**.

So a second prompt, deliberately, answering a different question — but reusing
`emailBlocks`, `callAI`, `fetchMessage` and the same tolerant-parse pattern
rather than growing a second set of machinery.

```
{"what": one sentence, "steps": [...], "links": [...], "cost": ..., "codes": [...],
 "deadline": ..., "contact": ...}
```

The prompt's rules are the whole point: **copy links, amounts and codes exactly**,
and use null rather than inventing. A wrong order link is worse than no link.

### Where it appears

- **On an event** — "What did this email say?" in the event's action sheet,
  shown only when `e.msgId` is set. Offering it on a hand-typed event would be
  offering a button that cannot work.
- **An Emails screen** — `S.emails` newest first, including the emails that
  produced no event, which is the case the "any watched sender" decision was
  about. This is where a dateless email is finally reachable.

### The two decisions I made rather than asking again

- **Where the list lives:** off Events, not Settings. It is content, not
  configuration.
- **The answer is NOT stored.** It is re-fetched and re-read each time. Storing
  it would make it offline-searchable, and would also put email contents into
  the save file and therefore into every backup export — which is the exact
  thing Phase 1's four-field shape was designed to avoid. The screen says so:
  *"Read fresh from your mailbox just now. Nothing from the email is saved on
  this phone."*

### Rendering rules worth keeping

Sections appear only when the email actually said something. A `Cost: none` row
reads as a fact about the email and is not one. When the model answers in a
shape the parser cannot read, the raw reply is shown rather than an empty
answer — say nothing rather than something wrong.

### Tests: 932 from 926. Screens audited: 52 from 48. Seven mutations.

Both new screens are in the a11y table in both states (read and not-yet-read) —
the guard that fails the build on an unaudited sub-screen caught them
immediately, which is what it is for.

**P3 came back green**, and it was the important one. Persisting the answer into
`S` broke nothing, because the "never written to the save file" test seeded
`emailHowTo` directly and called `save()` — it never ran `askAboutEmail`, which
is where a persist would actually happen. A new test stubs `fetchMessage` and
`callAI`, drives the real function, and then greps the written blob for the
link, the price and the reference code. P3 then went red on the first needle.

### Still true, and worth repeating

Every question is a fetch plus a model call. On Gordon that is free; on the
Anthropic fallback it is billed — and while the local model is failing, that is
every one of them. The v10.5 monthly cap bounds it either way.
