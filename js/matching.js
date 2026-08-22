/**
 * Event matching and grouping. Pure -- no DOM, no app state.
 *
 * The thresholds were tuned against real failures. Short titles need full
 * containment because "Mini Jazz" and "Mini M.T." share a word by chance;
 * longer ones need 0.8 overlap because 0.5 merged unrelated school events.
 */

// The same announcement can reach us twice -- once photographed, once by email --
// and Claude words the two slightly differently ("&" vs "and", extra qualifiers).
// Matching therefore has to be on meaning, not on the exact string.
export function normTitle(t){
  return String(t || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(the|a|an|of|for|to|at|on|in|our|your|please|note)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Overlap measured against the shorter title, so "Picture Day" still matches
// "Fall Picture Day for Grades 1-5".
export function titleSimilarity(a, b){
  const A = normTitle(a).split(' ').filter(Boolean);
  const B = normTitle(b).split(' ').filter(Boolean);
  // A title made entirely of stop-words normalises to nothing ("The Note",
  // "A", a single letter). Returning 0 here meant two BYTE-IDENTICAL titles
  // scored as completely unlike each other -- so looksDuplicate missed them,
  // which is the one thing it exists to catch. Compare the raw text instead.
  // (v9.18. The extraction scorer had quietly solved this in a private copy;
  // consolidating the two is what surfaced it.)
  if(!A.length || !B.length){
    const ra = String(a || '').trim().toLowerCase();
    const rb = String(b || '').trim().toLowerCase();
    return (ra && ra === rb) ? 1 : 0;
  }
  const setB = new Set(B);
  const overlap = A.filter(w => setB.has(w)).length;
  return overlap / Math.min(A.length, B.length);
}

export function looksDuplicate(a, b){
  if(!a || !b || a.date !== b.date) return false;          // same day is required
  const na = normTitle(a.title), nb = normTitle(b.title);
  // Both normalise to nothing: titleSimilarity compares the raw text.
  if(!na || !nb) return titleSimilarity(a.title, b.title) === 1;
  if(na === nb) return true;                                // identical after normalizing
  // For anything else, demand a strong match. Short titles (1-2 words) are too
  // easy to collide by chance ("Mini Jazz" vs "Mini M.T."), so for those we
  // require one title to fully contain the other rather than mere word overlap.
  const wa = na.split(' ').filter(Boolean), wb = nb.split(' ').filter(Boolean);
  const shorter = Math.min(wa.length, wb.length);
  if(shorter <= 2){
    return na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0;     // full containment only
  }
  return titleSimilarity(a.title, b.title) >= 0.8;         // was 0.6 — too loose
}

// Group upcoming events into scannable time buckets. A flat list of 25 cards
// gives the eye nothing to anchor on; headers let you navigate by scanning.
function timeBucket(days){
  if(days <= 0) return 'Today';
  if(days === 1) return 'Tomorrow';
  if(days <= 7) return 'This week';
  if(days <= 14) return 'Next week';
  if(days <= 31) return 'This month';
  return 'Later';
}

// Duplicates that are already saved -- e.g. a flyer scanned by hand and the same
// announcement arriving by email before matching was improved.
function pairKey(a, b){ return [a.id, b.id].sort().join('~'); }
