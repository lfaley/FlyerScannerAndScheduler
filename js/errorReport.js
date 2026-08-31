// errorReport.js — remote error reporting, the PURE half (v9.24).
//
// Implements FlyerSnap's side of the cross-app error-logging standard
// (ERROR-LOGGING-STANDARD.md in the AdminConsole repo): every problem that
// lands in the local Problem Log is also queued as a small text-only document
// to the shared Firestore `errorReports` collection, where the admin console
// lists it under the `flyersnap` badge. Firestore rules allow anonymous
// CREATE of a shape-valid report and nothing else — no read, no update.
//
// This module holds only pure builders so `node tests.js` can exercise them:
// no fetch, no storage, no S. The I/O glue (outbox + lazy REST delivery)
// lives in index.html next to logProblem, and NEVER runs at boot — the app
// must keep working with no network and must not fetch anything to start.
//
// PRIVACY (non-negotiable, same rule as the AI log): reports carry the
// problem's where/message/detail passed through redact() — never event or
// chore content, never prompt text, never the API key. The Problem Log's own
// text is already written to be shareable (it goes in the diagnostics file);
// this sends that same text and nothing more.

import { redact } from './ailog.js';

export const ERROR_REPORT_APP = 'flyersnap';
export const ERROR_REPORT_PROJECT = 'meal-planner-f7f2f';
// The shared project's public web API key (public by design — it ships in the
// recipe app's bundle too; security is enforced by Firestore rules, not secrecy).
export const ERROR_REPORT_KEY = 'AIzaSyAp87MmFWuWQmHdJKPJ-i1UNOMXg-my5ho';
export const ERROR_OUTBOX_MAX = 20;

// djb2, hex-encoded — same recipe as the other apps so grouping is uniform.
export function reportHash(input){
  let h = 5381;
  const s = String(input || '');
  for(let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

// Same normalization the Problem Log itself groups by: digits vary between
// occurrences of one bug, the shape does not.
export function reportFingerprint(where, message){
  return reportHash(String(where || '') + '|' +
    String(message || '').replace(/\d+/g, 'N').slice(0, 120));
}

// Newest-first document ids (Logan, 2026-08-22): the Firebase data browser
// lists by id ASCENDING, so a 13-digit INVERTED timestamp prefix makes the
// newest report sort to the TOP (digits also sort ahead of the legacy
// letter-prefixed ids). Same scheme in all three apps.
export const ID_MAX_TS = 9999999999999; // 13 nines, ~year 2286
export function newestFirstId(kind, now, rand){
  const n = Math.min(Math.max(Math.trunc(now) || 0, 0), ID_MAX_TS);
  return String(ID_MAX_TS - n).padStart(13, '0') + '-' + kind + '-' + String(rand);
}

/**
 * Does this problem's `detail` carry something the app was PROCESSING rather
 * than something about the app itself?
 *
 * Keyed on the `where` prefix, which is a string convention rather than a type
 * (`logProblem('Email: ' + sender, ...)`), so renaming that prefix would
 * silently stop the guard from firing. A test pins both halves: the prefix and
 * the withholding. Named and exported so the rule is one thing in one place --
 * a second content source gets added HERE, not as a second condition somewhere
 * further down.
 */
// The `where` values whose `detail` is provably free of anything the app was
// PROCESSING. Everything ELSE is withheld from an automatic report, so a new
// call site is private by DEFAULT instead of leaking until someone notices.
//
// v9.77 inverted this. It was a denylist of one prefix (/^Email:/), and
// `logProblem('Scanning', err.message, scanContext)` -- scanContext being the
// free text the user types into "What is this about?", e.g. "Olivia's dance" --
// was therefore uploaded verbatim to the shared errorReports collection. The
// ruling it broke is quoted in toReportDoc below.
//
// Audited 31 Aug 2026 against every logProblem call site in index.html:
//   Storage      surviving localStorage key names     content-free
//   Gordon       aiModelName() / a fixed sentence     content-free
//   Local model  aiModelName()                        content-free
//   Recipe scan  a file-read error message            content-free
//   App          filename:lineno / a rejection text   diagnostics, allowed
//   Assistant    a transport error message            diagnostics, allowed
//   Scanning     the user's own typed scan context    WITHHELD
//   Email: ...   the email subject                    WITHHELD
//
// An unlabelled problem ('' or null) is withheld too: an unknown call site is
// exactly the one whose detail nobody has audited.
export const CONTENT_FREE_WHERE = new Set(
  ['Storage', 'Gordon', 'Local model', 'Recipe scan', 'App', 'Assistant']);

export function isThirdPartyContent(where){
  return !CONTENT_FREE_WHERE.has(String(where || ''));
}

/**
 * One Problem Log entry -> one v2-contract report document (plain object).
 * ctx carries the environment: { version, url, userAgent, standalone }.
 */
export function toReportDoc(problem, ctx){
  const c = ctx || {};
  const createdAt = Date.parse(problem.first || '') || Date.parse(problem.last || '') || 0;
  const docOut = {
    // Deterministic per problem (same problem re-queued -> same id -> the
    // 409 on redelivery dedups it server-side), newest-first sortable.
    reportId: newestFirstId('fs', createdAt, String(problem.id || 'unknown')),
    createdAt: createdAt,
    type: 'problem',
    message: redact(String(problem.where || 'App') + ': ' + String(problem.message || '')).slice(0, 2000),
    app: ERROR_REPORT_APP,
    appVersion: String(c.version || ''),
    severity: 'error',
    fingerprint: reportFingerprint(problem.where, problem.message),
    standalone: !!c.standalone,
    url: String(c.url || ''),
    userAgent: String(c.userAgent || '').slice(0, 500),
  };
  // RULING 2026-08-23 (ERROR-LOGGING-STANDARD.md §6, via ERROR-LOGGING-RULINGS-REPLY.md):
  // every field of an AUTOMATIC report is DIAGNOSTICS-ONLY. Third-party or
  // processed content never leaves the device automatically; `description` is
  // for model names and status codes, never for the thing being processed.
  // A deliberately user-filed report is the exception, on the one-tap consent
  // model -- FlyerSnap has no such path today, so nothing here is exempt.
  //
  // The case that forced the ruling: the Gmail watcher passes the email SUBJECT
  // as logProblem's `detail` (index.html:6221, used at :6236/:6240/:6245), so
  // "Braelyn's Field Trip Permission Slip - Maple Elementary" was reaching the
  // shared database. redact() scrubs API keys and email ADDRESSES only, so the
  // sender was redacted and the subject was not. The recipe app had the same
  // exposure and wider (button labels in actionTrail); fixed there the same day.
  //
  // Withheld here at the BOUNDARY rather than at the three call sites, so the
  // subject still reaches the local Problem Log -- where it is the only thing
  // identifying WHICH email failed -- and the diagnostics file, which Logan
  // shares one tap at a time to a recipient he picks.
  if(problem.detail && !isThirdPartyContent(problem.where)){
    docOut.description = redact(String(problem.detail)).slice(0, 400);
  }
  if(problem.count > 1) docOut.occurrenceCount = problem.count;
  return docOut;
}

/** Plain object -> Firestore REST typed `fields` map. */
export function toRestFields(docOut){
  const fields = {};
  for(const k of Object.keys(docOut)){
    const v = docOut[k];
    if(typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if(typeof v === 'number') fields[k] = { integerValue: String(Math.trunc(v)) };
    else fields[k] = { stringValue: String(v) };
  }
  return fields;
}

/** The create-document endpoint for one report id. */
export function reportRestUrl(docId){
  return 'https://firestore.googleapis.com/v1/projects/' + ERROR_REPORT_PROJECT +
    '/databases/(default)/documents/errorReports?documentId=' + encodeURIComponent(docId) +
    '&key=' + ERROR_REPORT_KEY;
}
