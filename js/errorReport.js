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

/**
 * One Problem Log entry -> one v2-contract report document (plain object).
 * ctx carries the environment: { version, url, userAgent, standalone }.
 */
export function toReportDoc(problem, ctx){
  const c = ctx || {};
  const docOut = {
    reportId: 'fs-' + String(problem.id || 'unknown'),
    createdAt: Date.parse(problem.first || '') || Date.parse(problem.last || '') || 0,
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
  if(problem.detail) docOut.description = redact(String(problem.detail)).slice(0, 400);
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
