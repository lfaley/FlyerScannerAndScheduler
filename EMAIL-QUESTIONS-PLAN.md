# Ask Gordon about an email — plan

Status: **Phase 1 built (v10.7). Phase 2 designed, not built.**
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
