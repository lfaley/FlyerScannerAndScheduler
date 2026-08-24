/**
 * Turning a routed sentence into something the app can act on.
 *
 * The router (js/router.js) decides WHAT was meant. This decides what the app
 * should be handed. Between them there is deliberately no model: the router's
 * output is untrusted, and everything below is pure code that either produces
 * a well-formed draft or refuses.
 *
 * Three jobs:
 *
 *  1. CHIP SELECTION. NN/g's chatbot research found "the burden of figuring
 *     out what the bot can and can't do fell on the user", and their prompt-
 *     control study names discoverability and education as the first two uses
 *     of suggestion chips. Taking the first four intents in file order gave
 *     four questions and advertised none of the things Gordon can DO, so the
 *     chips are now chosen to cover every consequence class.
 *
 *  2. ACTION NAMES. Apple's App Intents confirmation API takes an
 *     `actionName` -- "the name to use in the button that confirms the
 *     action". "Delete Recital" and "Add 3 items" are different promises and
 *     must not share a button reading "Yes, do it".
 *
 *  3. DRAFT SHAPING. A person named in the sentence must survive into the
 *     draft. It previously did not: add_event declared a `person` parameter
 *     and then set `personIds: []`.
 *
 * Pure: no DOM, no app state, no clock of its own.
 */

import { INTENTS, CONSEQUENCE, intentById } from './intents.js';
import { resolveEntity } from './intents.js';

// ---------------------------------------------------------------------------
// 1. Chips
// ---------------------------------------------------------------------------

/**
 * The examples shown under "Try one of these".
 *
 * Guarantees at least one example from each consequence class the registry
 * actually has, then fills the remaining slots in registry order. A test
 * fails the build if the result is all one class, because that is the exact
 * state v9.13 shipped in: four questions, and no hint that it can act.
 */
export function capabilityChips(limit){
  const n = typeof limit === 'number' && limit > 0 ? limit : 4;
  const withExamples = INTENTS.filter(i => (i.examples || []).length);

  // One per class, in the order a user meets them: ask, then act.
  const ORDER = [CONSEQUENCE.ANSWER, CONSEQUENCE.DRAFT, CONSEQUENCE.CONFIRM, CONSEQUENCE.NAVIGATE];
  const picked = [];
  const used = new Set();
  for(const cls of ORDER){
    if(picked.length >= n) break;
    // Prefer a non-destructive example: the first thing a user is invited to
    // try must not be a deletion.
    const i = withExamples.find(x => x.consequence === cls && !x.destructive && !used.has(x.id));
    if(i){ picked.push(i); used.add(i.id); }
  }
  for(const i of withExamples){
    if(picked.length >= n) break;
    if(!used.has(i.id) && !i.destructive){ picked.push(i); used.add(i.id); }
  }
  return picked.slice(0, n).map(i => i.examples[0]);
}

// ---------------------------------------------------------------------------
// 2. Action names for the confirm button
// ---------------------------------------------------------------------------

/**
 * What the confirming button should say. Named for the act, per App Intents.
 * `target` is the resolved entity, so the button can name the actual thing.
 */
export function actionName(route, target){
  if(!route || !route.ok) return 'Do it';
  const p = route.params || {};
  const name = target && (target.name || target.title);
  const short = (s) => {
    const t = String(s == null ? '' : s).trim();
    return t.length > 24 ? t.slice(0, 23).trimEnd() + '…' : t;
  };
  switch(route.intent){
    case 'add_list_item':
      return `Add ${p.items.length} item${p.items.length === 1 ? '' : 's'}`;
    case 'create_list':      return `Create ${short(p.name)}`;
    case 'check_list_item':
      return `Tick off ${p.items.length} item${p.items.length === 1 ? '' : 's'}`;
    case 'complete_chore':   return name ? `Mark ${short(name)} done` : 'Mark it done';
    case 'mark_event_handled': return 'Mark as handled';
    case 'edit_event':       return name ? `Update ${short(name)}` : 'Update it';
    case 'delete_event':
    case 'delete_chore':     return name ? `Delete ${short(name)}` : 'Delete it';
    case 'enrich_batch':     return p.scope === 'selected' ? 'Apply to selected' : 'Apply to all';
    default:                 return 'Do it';
  }
}

/** Destructive intents get a red button and a blunter preview. */
export function isDestructive(route){
  const i = route && route.ok ? intentById(route.intent) : null;
  return !!(i && i.destructive);
}

// ---------------------------------------------------------------------------
// 3. Draft shaping
// ---------------------------------------------------------------------------

/**
 * Resolve a spoken person name against the people in Settings.
 *
 * Returns the id, or null. Deliberately NEVER guesses: an ambiguous or
 * unknown name yields null and the draft is simply untagged, which the user
 * fixes in one tap on a screen that is already open. Tagging the WRONG child
 * is worse than tagging none, because it looks correct.
 */
export function resolvePersonId(spoken, people){
  if(!spoken) return null;
  const res = resolveEntity(spoken, people, 'name');
  return res.status === 'ok' ? res.match.id : null;
}

const DAY_KEYS = ['sun','mon','tue','wed','thu','fri','sat'];

/** Normalise whatever the model said about days into the app's own keys. */
export function normaliseDays(days){
  const out = [];
  for(const d of (Array.isArray(days) ? days : [])){
    const k = String(d || '').toLowerCase().slice(0, 3);
    if(DAY_KEYS.includes(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * The row handed to the review screen.
 *
 * Shape copied from what the extraction path produces, so the review screen
 * cannot tell an assistant draft from a scanned flyer -- one review screen,
 * one set of bugs.
 */
export function buildEventDraft(params, people, modelName){
  const p = params || {};
  // A deadline and an event look identical on a flyer but behave differently:
  // only a deadline can be "missed", which is what the warnings key off.
  const kind = p.kind === 'deadline' ? 'deadline' : 'event';
  const personId = resolvePersonId(p.person, people);
  return {
    title: String(p.title || '').trim(),
    date: p.date || '',
    time: p.time || '',
    endTime: null,
    kind,
    location: p.location ? String(p.location) : null,
    notes: p.notes ? String(p.notes) : null,
    selected: true,
    dup: false,
    personIds: personId ? [personId] : [],
    kidId: null,
    aiSource: modelName || null,
  };
}

/**
 * The pre-filled chore form. Field shape copied from newChoreForm() so the
 * form renders identically; note it is SET, never produced by calling
 * newChoreForm(), which takes no arguments and resets the form -- calling it
 * here would silently discard the draft.
 */
export function buildChoreDraft(params, people){
  const p = params || {};
  const days = normaliseDays(p.days);
  // Weekly with no days named would fail the form's own validation on save,
  // which reads as the assistant producing something broken. Fall back to
  // daily and let the user pick days if that is what they meant.
  const frequency = p.frequency === 'weekly' && days.length ? 'weekly' : 'daily';
  return {
    title: String(p.title || '').trim(),
    kidId: resolvePersonId(p.person, people),
    frequency,
    days: frequency === 'weekly' ? days : [],
    stars: typeof p.stars === 'number' && isFinite(p.stars)
      ? Math.max(0, Math.min(20, Math.round(p.stars))) : 1,
  };
}

/**
 * Which fields an edit_event actually changes, dropping anything that would
 * be a no-op. An empty result means "nothing to do" and the caller says so
 * rather than writing an identical row and claiming success.
 */
export function eventEditChanges(params, event){
  const p = params || {};
  const e = event || {};
  const out = {};
  if(p.date && p.date !== e.date) out.date = p.date;
  if(p.time && p.time !== (e.time || '')) out.time = p.time;
  if(p.title && String(p.title).trim() && String(p.title).trim() !== e.title) out.title = String(p.title).trim();
  return out;
}

/** Plain English for what an edit will do, before it happens (HAX G16). */
export function describeEdit(changes, event){
  const c = changes || {};
  const bits = [];
  if(c.title) bits.push(`rename it to "${c.title}"`);
  if(c.date)  bits.push(`move it to ${c.date}`);
  if(c.time)  bits.push(`set the time to ${c.time}`);
  if(!bits.length) return 'Nothing about that would change.';
  const name = (event && event.title) || 'that event';
  return `Change "${name}": ` + bits.join(', ') + '.';
}

/**
 * Match spoken item texts against the items actually on a list.
 *
 * Returns the matched rows and the words that matched nothing, so the caller
 * can say "ticked off milk; there is no bread on that list" instead of
 * silently doing half the job.
 */
export function matchListItems(spoken, items){
  const live = (items || []).filter(i => i && !i.deleted);
  const matched = [];
  const missing = [];
  for(const word of (Array.isArray(spoken) ? spoken : [])){
    const res = resolveEntity(word, live, 'text');
    if(res.status === 'ok' && !matched.some(m => m.id === res.match.id)) matched.push(res.match);
    else if(res.status === 'ambiguous'){
      // Two items reading the same thing: ticking either satisfies the
      // request, and refusing here would be pedantic rather than safe.
      const first = res.matches.find(m => !matched.some(x => x.id === m.id));
      if(first) matched.push(first); else missing.push(String(word));
    }
    else missing.push(String(word));
  }
  return { matched, missing };
}
