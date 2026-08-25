/**
 * Formatting helpers. Pure functions -- no DOM, no app state, no side effects.
 *
 * This is the first module extracted from index.html. It was chosen because it
 * is entirely pure and already well covered by tests, so moving it proves the
 * pattern works without risking anything.
 */

// --- dates -----------------------------------------------------------------

export function todayISO(d){
  const t = d || new Date();
  return t.getFullYear() + '-' +
    String(t.getMonth() + 1).padStart(2, '0') + '-' +
    String(t.getDate()).padStart(2, '0');
}

export function daysUntil(dateStr, today){
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = today ? new Date(today) : new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}

// --- times -----------------------------------------------------------------

/**
 * 24-hour to 12-hour for display. Stored data and the .ics file stay 24-hour;
 * the iCalendar standard requires it and the phone renders it per its own
 * settings. Only what the user reads changes here.
 */
export function fmt12(t){
  if(!t || !/^\d{1,2}:\d{2}$/.test(t)) return t || '';
  let [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if(h === 0) h = 12;
  return h + ':' + String(m).padStart(2, '0') + ' ' + ampm;
}

export function fmtTimeRange(e){
  if(!e || !e.time) return '';
  return e.endTime ? fmt12(e.time) + '–' + fmt12(e.endTime) : fmt12(e.time);
}

// --- text ------------------------------------------------------------------

export function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// --- copy/share formatting -------------------------------------------------
// Pure: turn app records into plain text a person can paste elsewhere. The
// Problem Log used to be a dead end on a phone -- you could see an error and
// not get it out. These build the exact text the Copy/Share buttons hand to
// the clipboard or the share sheet.

export function formatProblemForCopy(p){
  if(!p) return '';
  const lines = [];
  lines.push(String(p.message || 'Problem'));
  if(p.where) lines.push('Where: ' + p.where);
  if(p.count > 1) lines.push('Happened: ' + p.count + ' times');
  if(p.last) lines.push('Last: ' + p.last);
  if(p.detail) lines.push('', String(p.detail));
  return lines.join('\n').trim();
}

export function formatAnswerForCopy(turn){
  return String(turn && turn.a != null ? turn.a : '').trim();
}

// --- problem guidance ------------------------------------------------------
// Pure: read a logged problem's text (message + detail) and return how urgent
// it is and one line on what to do about it. A log that only names the symptom
// leaves the reader stuck; NN/g's error guidance is to offer the next step.
// `tier`: 'act' = won't fix itself, you must do something (red);
//         'wait' = transient, retrying may work (amber);
//         '' = unknown, no specific advice (amber default).
// Matches on the text so it needs no schema change to the stored entry.
export function problemGuidance(text){
  const t = String(text || '').toLowerCase();
  if(/not signed in|sign in|unauthor|forbidden|\b401\b|\b403\b/.test(t))
    return { tier:'act', hint:'Sign in to Gordon — Settings → Gordon and AI.' };
  if(/only reasoning|thinking|produced no answer|never (?:replied|answered)/.test(t))
    return { tier:'act', hint:'Wrong model tag — it must be the Instruct build, not the Thinking one.' };
  if(/pdf|unsupported|cannot read|only photos/.test(t))
    return { tier:'act', hint:'PDFs need Anthropic — photograph the page, or turn on the fallback.' };
  if(/rate.?limit|too many requests|\b429\b|is busy/.test(t))
    return { tier:'wait', hint:'Gordon was busy (rate limited) — wait a moment and try again.' };
  if(/timeout|timed out|took too long|three minutes/.test(t))
    return { tier:'wait', hint:'It took too long — try one page at a time.' };
  if(/failed to fetch|network|unreachable|connection|offline|econnrefused|\b502\b|\b503\b/.test(t))
    return { tier:'wait', hint:'Could not reach the desktop — wake it and check Tailscale, then retry.' };
  return { tier:'', hint:'' };
}
