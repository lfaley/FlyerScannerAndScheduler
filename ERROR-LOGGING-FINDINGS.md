# ERROR-LOGGING-FINDINGS.md — from the FlyerSnap session, for the Admin Console session

**Written 2026-08-23, against FlyerSnap v9.26.** A reply to
`ERROR-LOGGING-HANDOFF.md`. Two findings from reviewing FlyerSnap's side of the
shared `errorReports` arrangement against its code. Both were confirmed by
RUNNING the code, not by reading it.

Logan's decision, 23 Aug: **raise these here before changing anything.** The
standard is owned by the AdminConsole repo and both findings affect all three
writers, so FlyerSnap was left exactly as it was.

---

> ## RESOLVED 2026-08-23 — see ERROR-LOGGING-RULINGS-REPLY.md
>
> **Both findings accepted.** The standard now records them in §6
> "Rulings 2026-08-23".
>
> - **Finding 1** — ruling: every field of an automatic report is
>   diagnostics-only; processed content never leaves the device automatically.
>   The proposed guard was approved as written and **shipped in FlyerSnap
>   v9.27**, with the pinning test the caveat called for, mutation-tested three
>   ways (guard removed, classifier prefix renamed, call-site prefix renamed).
> - **Finding 2** — option 2 chosen: the console counts by `fingerprint` and
>   shows a ×N badge. **No FlyerSnap change**; threshold re-queues explicitly
>   rejected. "409 is a success" is now in the standard verbatim.
> - **Question 2 answered, and it mattered:** the recipe app had the same
>   exposure and wider — button labels (recipe titles, list items) shipped
>   verbatim in `actionTrail` on every automatic report. Fixed on that side the
>   same day.
> - **The unverified item is now verified** from `firestore.rules`: the quoted
>   caps were correct.
>
> The rest of this document is kept as the original finding, unedited.

---

## 1. Third-party content leaves the device in `description`

**Severity: this is a privacy decision, not a defect.** It contradicts a rule
the standard states, so it needs a ruling either way.

`ERROR-LOGGING-HANDOFF.md` §"What THIS repo implements" says:

> Text passes through `redact()` — the AI-log privacy rule applies unchanged: no
> event content, no prompt text, no API key, ever.

`redact()` (`js/ailog.js`, `KEYISH`) scrubs exactly four patterns: Anthropic
keys, OpenAI-style keys, `Bearer` tokens, and **email addresses**. It does not
touch names, schools, places or phone numbers.

The Gmail watcher passes the email's **subject line** as `logProblem`'s `detail`:

- `index.html:6221` — `const label = it.subject ? String(it.subject).slice(0,60) : '';`
- `index.html:6236`, `:6240`, `:6245` — `logProblem('Email: ' + sender, <msg>, label)`

`toReportDoc` copies `detail` into `description` (`js/errorReport.js:77`), and
`flushErrorReports` POSTs it. Run with a realistic school email, what leaves the
device is:

```
message    : Email: [redacted]: No dates found in this email
description: Braelyn's Field Trip Permission Slip - Maple Elementary
```

The **sender is redacted** (it matches the address pattern). The **subject is
not**. So a child's first name and school reach the shared database
automatically, with no opt-out UI — `S.settings.errorReportsOff` is read at
`index.html:5872` and `:5889` and assigned nowhere, which the handoff doc notes
is deliberate.

Worth being precise about why this is different from the diagnostics file, which
carries the same text: that file is shared **one tap at a time, by Logan, to a
recipient he picks**. This is automatic, to a database shared with two other
apps.

### Proposed change (FlyerSnap side), if the standard wants it

One line, at the boundary where data leaves the device rather than at the call
sites — so the subject stays in the local Problem Log, where it is the only
thing identifying *which* email failed.

```js
// js/errorReport.js, replacing line 77
if(problem.detail && !/^Email:/.test(String(problem.where || '')))
  docOut.description = redact(String(problem.detail)).slice(0, 400);
```

Checked against every `logProblem` call site in the app:

| `where` | `detail` today | sent after the change |
|---|---|---|
| `Email: office@school.org` | `Braelyn's Field Trip - Maple Elementary` | **withheld** |
| `Local model` | `qwen3-vl:8b-instruct-q4_K_M` | kept |
| `Scanning` | scan context | kept |
| `Assistant` | *(empty)* | n/a |

**Caveat:** `where` is built as `'Email: ' + sender`, so this keys on a string
convention, not a type. Renaming that prefix would silently stop the guard from
firing. It needs a test pinning it.

### Questions for the standard

1. Is `description` intended for **diagnostics** (model names, status codes) or
   for **content** (the thing being processed)? FlyerSnap currently sends both,
   and the two deserve different rules.
2. **Does the recipe app have the same exposure?** It also processes recipes
   from sources with names on them. Unverified from here — its repo is not
   connected to this session. Worth checking before this is treated as a
   FlyerSnap-only fix.
3. Should the standard say anything explicit about third-party content, given
   `redact()` provably does not cover it?

---

## 2. `occurrenceCount` can never be sent

**Severity: the console will silently misread every report as a one-off.**

`ERROR-LOGGING-HANDOFF.md` lists `occurrenceCount` in the report shape. It is
unreachable in FlyerSnap:

- `logProblem` queues a report **only in the `else` branch, for a NEW problem**
  (`index.html:5824`), where `count` is always `1`.
- `toReportDoc` sets the field **only `if(problem.count > 1)`**
  (`js/errorReport.js:78`).
- A repeat increments `hit.count` locally and never re-queues.
- Even if it did, `reportId` is deterministic per problem, so redelivery 409s
  and is dropped — by design, for dedup.

So a bug that recurs fifty times reports as one occurrence, permanently.

### What the console should do meanwhile

**Group by `fingerprint`, not by `occurrenceCount`.** The fingerprint is
`reportHash(where + '|' + message.replace(/\d+/g,'N').slice(0,120))` — the same
normalisation the local Problem Log groups by, and stable across occurrences.

### Options, if a real count is wanted

Both are shape-compatible; neither is implemented.

1. **Re-queue at thresholds.** Queue again at 2, 5, 10, 50… with the count in
   the id (`newestFirstId('fs', createdAt, id + '-x' + count)`) so it is a new
   document rather than a 409. Costs one write per threshold.
2. **Let the console count.** Reports already carry `fingerprint`; the console
   can count documents per fingerprint. Costs nothing in the apps, and is
   probably right if all three writers have the same gap.

Option 2 needs no app change in any of the three, which is why it is listed
second only because option 1 is what the field name implies.

---

## Not findings — verified sound

- **Boot rule holds.** The outbox reads `localStorage` at parse and schedules a
  timer only when something is queued; nothing fetches at boot.
- **Caps have wide margin.** Rules allow ≤24 keys and a 4000-char message; a
  maximal FlyerSnap report is **13 keys**, and `redact()` holds `message` to
  **400** characters.
- **409/403 handling is correct.** 409 means "already delivered" and 403 means
  "the rules will never accept this shape"; both stop retrying. Note for the
  console: **409 is a success, not an error.**
- **The reporter never reports itself**, and every path is try/catch-silent.

## Still unverified from this session

The Firestore rules themselves. They live in the recipe app's repo, which is not
connected here — the caps and the anonymous-create posture above are quoted from
`ERROR-LOGGING-HANDOFF.md`, not read from `firestore.rules`.
