# ERROR-LOGGING-HANDOFF.md — for AI coding agents working in THIS repo (FlyerSnap)

**Written 2026-08-23 by the Admin Console session.** Read CLAUDE.md first as always;
this note covers the FAMILY-WIDE error-logging arrangement this app participates in,
shared with the recipe app (meal-planner) and the Admin Console.

## The shared arrangement

FlyerSnap reports problems to the shared Firestore collection **`errorReports`** in the
recipe app's project (`meal-planner-f7f2f`). The rules (which live in the RECIPE APP's
repo, not here) allow anyone to CREATE a shape-valid report — ≤24 keys, message ≤4000 —
and only the admin to read/manage. Logan sees every report in the **Admin Console's
Logs tab** under a `flyersnap` badge. The authoritative contract is
**`ERROR-LOGGING-STANDARD.md` in the AdminConsole repo**
(`C:\Users\Logan\Desktop\Repos\AdminConsole`); this repo's own plan is
`ERROR-REPORTING-PLAN.md`, and CLAUDE.md carries the REMOTE ERROR REPORTING section.

## What THIS repo implements (v9.24–v9.26; do not remove or bypass)

- `js/errorReport.js` — PURE builders only (tested in tests-modules.js "Remote error
  reporting" section): problem → v2 report doc (`app:'flyersnap'`, severity,
  fingerprint, standalone, occurrenceCount), Firestore REST field typing, endpoint
  URL, and `newestFirstId` (**ids lead with a 13-digit inverted timestamp so the
  Firebase data browser lists newest first — same scheme in all three apps**).
  Inlined into index.html per the drift rules; edit the source, re-inline.
- Glue in index.html beside the Problem Log: `queueErrorReport()` is called from
  `logProblem` for each NEW problem (a guard test enforces this — mutation-tested);
  localStorage outbox `flyersnap-error-outbox`; lazy `fetch` POST to the Firestore
  REST API. **No SDK, nothing at boot** (CLAUDE.md rule 4 holds), offline-safe.
- Text passes through `redact()` — the AI-log privacy rule applies unchanged: no
  event content, no prompt text, no API key, ever.
- Opt-out: `S.settings.errorReportsOff = true` (no UI; adding one touches the
  settings-hub tests).

## Rules for agents

1. The reporter must NEVER call `logProblem` (a failing reporter reporting itself
   is a loop). Everything is try/catch-silent.
2. Report-shape changes are ADDITIVE ONLY and coordinated through the standard doc
   in the AdminConsole repo — the rules cap (24 keys) is enforced server-side from
   the recipe app's repo.
3. New failure paths should land in `logProblem` (the single funnel); remote
   reporting then happens automatically.
4. `node tests.js` green before any commit; the drift, collision, and
   logProblem-queues guards all police this feature.
