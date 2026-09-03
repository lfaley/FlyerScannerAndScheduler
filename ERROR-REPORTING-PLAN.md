# ERROR-REPORTING-PLAN.md — remote error reporting (v9.24)

**Status:** implemented v9.24 (2026-08-22). **What:** FlyerSnap's side of the family-wide
error-logging standard — `ERROR-LOGGING-STANDARD.md` in the AdminConsole repo (approved by
Logan 2026-08-22). Every problem that lands in the local Problem Log is also queued to the
shared Firestore `errorReports` collection, where the admin console lists it under a
`flyersnap` badge, filterable per app.

## Why this shape

The app already has the two hard parts. **Capture:** window `error` +
`unhandledrejection` handlers and every meaningful `catch` funnel into `logProblem()` —
one function, already deduping repeats by shape (`where|message` with digits collapsed)
and persisting to `S.problems`. **Privacy:** `redact()` in `js/ailog.js` already strips
keys, bearer tokens and email addresses, and the Problem Log's text is already written to
be shareable (it ships in the diagnostics file). So remote reporting is one hook in
`logProblem` plus delivery plumbing — no new capture surface, no new privacy decision.
The ADMIN-CONSOLE-CONTRACT.md §6 called shipping problem/diagnostic data "a much smaller
decision than syncing the app state"; this is exactly that smaller decision.

## What was built

- **`js/errorReport.js` (new, pure, tested):** builders only — problem → v2-contract
  report doc (`app:'flyersnap'`, severity, fingerprint, standalone, occurrenceCount),
  doc → Firestore REST typed `fields`, and the endpoint URL. Message/description pass
  through `redact()`. ≤24 keys (the rules cap after the 2026-08-22 bump, deployed from
  the recipe-app repo which owns `firestore.rules`).
- **Glue in `index.html`** (next to the Problem Log): `queueErrorReport(problem)` —
  called from `logProblem` for each NEW problem — writes a localStorage outbox
  (`flyersnap-error-outbox`, cap 20) synchronously FIRST, then `flushErrorReports()`
  delivers by plain `fetch` POST to the Firestore REST API. No SDK, nothing at boot
  (constraint #4 holds: the boot-time flush is scheduled only when the outbox is
  non-empty, i.e. a previous page died mid-write). Offline or a dead Firestore just
  leaves entries queued for next launch. 403 (rules rejected) drops the entry —
  retrying forever would not help; 409 (already delivered) clears it.
- **Delivery is anonymous by design:** Firestore rules let anyone CREATE a shape-valid
  report and nothing else — the app cannot read, list, or edit the backlog, so a
  compromised page could at worst add noise, never read anything.

## Deliberately NOT built

- No UI toggle yet — opt-out exists as `S.settings.errorReportsOff = true`; adding a
  visible control touches the settings hub's reachable-controls test and a11y SCREENS,
  so it's its own small change if Logan wants it.
- No stack traces, no event/list/chore content, no prompt text, no API key — same
  non-negotiable as the AI log. Reports carry only what the Problem Log itself holds,
  post-`redact()`.
- No follow-up docs on repeat occurrences (logProblem already collapses repeats
  locally; the first report ships, the local `count` keeps counting). Revisit if the
  console needs live counts.

## What could go wrong, and the answer

- **Report loop** (reporter fails → reports itself): nothing in the glue calls
  `logProblem`; every path is try/catch-silent.
- **Firestore outage / no network**: outbox holds ≤20; app unaffected (constraint:
  the app must keep working with no network — nothing here blocks or boots).
- **Test sandbox**: the glue is inert under `node tests.js` (no `location`, stub
  `fetch`, empty outbox → no boot timer), and the pure module is tested directly.
- **Drift**: `js/errorReport.js` is auto-covered by the existing "inlined copies match
  js/ exactly" guard.

## Verified

`node tests.js` — full suite green including 6 new tests: contract shape + key cap,
redaction (an email in problem text never ships), fingerprint grouping, REST field
typing, endpoint targeting, and a comment-stripped guard that `logProblem` still queues
remote reports (mutation-tested by removing the call).

---

## The retry rule was wrong, and it killed the reporter (v10.0)

### What was shipped

```js
if(res && (res.ok || res.status === 409 || res.status === 403)){
  errorOutboxWrite(...filter out this id...);
} else {
  return;   // transient (5xx, no status) -- keep for the next flush
}
```

Everything that was not 2xx, 403 or 409 counted as transient. A 400 is not
transient, and the `return` was inside the loop over the outbox.

### Measured, against the shipped code

Outbox seeded as `[bad-1 (answers 400), good-1 (answers 200)]`:

```
pass 1 tried: ["bad-1"]
pass 2 tried: ["bad-1","bad-1"]
pass 3 tried: ["bad-1","bad-1","bad-1"]
outbox after three passes: BOTH still present
```

Two defects, not one:

1. The malformed report was re-sent on every flush and every boot, forever.
2. **`good-1` was never attempted at all.** The `return` exits the whole
   function, so one report the server will never accept blocks every report
   behind it. Error reporting stops at the first malformed document and stays
   stopped — the thing you would rely on to notice a problem, quietly broken.
   That is CLAUDE.md rule 28 in its purest form.

The outbox cap (`ERROR_OUTBOX_MAX = 20`, keeping the LAST 20) eventually evicts
a stuck head entry — but only after twenty further *distinct* problem shapes,
because `queueErrorReport` fires on a new key, not on a repeat. In practice that
is a long time with reporting dead.

### What the research says

Firestore publishes an error table with a "Recommended action" column:
<https://cloud.google.com/firestore/native/docs/use-rest-api>

| HTTP | Code | Firestore's recommended action |
|---|---|---|
| 400 | `INVALID_ARGUMENT` / `FAILED_PRECONDITION` | do not retry without fixing the problem |
| 401 | `UNAUTHENTICATED` | do not retry without fixing the problem |
| 403 | `PERMISSION_DENIED` | do not retry without fixing the problem |
| 404 | `NOT_FOUND` | do not retry without fixing the problem |
| 409 | `ALREADY_EXISTS` | do not retry without fixing the problem |
| 409 | `ABORTED` | retry |
| 429 | `RESOURCE_EXHAUSTED` | backoff (or fix the quota) |
| 500 | `INTERNAL` | **"Do not retry this request more than once."** |
| 503 / 504 | `UNAVAILABLE` / `DEADLINE_EXCEEDED` | retry with exponential backoff |

Checked specifically: **no Google doc documents a 400 on `createDocument` that a
later identical retry could satisfy.** The documented `INVALID_ARGUMENT` cases
are field-size violations, which are deterministic. `FAILED_PRECONDITION` can be
repaired out-of-band, but its own definition says "should not retry until the
system state has been explicitly fixed" — an operator action, not something a
retry loop waits out. Index building is a *query* concern and does not apply to
a create. So dropping a 400 is consistent with Google's own guidance.

Also checked and **not** established from any primary source: which status an
API-key-only request gets when Security Rules reject it (401 vs 403). Both are
"do not retry without fixing" in Firestore's table, so the retry decision is the
same either way — which is the part that matters here. Recording the gap rather
than asserting an answer.

`ALREADY_EXISTS` and `ABORTED` share HTTP 409 and are separated only by
`error.status` in the body (AIP-193), which is why `reportAborted()` reads it.

### The fix

- `REPORT_DEAD_STATUS = [400, 401, 403, 404]` — dropped, and the loop
  **continues** to the next report instead of returning.
- 409 branches on the body: `ABORTED` is kept and retried, anything else
  (in practice `ALREADY_EXISTS`) is dropped. An unreadable body is not
  retryable — a parse failure must not become "try again" by accident.
- A per-report attempt counter in its own localStorage key, so a genuinely
  transient failure is not retried at every boot for years either:
  six attempts in general, **two for a 500**, because Firestore is explicit
  about that one. The counter lives outside the outbox document — a `tries`
  key inside it would be POSTed to Firestore as a field.
- A transient failure still stops the pass (do not hammer a struggling server),
  but no longer stops the queue permanently.
- Counters are swept for reports no longer in the outbox.

### Tests: 889 total, from 882

Seven new. `flushErrorReports` had **none** before this.

### Mutation tests — nine reverts, one at a time

| # | Revert | Result |
|---|---|---|
| F1 | back to the shipped status rule | **RED** ×2 |
| F2 | permanent failure stops the queue again | **RED** |
| F3 | give-up cap removed | **RED** ×2 |
| F4 | 500 shares the general cap | **RED** |
| F5 | every 409 retried | **RED** |
| F6 | every 409 dropped | **RED** |
| F7 | unreadable 409 body reads as ABORTED | **RED** |
| F8 | offline burns a retry | **RED** |
| F9 | counter sweep removed | **GREEN first time** |

**F9 exposed a gap.** `drop()` already clears a counter for a report it removes,
so the sweep looked redundant. It is not: the outbox keeps the LAST
`ERROR_OUTBOX_MAX`, so an entry can leave by being **evicted**, and `drop()`
never runs for it — its counter then sits in localStorage forever. The new test
overflows the cap deliberately, and asserts the eviction happened before
asserting anything about the counter, so it cannot pass vacuously. F9 then
went red.
