/**
 * Extraction scoring. Pure -- no DOM, no network, no app state.
 *
 * Answers the question the project could not previously answer: "is the
 * extraction any good, and did that prompt change help or hurt?" Until now
 * prompt changes were judged by eye, which does not scale and cannot detect a
 * small regression.
 *
 * How it scores, and why:
 *
 * MATCHING IS TWO-STAGE. An extracted event is paired with an expected one
 * only if they land on the SAME DATE and their titles are recognisably the
 * same thing. Date is required because a right-looking title on the wrong day
 * is not a partial success -- it is the exact failure this app exists to
 * prevent. Title similarity reuses the app's own normalisation so the
 * benchmark cannot drift from how the app itself compares events.
 *
 * THEN FIELDS ARE SCORED WITHIN A PAIR. Precision and recall are computed
 * over events, and separately per field over matched pairs, because the
 * failure modes are different: missing a whole event is a different problem
 * from getting an event's time wrong, and a single blended number hides both.
 *
 * HALLUCINATION IS TRACKED SEPARATELY. An invented event (no expected
 * counterpart) is the worst failure mode for this app -- worse than a miss,
 * because a missed flyer gets noticed and an invented one quietly gets
 * trusted. It is reported on its own, not just folded into precision.
 */

// Reused from the app's own duplicate matching so the two cannot diverge.
function normTitle(t){
  return String(t || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(the|a|an|of|for|to|at|on|in|our|your|please|note)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleMatch(a, b){
  const A = normTitle(a).split(' ').filter(Boolean);
  const B = normTitle(b).split(' ').filter(Boolean);
  // A title made entirely of stop-words normalises to nothing ("The Note",
  // or a single letter). Falling through would score it 0 against an
  // identical string, so compare the raw text in that case.
  if(!A.length || !B.length){
    const ra = String(a || '').trim().toLowerCase();
    const rb = String(b || '').trim().toLowerCase();
    return (ra && ra === rb) ? 1 : 0;
  }
  const setB = new Set(B);
  const overlap = A.filter(w => setB.has(w)).length;
  return overlap / Math.min(A.length, B.length);
}

// Fields compared inside a matched pair. `soft` fields tolerate wording
// differences; the rest must be exact, because a time or a date that is
// "close" is simply wrong.
export const FIELDS = ['title', 'time', 'endTime', 'kind', 'location', 'notes'];
const SOFT = new Set(['title', 'location', 'notes']);

const norm = (v) => (v === undefined || v === null || v === '') ? null : String(v).trim();

export function fieldAgrees(field, expected, actual){
  const e = norm(expected), a = norm(actual);
  if(e === null && a === null) return true;      // both silent: correct
  if(e === null || a === null) return false;     // one invented or dropped it
  if(!SOFT.has(field)) return e.toLowerCase() === a.toLowerCase();
  if(field === 'notes'){
    // Notes are prose; demand the substance, not the wording. Scored as
    // "did it capture the facts", i.e. token recall against the expected note.
    const E = normTitle(e).split(' ').filter(Boolean);
    const A = new Set(normTitle(a).split(' ').filter(Boolean));
    if(!E.length) return true;
    return E.filter(w => A.has(w)).length / E.length >= 0.6;
  }
  return titleMatch(e, a) >= 0.8;
}

/**
 * Score one case: the events a model returned against the events a human said
 * were there.
 *
 * Greedy pairing on (date, best title similarity). Greedy is adequate here
 * because a single flyer rarely holds two same-day events with confusable
 * titles; when it does, the report shows the pairing so it can be inspected.
 */
export function scoreCase(expected, actual){
  const exp = (expected || []).map((e, i) => ({ e, i }));
  const act = (actual || []).map((a, i) => ({ a, i }));
  const takenA = new Set();
  const pairs = [];

  for(const { e } of exp){
    let best = null, bestSim = 0;
    for(const { a, i } of act){
      if(takenA.has(i)) continue;
      if(norm(a.date) !== norm(e.date)) continue;      // wrong day is never a match
      const sim = titleMatch(e.title, a.title);
      if(sim > bestSim){ bestSim = sim; best = { a, i }; }
    }
    // 0.5 is deliberately lower than the app's 0.8 duplicate threshold: here we
    // WANT to pair a near-miss so its fields get scored and the error is
    // visible, rather than counting it as both a miss and a hallucination.
    if(best && bestSim >= 0.5){
      takenA.add(best.i);
      pairs.push({ expected: e, actual: best.a, titleSim: bestSim });
    } else {
      pairs.push({ expected: e, actual: null, titleSim: 0 });
    }
  }

  const missed = pairs.filter(p => !p.actual).map(p => p.expected);
  const invented = act.filter(x => !takenA.has(x.i)).map(x => x.a);
  const matched = pairs.filter(p => p.actual);

  const fields = {};
  for(const f of FIELDS){
    let right = 0, seen = 0;
    for(const p of matched){
      seen++;
      if(fieldAgrees(f, p.expected[f], p.actual[f])) right++;
    }
    fields[f] = { right, seen, rate: seen ? right / seen : null };
  }

  const tp = matched.length;
  return {
    expected: exp.length,
    returned: act.length,
    matched: tp,
    missed,
    invented,
    precision: act.length ? tp / act.length : (exp.length ? 0 : 1),
    recall: exp.length ? tp / exp.length : 1,
    f1: (tp && (act.length + exp.length)) ? (2 * tp) / (act.length + exp.length) : (exp.length || act.length ? 0 : 1),
    fields,
    pairs,
  };
}

/** Roll several case results into one report. */
export function aggregate(results){
  const sum = (f) => results.reduce((n, r) => n + f(r), 0);
  const tp = sum(r => r.matched);
  const returned = sum(r => r.returned);
  const expected = sum(r => r.expected);
  const fields = {};
  for(const f of FIELDS){
    const right = sum(r => r.fields[f].right);
    const seen = sum(r => r.fields[f].seen);
    fields[f] = { right, seen, rate: seen ? right / seen : null };
  }
  return {
    cases: results.length,
    expected, returned, matched: tp,
    precision: returned ? tp / returned : (expected ? 0 : 1),
    recall: expected ? tp / expected : 1,
    f1: (returned + expected) ? (2 * tp) / (returned + expected) : 1,
    missedTotal: sum(r => r.missed.length),
    inventedTotal: sum(r => r.invented.length),
    fields,
  };
}
