/**
 * Clash and deadline detection. Pure, deterministic, NO MODEL INVOLVED.
 *
 * This file is the argument that knowing where *not* to put AI is part of
 * integrating it well.
 *
 * "Do these two events overlap?" is arithmetic. It has one exact answer.
 * Routing it through a language model would add latency, cost, a network
 * dependency and non-determinism to a question that needs none of them — and
 * would introduce the possibility of being wrong about something that cannot
 * be wrong. So this is ordinary code: it runs offline, instantly, free, and
 * a test can prove it correct.
 *
 * It is still listed in the AI capability registry (as class `derive`) so the
 * app can tell the user plainly that this particular help is NOT AI. That is
 * its own kind of transparency, and it is what HAX G2 ("make clear how well
 * the system can do what it can do") looks like when the honest answer is
 * "perfectly, because it isn't guessing".
 */

const clashMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if(!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if(h > 23 || mi > 59) return null;
  return h * 60 + mi;
};

// An event with a start but no end is treated as this long when checking for
// an overlap. A school event with no stated end is realistically an hour;
// assuming zero would report no clashes at all, and assuming all day would
// report clashes constantly. Both failure modes are worse than one hour.
export const ASSUMED_MINUTES = 60;

function clashSpan(e){
  const start = clashMinutes(e.time);
  if(start === null) return null;                 // all-day: not a time clash
  const end = clashMinutes(e.endTime);
  return { start, end: (end !== null && end > start) ? end : start + ASSUMED_MINUTES };
}

/**
 * Two events clash when they are on the same day and their times overlap.
 * Touching endpoints (one ends exactly as the other starts) do NOT clash --
 * back-to-back is normal family life, not a problem to warn about.
 */
export function eventsClash(a, b){
  if(!a || !b || a.date !== b.date) return false;
  if(a.deleted || b.deleted) return false;
  const A = clashSpan(a), B = clashSpan(b);
  if(!A || !B) return false;                      // an all-day item clashes with nothing
  return A.start < B.end && B.start < A.end;
}

/**
 * Find everything worth warning about, newest concern first.
 *
 * Deliberately conservative about what counts as a problem: an app that cries
 * wolf gets its warnings ignored, which is worse than not warning at all.
 * Only three things qualify.
 *
 * @param events  all events (deleted ones are skipped)
 * @param todayISO  reference date, injected so this stays pure and testable
 * @param opts.busyDayThreshold  how many items make a day "crowded"
 */
export function findConflicts(events, todayISO, opts){
  const busyThreshold = (opts && opts.busyDayThreshold) || 4;
  const live = (events || []).filter(e => e && !e.deleted && e.date);
  const out = [];

  // 1. Overlapping times on the same day.
  const byDate = new Map();
  for(const e of live){
    if(!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  const seenPair = new Set();
  for(const [date, list] of byDate){
    for(let i = 0; i < list.length; i++){
      for(let j = i + 1; j < list.length; j++){
        if(!eventsClash(list[i], list[j])) continue;
        const key = [list[i].id, list[j].id].sort().join('~');
        if(seenPair.has(key)) continue;
        seenPair.add(key);
        out.push({ type: 'overlap', date, events: [list[i], list[j]] });
      }
    }
  }

  // 2. A deadline that has quietly gone past without being dealt with.
  //    Only deadlines: a past *event* is simply over, and warning about it
  //    would be noise.
  for(const e of live){
    if(e.kind !== 'deadline') continue;
    if(e.date >= todayISO) continue;
    // `handled` is set by "Mark as handled" on the warning itself. Exported
    // (added to the calendar) also counts, but it is a poor proxy on its own:
    // a form can be submitted in real life without ever being exported, and
    // before v9.9 the app had no way to hear that. (This line previously also
    // checked `e.done`, a field NOTHING in the app ever set -- dead code that
    // implied a concept that did not exist.)
    if(e.exported || e.handled) continue;
    out.push({ type: 'missed-deadline', date: e.date, events: [e] });
  }

  // 3. A day that has become crowded. Upcoming only -- a busy day already
  //    survived is not information.
  for(const [date, list] of byDate){
    if(date < todayISO) continue;
    if(list.length < busyThreshold) continue;
    out.push({ type: 'busy-day', date, events: list.slice() });
  }

  // Soonest first, and within a date the more urgent kind first.
  const rank = { 'missed-deadline': 0, overlap: 1, 'busy-day': 2 };
  out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : rank[x.type] - rank[y.type]));
  return out;
}

/**
 * One plain sentence per conflict. Written here rather than generated, because
 * a fixed sentence is predictable, instant, translatable and cannot drift --
 * and because "two things overlap" does not need prose written for it.
 */
export function describeConflict(c){
  const t = (e) => e.title || 'Untitled';
  if(c.type === 'overlap')          return `${t(c.events[0])} and ${t(c.events[1])} overlap`;
  if(c.type === 'missed-deadline')  return `${t(c.events[0])} was due and has not been dealt with`;
  if(c.type === 'busy-day')         return `${c.events.length} things on one day`;
  return '';
}
