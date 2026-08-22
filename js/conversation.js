/**
 * Conversation memory for the assistant.
 *
 * HAX G12 is "remember recent interactions", and until now Gordon forgot
 * everything the moment the app was closed. It now persists until the user
 * starts a new chat or clears it.
 *
 * Two things are deliberately separated, because conflating them is how a
 * remembering assistant starts saying wrong things:
 *
 *  - WHAT IS SHOWN. The whole saved conversation, so the user sees continuity.
 *  - WHAT IS SENT. Only the last couple of turns, and only from TODAY.
 *
 * The second rule is not fussiness. Every answer this assistant gives is
 * relative to the date it was asked ("this week", "in 2 days", "tomorrow").
 * Feeding yesterday's answer back in as context invites the model to repeat a
 * claim that has since become false -- and a confidently stale date is exactly
 * the failure this whole app exists to prevent. So a conversation that spans
 * midnight stays visible, with a divider, but starts a fresh context.
 *
 * Pure: no DOM, no app state, no clock of its own.
 */

// Enough to scroll back through, small enough that it cannot bloat a save
// file that iOS may evict if it grows. Storage here is a convenience; the
// user's events are the thing that actually matters.
export const MAX_KEPT_TURNS = 20;

// How many turns are ever sent as context. Kept small on purpose: every extra
// turn widens what leaves the device on a follow-up, which is the same
// discipline the question scoping already applies.
export const MAX_SENT_TURNS = 2;

// A stored answer is for re-reading, not re-processing. Cap it so one long
// reply cannot dominate the save file.
const MAX_STORED_ANSWER = 1200;

/** Strip a saved conversation down to what is worth keeping. */
export function trimConversation(turns){
  return (turns || [])
    .filter(t => t && typeof t.q === 'string' && typeof t.a === 'string')
    .slice(-MAX_KEPT_TURNS)
    .map(t => ({
      q: String(t.q).slice(0, 500),
      a: String(t.a).slice(0, MAX_STORED_ANSWER),
      day: t.day || null,
      domain: t.domain || 'events',
      // Only the ids are kept: the cards are re-rendered from live events, so
      // a saved copy would go stale the moment an event is edited.
      cited: (t.cited || []).map(c => ({ id: c.id, line: String(c.line || '').slice(0, 200) })),
      sourceNote: String(t.sourceNote || '').slice(0, 200),
    }));
}

/** Was this turn asked on the given day? */
export function isSameDay(turn, todayISO){
  return !!turn && turn.day === todayISO;
}

/**
 * Where the "earlier" divider goes: the index of the first turn from today.
 * -1 means every saved turn is from a previous day.
 */
export function firstTurnOfToday(turns, todayISO){
  return (turns || []).findIndex(t => isSameDay(t, todayISO));
}

/**
 * The turns that may be sent to the model as context.
 * Today's only, and at most MAX_SENT_TURNS of them.
 */
export function contextTurns(turns, todayISO){
  return (turns || [])
    .filter(t => isSameDay(t, todayISO))
    .slice(-MAX_SENT_TURNS)
    .map(t => ({ q: t.q, a: t.a }));
}

/** True when the saved conversation is from before today. */
export function isCarriedOver(turns, todayISO){
  const list = turns || [];
  if(!list.length) return false;
  return !list.some(t => isSameDay(t, todayISO));
}
