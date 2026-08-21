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
