/**
 * The intent registry — what the assistant is able to do.
 *
 * Modelled on Apple App Intents / Google App Actions, which is how the
 * platform teams actually solve "assistant inside an app": the app DECLARES
 * its capabilities as typed intents, and the assistant invokes them. It is
 * not a chatbot rummaging around in the data model. See ASSISTANT-PLAN.md.
 *
 * Three rules carried over from that prior art:
 *
 *  1. ONE INTENT PER ACTION, variants via parameters. Not one per phrasing.
 *  2. ONLY EXPOSE WHAT THE USER ALREADY SEES. Apple: expose "only the data
 *     types users see and touch, not your entire data model". So the entities
 *     here are events, chores, lists and people -- not settings, not the
 *     watcher queue, not the problem log.
 *  3. CONSEQUENCE IS DECLARED, NOT IMPLIED. Every intent states what happens
 *     when it runs, and the classes are a closed set. There is deliberately
 *     no class that changes data without the user saying yes.
 */

// The closed set. Adding a fifth is an edit here plus an edit to its test.
export const CONSEQUENCE = {
  ANSWER:   'answer',    // reads and replies; cites what it used
  NAVIGATE: 'navigate',  // moves the user; trivially reversible
  DRAFT:    'draft',     // produces something; lands in the review screen
  CONFIRM:  'confirm',   // changes data; preview + explicit yes first
};
const CLASSES = new Set(Object.values(CONSEQUENCE));

// Parameter types the router may return. Anything else is a bug in the
// registry, and the tests say so.
const TYPES = new Set(['string', 'string[]', 'date', 'time', 'number', 'enum']);

export const INTENTS = [
  {
    id: 'ask_schedule',
    consequence: CONSEQUENCE.ANSWER,
    title: 'Answer a question about the calendar',
    examples: ['What is on this week?', 'When is the next form due?'],
    params: { question: { type:'string', required:true } },
    fallback: 'Search on the Events screen.',
  },
  {
    id: 'ask_chores',
    consequence: CONSEQUENCE.ANSWER,
    title: 'Answer a question about chores and stars',
    examples: ['What chores are due today?', 'How many stars does Olivia have?'],
    params: { question: { type:'string', required:true },
              person:   { type:'string', required:false } },
    fallback: 'The Chores tab shows all of this.',
  },
  {
    id: 'ask_lists',
    consequence: CONSEQUENCE.ANSWER,
    title: 'Answer a question about lists',
    examples: ['What is on the shopping list?'],
    params: { question: { type:'string', required:true },
              list:     { type:'string', required:false } },
    fallback: 'The Lists tab shows all of this.',
  },
  {
    id: 'find_events',
    consequence: CONSEQUENCE.ANSWER,
    title: 'Find matching events',
    examples: ["Show me Braelyn's events", 'Anything at the school next month?'],
    params: { query:     { type:'string', required:false },
              person:    { type:'string', required:false },
              timeframe: { type:'string', required:false } },
    fallback: 'Search and the person filters on the Events screen.',
  },
  {
    id: 'what_needs_doing',
    consequence: CONSEQUENCE.ANSWER,
    title: 'What needs attention',
    examples: ['What needs doing?', 'Anything I am about to miss?'],
    // No model involved in the ANSWER -- it reads the deterministic clash
    // and deadline detector. Routing to it still uses the model.
    params: {},
    fallback: 'The warnings appear on the Events screen anyway.',
  },
  {
    id: 'open_screen',
    consequence: CONSEQUENCE.NAVIGATE,
    title: 'Go to a screen',
    examples: ['Take me to the shopping list', 'Open settings'],
    params: { screen: { type:'enum', required:true,
                        values:['events','chores','lists','meals','settings'] } },
    fallback: 'The tab bar at the bottom.',
  },
  {
    id: 'add_list_item',
    consequence: CONSEQUENCE.CONFIRM,
    title: 'Add items to a list',
    examples: ['Add milk and eggs to the shopping list'],
    params: { list:  { type:'string',   required:true },
              items: { type:'string[]', required:true } },
    fallback: 'Type items straight into the list on the Lists tab.',
  },
  {
    id: 'add_event',
    consequence: CONSEQUENCE.DRAFT,
    title: 'Draft an event',
    examples: ['Dentist for Braelyn next Tuesday at 3'],
    params: { title:  { type:'string', required:true },
              date:   { type:'date',   required:false },
              time:   { type:'time',   required:false },
              person: { type:'string', required:false } },
    fallback: '＋ Add paperwork → type it in.',
  },
  {
    id: 'add_chore',
    consequence: CONSEQUENCE.DRAFT,
    title: 'Draft a chore',
    examples: ['Olivia makes her bed every morning for one star'],
    params: { title:     { type:'string', required:true },
              person:    { type:'string', required:false },
              frequency: { type:'enum',   required:false, values:['daily','weekly'] },
              stars:     { type:'number', required:false } },
    fallback: '＋ Add chore on the Chores tab.',
  },
];

export function intentById(id){ return INTENTS.find(i => i.id === id) || null; }

/** Only ANSWER and NAVIGATE may run without the user agreeing first. */
export function runsWithoutAsking(intent){
  return intent
    ? (intent.consequence === CONSEQUENCE.ANSWER || intent.consequence === CONSEQUENCE.NAVIGATE)
    : false;
}

/** Registry self-check, exported so the test suite can assert on it. */
export function intentRegistryProblems(){
  const out = [];
  const seen = new Set();
  for(const i of INTENTS){
    if(!i.id || seen.has(i.id)) out.push(`duplicate or missing id: ${i.id}`);
    seen.add(i.id);
    if(!CLASSES.has(i.consequence)) out.push(`${i.id}: unknown consequence "${i.consequence}"`);
    if(!i.title) out.push(`${i.id}: no title`);
    if(!i.fallback) out.push(`${i.id}: no non-AI fallback`);
    if(!Array.isArray(i.examples) || !i.examples.length){
      // Examples are what the UI shows as chips. Without them the capability
      // is undiscoverable, which is the exact NN/g failure this design is
      // meant to avoid.
      if(i.id !== 'what_needs_doing') out.push(`${i.id}: no examples to show the user`);
    }
    for(const [name, spec] of Object.entries(i.params || {})){
      if(!TYPES.has(spec.type)) out.push(`${i.id}.${name}: unknown type "${spec.type}"`);
      if(spec.type === 'enum' && !Array.isArray(spec.values)) out.push(`${i.id}.${name}: enum with no values`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entity resolution. Apple's "queries": turn what the user said into the thing
// they meant. Deliberately NOT delegated to the model -- picking the wrong
// list and silently writing to it is precisely the failure that must not
// happen, and matching a name is something code does exactly.
// ---------------------------------------------------------------------------

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * @returns {status:'ok', match} | {status:'none'} | {status:'ambiguous', matches}
 *
 * Never returns a best guess. If two lists could be meant, the caller asks --
 * HAX G10, "scope services when in doubt".
 */
export function resolveEntity(spoken, candidates, nameKey){
  const key = nameKey || 'name';
  const live = (candidates || []).filter(c => c && !c.deleted);
  const q = norm(spoken);
  if(!q) return { status:'none' };

  const exact = live.filter(c => norm(c[key]) === q);
  if(exact.length === 1) return { status:'ok', match: exact[0] };
  if(exact.length > 1)   return { status:'ambiguous', matches: exact };

  // Then containment either way, so "shopping" finds "Shopping list" and
  // "the Costco list" finds "Costco".
  const partial = live.filter(c => {
    const n = norm(c[key]);
    return n && (n.includes(q) || q.includes(n));
  });
  if(partial.length === 1) return { status:'ok', match: partial[0] };
  if(partial.length > 1)   return { status:'ambiguous', matches: partial };
  return { status:'none' };
}
