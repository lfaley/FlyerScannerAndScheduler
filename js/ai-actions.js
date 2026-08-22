/**
 * The AI capability registry.
 *
 * Every AI-touched capability in the app is declared here, with what it can
 * do, what it cannot, and — most importantly — its RISK CLASS. Settings and
 * the in-context disclosures both render from this list, so the promise a user
 * reads can never drift from what the code actually does. Same discipline the
 * design tokens and the icon sprite already use.
 *
 * Grounded in published guidance rather than intuition (see
 * AI-INTEGRATION-PLAN.md for sources):
 *
 *  - Microsoft HAX G1/G2: make clear what the system can do, and how well.
 *    Hence `can` and `cannot` are required fields, not documentation.
 *  - HAX G16 + Stanford HAI human agency: nothing writes without review, so
 *    there is deliberately NO risk class meaning "acts on its own". A future
 *    contributor cannot add one without editing this file and its test.
 *  - Google PAIR: always provide a non-AI fallback. Every action names the
 *    manual path that does the same job, and a test checks it is filled in.
 */

// The only three classes an AI capability may have. Adding a fourth is a
// deliberate act with a test to update, which is the point.
export const RISK = {
  // Reads data and answers. Changes nothing. Worst case: a wrong answer the
  // user can check, because answers cite what they were based on.
  READ: 'read',
  // Produces a DRAFT. It reaches the user's data only after they review and
  // accept it in the existing review screen. Worst case: wasted taps.
  PROPOSE: 'propose',
  // No model involved at all -- plain, deterministic code. Listed here so the
  // app can be honest that it is NOT AI, which is its own kind of
  // transparency, and so the capability list is complete.
  DERIVE: 'derive',
};

const ALL_RISKS = new Set(Object.values(RISK));

export const AI_ACTIONS = [
  {
    id: 'extract',
    label: 'Read paperwork',
    risk: RISK.PROPOSE,
    can: 'Reads a photo, PDF, link or email and pulls out the dates, times, places and what to bring.',
    cannot: 'It can misread messy handwriting or a low-contrast photo, and it will leave out anything the source does not actually state. Nothing is saved until you review it.',
    fallback: 'Add an event by hand with ＋ Add paperwork → type it in.',
  },
  {
    id: 'ask',
    label: 'Ask about your schedule',
    risk: RISK.READ,
    can: 'Answers questions about the events already in the app — what is coming up, what a particular person has on, when something is due.',
    cannot: 'It only sees the events shown to it, never your whole history, and it cannot look anything up on the internet or change anything. Every answer lists the events it used so you can check it.',
    fallback: 'Search and the person filters on the Events screen.',
  },
  {
    id: 'quickadd',
    label: 'Type it in plain words',
    risk: RISK.PROPOSE,
    can: 'Turns a sentence like "dentist for Braelyn next Tuesday at 3" into a draft event, or a line like "milk, eggs, bread" into list items.',
    cannot: 'It will not guess a date you did not give it. Anything unclear comes back blank for you to fill in, and nothing is saved until you accept it.',
    fallback: 'The normal add form, which is always available.',
  },
  {
    id: 'clashes',
    label: 'Clash and deadline warnings',
    risk: RISK.DERIVE,
    can: 'Points out two events that overlap, a day that has become crowded, and a deadline that has slipped past.',
    cannot: 'Nothing — this one is not AI at all. It is ordinary arithmetic on the dates you already have, so it works offline, costs nothing, and cannot be wrong about a time overlap.',
    fallback: 'n/a — always on, and it does not use the network.',
  },
];

/** Look up one capability. */
export function aiAction(id){
  return AI_ACTIONS.find(a => a.id === id) || null;
}

/**
 * Which capabilities are currently available.
 *
 * HAX G17 (provide global controls) + PAIR (always provide a non-AI fallback):
 * with AI switched off, everything of class read/propose disappears and the
 * app keeps working as a plain manual organiser. `derive` survives, because
 * it never used a model in the first place.
 */
export function availableActions(aiEnabled){
  return AI_ACTIONS.filter(a => aiEnabled || a.risk === RISK.DERIVE);
}

/**
 * Sanity check used by the tests, and cheap enough to be worth exporting:
 * a capability that does not say what it cannot do is not documented.
 */
export function registryProblems(){
  const problems = [];
  const seen = new Set();
  for(const a of AI_ACTIONS){
    if(!a.id || seen.has(a.id)) problems.push(`duplicate or missing id: ${a.id}`);
    seen.add(a.id);
    if(!ALL_RISKS.has(a.risk)) problems.push(`${a.id}: unknown risk class "${a.risk}"`);
    for(const f of ['label', 'can', 'cannot', 'fallback']){
      if(!a[f] || !String(a[f]).trim()) problems.push(`${a.id}: missing ${f}`);
    }
    // G2 is about honesty, and an empty-sounding limitation is not honesty.
    if(a.risk !== RISK.DERIVE && String(a.cannot).length < 40){
      problems.push(`${a.id}: "cannot" is too thin to set expectations`);
    }
  }
  return problems;
}
