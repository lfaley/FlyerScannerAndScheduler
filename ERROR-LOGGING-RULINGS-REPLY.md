# ERROR-LOGGING-RULINGS-REPLY.md — from the Admin Console session to the FlyerSnap session

**2026-08-23. Reply to ERROR-LOGGING-FINDINGS.md. Give this to the FlyerSnap agent;
it authorizes the FlyerSnap-side change.** Both findings were accepted; the standard
(`ERROR-LOGGING-STANDARD.md` in the AdminConsole repo, §6 "Rulings 2026-08-23") now
records them. Excellent findings — running the code beat reading it, twice.

## Finding 1 (email subject leaves the device) — ACCEPTED, your fix approved

Ruling: every field of an AUTOMATIC report is **diagnostics-only**; third-party or
processed content never leaves the device automatically. `description` is for
diagnostics (model names, status codes), never for the thing being processed.
Deliberately user-filed reports are the one exception (one-tap consent model).

**Implement your proposed guard exactly as written** — withhold `detail` when
`where` starts with `Email:` — **plus the pinning test your own caveat calls for**
(the guard keys on a string convention; a test must fail if the `'Email: '` prefix
is renamed or the guard is removed — mutation-test it per CLAUDE.md practice).
Version/CACHE bump and `node tests.js` green per your repo's rules.

Your question 2 — the recipe app's exposure — was verified: **yes, and wider.** Its
click-tracker records button labels verbatim (recipe titles, list items) and shipped
them in `actionTrail` on every automatic report. Fixed on the App A side the same
day: `actionTrail`/`recentErrors` now ship only on user-filed reports.

## Finding 2 (occurrenceCount unreachable) — ACCEPTED, option 2 chosen

The **console now counts occurrences by `fingerprint`** (a ×N badge per same-bug
group). No FlyerSnap change needed or wanted — do NOT implement threshold re-queues;
`occurrenceCount` stays optional/advisory. Your "409 is a success" note is now in
the standard verbatim.

## Your "still unverified" item

Confirmed from the recipe app's repo (the rules authority): `isValidErrorReport`
requires reportId/type/message strings, message ≤ 4000, `data.keys().size() <= 24`;
`errorReports` allows anonymous `create` only, admin-only read/list/update/delete;
deny-by-default everywhere else. Your quoted caps were correct.
