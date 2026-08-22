/**
 * "Ask about your schedule" — the read-only AI surface.
 *
 * Risk class READ: it answers questions and changes nothing. The two things
 * that make it trustworthy are both here, and both are pure functions so they
 * can be tested without a network:
 *
 *  1. SCOPING (`scopeForQuestion`). The model is only ever shown a bounded
 *     slice of the user's events, never the whole database. That is HAX G10
 *     ("scope services when in doubt") and it is also a privacy decision: a
 *     question about this week has no business shipping last year's
 *     appointments to an API.
 *
 *  2. CITATION (`ANSWER_CONTRACT`). Every answer must name the events it used.
 *     HAX G11 is "make clear why the system did what it did", and Stanford
 *     HAI's framing is sharper: build tools people can learn to use, not
 *     oracles that hand down answers and withhold the reasoning. A cited
 *     answer can be checked in two seconds; an uncited one has to be trusted.
 *
 * The model is never asked to do arithmetic on dates it could get wrong: the
 * scope is computed here, in code, and each event is handed over with its date
 * already resolved and its distance from today already worked out.
 */

// How far each kind of question reaches. Deliberately small: a tight scope is
// faster, cheaper, more private, and gives the model less room to wander.
export const SCOPES = {
  today:    { back: 0,  forward: 0,   label: 'today' },
  week:     { back: 0,  forward: 7,   label: 'the next 7 days' },
  fortnight:{ back: 0,  forward: 14,  label: 'the next 2 weeks' },
  month:    { back: 0,  forward: 31,  label: 'the next month' },
  recent:   { back: 30, forward: 0,   label: 'the last 30 days' },
  wide:     { back: 7,  forward: 90,  label: 'the next 3 months' },
};

// Namespaced deliberately: these are inlined into one global scope
// alongside the whole app, and a generic name like `iso` collides.
const ASK_DAY_MS = 86400000;
const askISODate = (d) => d.toISOString().slice(0, 10);

function askShiftDays(todayISO, days){
  const d = new Date(todayISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return askISODate(d);
}

export function daysBetween(fromISO, toISO){
  return Math.round((Date.parse(toISO + 'T00:00:00Z') - Date.parse(fromISO + 'T00:00:00Z')) / ASK_DAY_MS);
}

/**
 * Pick a scope from the wording of the question.
 *
 * Keyword matching rather than a model call, on purpose: choosing how much
 * data to send is a privacy decision, and a privacy decision should be
 * predictable and auditable, not delegated to a model. When the wording gives
 * no clue we widen rather than narrow -- a missing answer is more annoying
 * than a slightly larger prompt, and `wide` is still bounded.
 */
export function pickScope(question){
  const q = String(question || '').toLowerCase();
  if(/\btoday\b|\btonight\b|\bthis evening\b/.test(q))          return 'today';
  if(/\byesterday\b|\blast week\b|\brecently\b|\bdid i\b|\bwas there\b/.test(q)) return 'recent';
  if(/\bthis week\b|\bthis weekend\b|\btomorrow\b|\bnext few days\b/.test(q))    return 'week';
  if(/\bnext week\b|\bfortnight\b|\btwo weeks\b/.test(q))        return 'fortnight';
  if(/\bthis month\b|\bnext month\b|\bcoming weeks\b/.test(q))   return 'month';
  return 'wide';
}

/**
 * The events a question is allowed to see.
 * Returns both the slice and the human-readable window, so the UI can tell the
 * user exactly what was looked at -- part of G11, and it makes an empty answer
 * explicable rather than mysterious.
 */
export function scopeForQuestion(question, events, todayISO){
  const key = pickScope(question);
  const s = SCOPES[key];
  const from = askShiftDays(todayISO, -s.back);
  const to   = askShiftDays(todayISO, s.forward);
  const inWindow = (events || [])
    .filter(e => e && !e.deleted && e.date && e.date >= from && e.date <= to)
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  return { key, label: s.label, from, to, events: inWindow };
}

/**
 * Turn the scoped events into the compact block the model sees.
 *
 * Only the fields an answer could need. Notes are truncated: they are the
 * longest field and a question about *when* something is rarely needs the
 * full packing list. Every event carries a short id so the model can cite it
 * without repeating the title back.
 */
export function buildAskContext(scope, people){
  const nameById = new Map((people || []).map(p => [p.id, p.name]));
  return scope.events.map((e, i) => {
    const who = (e.personIds || []).map(id => nameById.get(id)).filter(Boolean).join(', ');
    const rel = daysBetween(scope.from, e.date);
    const bits = [
      `[${i + 1}]`,
      e.date,
      e.time ? e.time + (e.endTime ? '-' + e.endTime : '') : 'all day',
      e.kind === 'deadline' ? 'DEADLINE' : 'event',
      e.title,
    ];
    if(who) bits.push(`for ${who}`);
    if(e.location) bits.push(`at ${e.location}`);
    if(e.notes) bits.push('— ' + String(e.notes).slice(0, 160));
    return { ref: i + 1, id: e.id, line: bits.join(' '), rel };
  });
}

/**
 * What the model is told about answering. Kept as a constant so the rules are
 * reviewable in one place, and so the extraction benchmark can eventually
 * measure this prompt the same way it measures the extraction one.
 */
export const ANSWER_CONTRACT = `You are answering a parent's question about their own family calendar.

Rules, in order of importance:

1. ANSWER ONLY FROM THE LIST. The numbered events below are everything you can see. If the answer is not in them, say plainly that you cannot see it in the range that was checked. Never fill a gap with something plausible.

2. CITE EVERY CLAIM. After each fact, put the reference number(s) it came from, like [2] or [1][4]. A statement with no reference is not allowed.

3. BE SHORT. Two or three sentences, or a short list. This is read on a phone, usually in a hurry.

4. DO NOT DO ARITHMETIC ON DATES. Each event already states its date and time; use them as given rather than working anything out.

5. NO ADVICE, NO ENCOURAGEMENT, NO OPINION. State what is on the calendar. If nothing is, say so.`;

export function buildAskPrompt(question, scope, people, todayISO){
  const ctx = buildAskContext(scope, people);
  const list = ctx.length
    ? ctx.map(c => c.line).join('\n')
    : '(no events in this range)';
  return {
    system: ANSWER_CONTRACT,
    user: `Today is ${todayISO}. You are looking at ${scope.label} (${scope.from} to ${scope.to}).

EVENTS:
${list}

QUESTION: ${question}`,
    refs: ctx,
  };
}

/**
 * Pull the [n] citations out of an answer and map them back to real events, so
 * the UI can show what was used rather than asking the user to trust it.
 * A citation pointing at nothing is dropped rather than displayed -- showing a
 * dangling reference would undermine the very thing citations are for.
 */
export function citedEvents(answer, refs){
  const nums = new Set();
  for(const m of String(answer || '').matchAll(/\[(\d{1,2})\]/g)) nums.add(Number(m[1]));
  return (refs || []).filter(r => nums.has(r.ref));
}
