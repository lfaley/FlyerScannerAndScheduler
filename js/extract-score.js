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
 * WHY THIS LIVES IN js/ RATHER THAN eval/. Everything in js/ ships. This moved
 * here in v9.19 when the extraction benchmark became runnable from inside the
 * app: the API key lives in the phone's browser storage, so a desktop script
 * cannot reach the provider actually in use. One scorer, so a run on the phone
 * and a run from the terminal cannot disagree. The exported names are
 * `scoreExtraction` / `aggregateExtraction` rather than `scoreCase` /
 * `aggregate` because js/route-score.js already owns those, and both are
 * inlined into one global scope.
 *
 * HALLUCINATION IS TRACKED SEPARATELY. An invented event (no expected
 * counterpart) is the worst failure mode for this app -- worse than a miss,
 * because a missed flyer gets noticed and an invented one quietly gets
 * trusted. It is reported on its own, not just folded into precision.
 */

// The app's OWN matching, imported rather than copied. It used to be a copy
// with a comment claiming it could not diverge -- and it had diverged: this
// file handled titles made entirely of stop-words and js/matching.js did not,
// so the app failed to spot two byte-identical "The Note" events on one day.
// Consolidating the two is what found it (v9.18).
import { normTitle, titleSimilarity } from './matching.js';

/** Kept as a name so the scoring code below reads the way it always did. */
export const titleMatch = titleSimilarity;

// Fields compared inside a matched pair. `soft` fields tolerate wording
// differences; the rest must be exact, because a time or a date that is
// "close" is simply wrong.
export const FIELDS = ['title', 'time', 'endTime', 'kind', 'location', 'notes'];
const SOFT = new Set(['title', 'location', 'notes']);

// `blankToNull`, not `norm`: js/intents.js already owns a top-level `norm`,
// and every js/ module is inlined into ONE global scope, so a second one would
// silently shadow it. A test fails the build on exactly this.
const blankToNull = (v) => (v === undefined || v === null || v === '') ? null : String(v).trim();

export function fieldAgrees(field, expected, actual){
  const e = blankToNull(expected), a = blankToNull(actual);
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
export function scoreExtraction(expected, actual){
  const exp = (expected || []).map((e, i) => ({ e, i }));
  const act = (actual || []).map((a, i) => ({ a, i }));
  const takenA = new Set();
  const pairs = [];

  for(const { e } of exp){
    let best = null, bestSim = 0;
    for(const { a, i } of act){
      if(takenA.has(i)) continue;
      if(blankToNull(a.date) !== blankToNull(e.date)) continue;      // wrong day is never a match
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
  const leftover = act.filter(x => !takenA.has(x.i)).map(x => x.a);
  const matched = pairs.filter(p => p.actual);

  // v9.25. A SECOND PASS OVER THE LEFTOVERS, and it changes what the headline
  // number means.
  //
  // The first pass refuses to pair across dates ("wrong day is never a match"),
  // which is correct for precision and recall -- an event on the wrong day is
  // wrong. But it also means one misplaced event is reported as BOTH a miss and
  // an invention, and the results screen leads with "an event that was never in
  // the paperwork is the worst thing this can do". That framing is true of a
  // hallucination and false of a date error.
  //
  // Logan's first q8 run is the case in point. `schedule-grid` scored 1 missed
  // + 1 invented, which reads as two failures including the alarming kind. What
  // actually happened: the timetable is a 2-D grid, and "Mini Jazz (Austin)"
  // was read out of the Monday column into Tuesday's. One cell, shifted. Every
  // field was right, "Lunch" was correctly left out of both days, and the empty
  // Monday slot was correctly left alone. Nothing was invented.
  //
  // So the leftovers are split. `invented` now means a title that appears
  // nowhere in what was expected -- a real hallucination. `misdated` means the
  // right event on the wrong day, named as its own failure. Precision, recall
  // and F1 are untouched: both are still errors, and both still cost the score.
  const claimed = new Set();
  const misdated = [];
  const invented = [];
  for(const a of leftover){
    // By index, and each missed event can explain at most one leftover: a
    // timetable repeats the same class on several days, and matching by value
    // would let one absence excuse every stray copy of it.
    let idx = -1;
    for(let i = 0; i < missed.length; i++){
      if(claimed.has(i)) continue;
      if(titleMatch(missed[i].title, a.title) >= 0.8){ idx = i; break; }
    }
    if(idx >= 0){
      claimed.add(idx);
      // Both dates, because "wrong day" is only useful if you can see which.
      misdated.push(Object.assign({}, a, { expectedDate: missed[idx].date || null }));
    }else{
      invented.push(a);
    }
  }

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
    misdated,
    precision: act.length ? tp / act.length : (exp.length ? 0 : 1),
    recall: exp.length ? tp / exp.length : 1,
    f1: (tp && (act.length + exp.length)) ? (2 * tp) / (act.length + exp.length) : (exp.length || act.length ? 0 : 1),
    fields,
    pairs,
  };
}

/** Roll several case results into one report. */
export function aggregateExtraction(results){
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
    // Reported beside inventions, never folded into them: the right event on
    // the wrong day is a date bug, not a hallucination, and the two need
    // different fixes.
    misdatedTotal: sum(r => (r.misdated || []).length),
    fields,
  };
}
