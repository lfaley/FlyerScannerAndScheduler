#!/usr/bin/env python3
"""v9.73 - the four P5 candidates, reproduced and then fixed.

The Aug 2026 review READ these four and left them marked unverified, because a
mechanism you have only read is a lead, not a finding (CLAUDE.md rule 25).
tools/p5-repro-four.js now executes all of them. Six confirmed, none refuted --
and one of those six only after the probe itself was fixed: the first draft read
`pendingAction` from OUTSIDE the vm, got `undefined` whatever the app had done,
and reported "REFUTED" on an artefact of its own harness. That is rule 25 biting
the tool written to serve it, for the tenth time.

  A  contextFromPs returned llama3:70b's 8192 when asked about a model that was
     not loaded -- against its own docblock, which says it "returns null rather
     than a guess ... a made-up number here would produce confident wrong
     advice, which is worse than none". Measured: 8192.

  B  localCtx is cached for the session and NOTHING clears it. Measured: change
     the model, re-select the provider, and the window is still 32768. Worse,
     localCtxAsked is set BEFORE the fetch, so one failed probe means the app
     never asks again for the rest of the session.

  C  "Which one did you mean?" with ZERO lists. `askWhich('lists', liveLists())`
     with an empty array -- and `[]` is truthy, so the screen renders the
     question, no buttons, and a "Neither" link. Measured.

  C2 The same disambiguation stores { route, target, collection } and never the
     matched item ids, while confirmPendingAction's check_list_item case reads
     `pa.itemIds`. Measured: MISSING -> `ids` is [] -> it ticks nothing off.
     Picking the list from the prompt silently did nothing.

  D  Clarify options arrive as STRINGS (the prompt at :2393 asks for
     ["choice A","choice B"]) and the renderer reads c.id / c.name. Measured:
     [{},{}] -- two blank buttons.

  D2 ...behind `t.choices && pendingAction`, and a clarify turn never sets
     pendingAction. So D has never been seen: the buttons were unreachable.
     Fixing D alone would have SHIPPED the blank buttons.

D and D2 together are the reason to fix both at once, and the reason the review
insisted on reading a whole path rather than a line.
"""
import sys

fail = []
buf = {}

def _get(path):
    if path not in buf:
        buf[path] = open(path).read()
    return buf[path]

def rep(path, o, n, c=1):
    src = _get(path)
    got = src.count(o)
    if got != c:
        fail.append(f'{path}: expected {c}x {o[:90]!r}, found {got}')
        return
    buf[path] = src.replace(o, n)

p = 'index.html'

# ========================================================================== A
rep(p, """  const hit = named || models[0];
  const n = hit && (hit.context_length != null ? hit.context_length : hit.contextLength);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;""",
"""  // NO FALLBACK TO models[0]. Until v9.73 an unloaded model returned whatever
  // the first loaded one happened to be -- measured at 8192 (llama3:70b) while
  // the caller was asking about a 32k model. That is precisely the "confident
  // wrong advice" the docblock above promises not to give, and it is worse than
  // silence because the advice it feeds is about whether a prompt will FIT.
  // When no name was asked for at all, the single loaded model is still the
  // only sensible answer (code review P5, reproduced by execution 29 Aug).
  const hit = want ? named : models[0];
  if(!hit) return null;
  const n = hit.context_length != null ? hit.context_length : hit.contextLength;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;""")

# ========================================================================== B
rep(p, """let localCtx = null;
let localCtxAsked = false;""",
"""let localCtx = null;
let localCtxAsked = false;
// WHICH model and endpoint the cached window belongs to. Without this the cache
// was answered for the life of the session no matter what the user changed:
// measured 29 Aug -- set the model to something else, re-select the provider,
// and probeLocalContext still returned the old 32768 (code review P5).
let localCtxFor = '';
function localCtxKey(){
  return ((S.settings && S.settings.localBaseUrl) || '') + '|'
       + ((S.settings && S.settings.localModel) || '');
}
/** Forget the probed window. Called wherever the thing it describes changes. */
function invalidateLocalContext(){
  localCtx = null; localCtxAsked = false; localCtxFor = '';
}""")

rep(p, """async function probeLocalContext(){
  if(localCtxAsked) return localCtx;
  localCtxAsked = true;""",
"""async function probeLocalContext(){
  const key = localCtxKey();
  if(localCtxAsked && localCtxFor === key) return localCtx;
  localCtxAsked = true;
  localCtxFor = key;""")

# A probe that FAILED must not poison the session. Only a real answer sticks.
rep(p, """    if(!res.ok) return null;
    localCtx = contextFromPs(await res.json(), (S.settings.localModel || '').trim());
  }catch(e){
    localCtx = null;
  }
  return localCtx;""",
"""    // A probe that could not answer must not be cached as "no window". It is
    // best-effort, and one blocked /api/ps used to silence the check for the
    // rest of the session (code review P5).
    if(!res.ok){ localCtxAsked = false; return null; }
    localCtx = contextFromPs(await res.json(), (S.settings.localModel || '').trim());
    if(localCtx === null) localCtxAsked = false;
  }catch(e){
    localCtx = null;
    localCtxAsked = false;
  }
  return localCtx;""")

# ========================================================================== C
rep(p, """  const askWhich = (domain, matches, collection, nameKey) => {
    pendingAction = { route, target:null, collection };
    return { answer:'Which one did you mean?', cited:[], domain, sourceNote:'',
      choices: matches.map(m => ({ id:m.id, name:m[nameKey || 'name'] })) };
  };""",
"""  const askWhich = (domain, matches, collection, nameKey, extra) => {
    // AN EMPTY LIST IS NOT A QUESTION. `[]` is truthy, so asking "which one did
    // you mean?" with nothing to offer rendered the question, zero buttons and
    // a "Neither" link -- measured 29 Aug with a user who had no lists at all
    // (code review P5). Say the true thing instead.
    if(!matches || !matches.length){
      return nothing(domain, 'You do not have any ' + domain + ' yet.');
    }
    // `extra` carries whatever confirmPendingAction will need AFTER the choice
    // is made. check_list_item reads pa.itemIds, and until v9.73 nothing ever
    // put them there -- so picking the list from this prompt ticked nothing off.
    pendingAction = Object.assign({ route, target:null, collection }, extra || {});
    return { answer:'Which one did you mean?', cited:[], domain, sourceNote:'',
      choices: matches.map(m => ({ id:m.id, name:m[nameKey || 'name'] })) };
  };""")

# ...and the check_list_item branch hands the items forward.
rep(p, """    } else if(liveLists().length === 1){
      list = liveLists()[0];
    } else {
      return askWhich('lists', liveLists(), 'lists');
    }""",
"""    } else if(liveLists().length === 1){
      list = liveLists()[0];
    } else {
      // Carry the item NAMES, not ids: the ids can only be resolved once we
      // know which list, which is the whole point of the question being asked.
      return askWhich('lists', liveLists(), 'lists', null,
        { pendingItems: route.params.items || [] });
    }""")

# confirmPendingAction resolves the names against the chosen list.
rep(p, """    case 'check_list_item': {
      const ids = pa.itemIds || [];""",
"""    case 'check_list_item': {
      // When the list was chosen from a "which one?" prompt there are no
      // itemIds yet -- the ids only exist once the list does. Resolve the names
      // the user actually said against the list they actually picked. Before
      // v9.73 this read an itemIds nobody ever set, so answering the question
      // ticked nothing off (code review P5, reproduced).
      let ids = pa.itemIds || [];
      if(!ids.length && pa.pendingItems && target){
        const open = S.listItems.filter(i => i.listId === target.id && !i.deleted && !i.checked);
        ids = matchListItems(pa.pendingItems, open).matched.map(i => i.id);
      }""")

# ========================================================================== D
# Options arrive as strings. Normalise at the ONE place they are stored, so the
# renderer has a single shape to read, and open the gate a clarify can pass.
rep(p, """          choices: parsed.turn.kind === 'clarify' ? (parsed.turn.options || null) : null });""",
"""          // NORMALISE HERE, once. The prompt asks the model for
          // {"clarify":"...","options":["A","B"]} -- strings -- while the
          // renderer reads {id,name}. It emitted [{},{}]: two blank buttons.
          // Nobody ever saw them, because the gate below also required a
          // pendingAction that a clarify never sets, so fixing only one of the
          // two would have SHIPPED the blank buttons (code review P5).
          choices: parsed.turn.kind === 'clarify' ? clarifyChoices(parsed.turn.options) : null });""")

rep(p, """// Parse one model reply into a turn: {ok, turn:{kind:'message'|'clarify'|'tool', ...}}.""",
"""/**
 * The model's clarify options -> the {id,name} shape the answer list renders.
 *
 * The options come back as plain strings, because that is what the prompt asks
 * for. Tolerant of an object too, in case a model volunteers one.
 */
function clarifyChoices(options){
  const rows = (Array.isArray(options) ? options : [])
    .map(o => (o && typeof o === 'object')
      ? { id:String(o.id != null ? o.id : (o.name || '')), name:String(o.name || o.id || '') }
      : { id:String(o), name:String(o) })
    .filter(o => o.name.trim());
  return rows.length ? rows : null;
}

// Parse one model reply into a turn: {ok, turn:{kind:'message'|'clarify'|'tool', ...}}.""")

# The gate. A clarify has choices and no pendingAction; a disambiguation has
# both. Both must render, and they answer differently.
rep(p, """      ${t.choices && pendingAction && i === a.turns.length - 1
        ? t.choices.map(c => `<button class="btn alt" style="margin-bottom:8px"
          onclick="confirmPendingAction('${esc(c.id)}')">${esc(c.name)}</button>`).join('')
          + `<div style="text-align:center"><button class="linkbtn" onclick="cancelPendingAction()">Neither</button></div>` : ''}""",
"""      ${t.choices && t.choices.length && i === a.turns.length - 1
        ? (pendingAction
            // A disambiguation: the app already knows what to do, it just needs
            // to be told WHICH thing. The choice is an entity id.
            ? t.choices.map(c => `<button class="btn alt" style="margin-bottom:8px"
                onclick="confirmPendingAction('${esc(c.id)}')">${esc(c.name)}</button>`).join('')
              + `<div style="text-align:center"><button class="linkbtn" onclick="cancelPendingAction()">Neither</button></div>`
            // A clarify: the model asked a question and there is nothing pending.
            // The answer is TEXT, so tapping one sends it as the next turn --
            // until v9.73 this branch did not exist and the buttons never
            // rendered at all (code review P5).
            : t.choices.map(c => `<button class="btn alt" style="margin-bottom:8px"
                onclick="answerClarify('${esc(c.name)}')">${esc(c.name)}</button>`).join(''))
        : ''}""")

rep(p, """function cancelPendingAction(){""",
"""/**
 * Tap one of a clarify's options: it is an ANSWER, not an id, so it goes back
 * to the model as the next thing the user said. Same path as typing it.
 */
function answerClarify(text){
  runAsk(text);
}

function cancelPendingAction(){""")

rep(p, """  addNoteCheckItem,
  addNoteGroup,""",
"""  addNoteCheckItem,
  addNoteGroup,
  answerClarify,""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
for path, text in buf.items():
    open(path, 'w').write(text)
print('four P5 candidates fixed ->', ', '.join(sorted(buf)))
