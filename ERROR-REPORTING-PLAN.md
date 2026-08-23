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
