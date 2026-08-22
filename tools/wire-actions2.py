#!/usr/bin/env python3
"""v9.14 part 2 — the CONFIRM branches and the single write path."""
import sys
p='index.html'; src=open(p).read(); fail=[]
def rep(o,n,c=1):
    global src
    got=src.count(o)
    if got!=c: fail.append(f'expected {c}x {o[:90]!r}, found {got}'); return
    src=src.replace(o,n)

OLD = """  // ---- CONFIRM: never acts here; only proposes --------------------------
  if(route.intent === 'add_list_item'){
    const res = resolveEntity(route.params.list, S.lists);
    if(res.status === 'none'){
      return { answer:`There is no list called "${route.params.list}". Your lists are: `
        + (S.lists.filter(l=>!l.deleted).map(l=>l.name).join(', ') || 'none yet') + '.',
        cited:[], domain:'lists', sourceNote:'' };
    }
    if(res.status === 'ambiguous'){
      pendingAction = { route, choices: res.matches };
      return { answer:'Which list did you mean?', cited:[], domain:'lists',
        sourceNote:'', choices: res.matches.map(m => ({ id:m.id, name:m.name })) };
    }
    pendingAction = { route, target: res.match };
    return { answer: describeIntent(route, res.match), cited:[], domain:'lists',
      sourceNote:'', confirm:true };
  }
  return { answer:'That is not something I can do yet.', cited:[], domain:'events', sourceNote:'' };
}"""

NEW = r"""  // ---- CONFIRM: never acts here; only proposes --------------------------
  //
  // Every branch below resolves the entity FIRST and refuses when two things
  // could be meant (HAX G10, "scope services when in doubt"). Not one of them
  // writes: confirmPendingAction() is the only path in the app that turns an
  // assistant sentence into a change, and everything it does is undoable.
  //
  // Apple's App Intents confirmation carries an `actionName` -- "the name to
  // use in the button that confirms the action" -- so the button says what it
  // will do rather than "Yes, do it".
  const propose = (domain, target, answer, extra) => {
    pendingAction = Object.assign({ route, target, collection: null }, extra || {});
    return { answer: answer || describeIntent(route, target), cited:[], domain,
      sourceNote:'', confirm:true,
      actionName: actionName(route, target), destructive: isDestructive(route) };
  };
  // "Which one did you mean?" -- the app asks instead of picking. `collection`
  // tells confirmPendingAction where to look the chosen id back up.
  const askWhich = (domain, matches, collection, nameKey) => {
    pendingAction = { route, target:null, collection };
    return { answer:'Which one did you mean?', cited:[], domain, sourceNote:'',
      choices: matches.map(m => ({ id:m.id, name:m[nameKey || 'name'] })) };
  };
  const nothing = (domain, answer) => ({ answer, cited:[], domain, sourceNote:'' });

  const liveLists  = () => S.lists.filter(l => !l.deleted);
  const liveChores = () => S.chores.filter(c => !c.deleted);
  const liveEvents = () => S.events.filter(e => !e.deleted);
  const nameList = (rows, key) => rows.map(r => r[key]).join(', ') || 'none yet';

  if(route.intent === 'create_list'){
    const wanted = String(route.params.name || '').trim();
    const clash = resolveEntity(wanted, S.lists, 'name');
    if(clash.status === 'ok'){
      return nothing('lists', `You already have a list called "${clash.match.name}".`);
    }
    return propose('lists', null, `Start a new list called "${wanted}".`);
  }

  if(route.intent === 'add_list_item'){
    const res = resolveEntity(route.params.list, S.lists);
    if(res.status === 'none'){
      return nothing('lists', `There is no list called "${route.params.list}". `
        + `Your lists are: ${nameList(liveLists(), 'name')}.`);
    }
    if(res.status === 'ambiguous') return askWhich('lists', res.matches, 'lists');
    return propose('lists', res.match);
  }

  if(route.intent === 'check_list_item'){
    // The list is optional: with one list there is nothing to disambiguate.
    let list = null;
    if(route.params.list){
      const res = resolveEntity(route.params.list, S.lists);
      if(res.status === 'none'){
        return nothing('lists', `There is no list called "${route.params.list}". `
          + `Your lists are: ${nameList(liveLists(), 'name')}.`);
      }
      if(res.status === 'ambiguous') return askWhich('lists', res.matches, 'lists');
      list = res.match;
    } else if(liveLists().length === 1){
      list = liveLists()[0];
    } else {
      return askWhich('lists', liveLists(), 'lists');
    }
    const items = S.listItems.filter(i => i.listId === list.id && !i.deleted && !i.checked);
    const { matched, missing } = matchListItems(route.params.items, items);
    if(!matched.length){
      return nothing('lists', `Nothing on "${list.name}" matches ${route.params.items.join(', ')}.`);
    }
    const note = missing.length ? `\n\nNot on that list: ${missing.join(', ')}.` : '';
    return propose('lists', list,
      `Tick off ${matched.map(m => '"' + m.text + '"').join(', ')} on "${list.name}".` + note,
      { itemIds: matched.map(m => m.id) });
  }

  if(route.intent === 'complete_chore'){
    const res = resolveEntity(route.params.chore, S.chores, 'title');
    if(res.status === 'none'){
      return nothing('chores', `There is no chore called "${route.params.chore}". `
        + `Your chores are: ${nameList(liveChores(), 'title')}.`);
    }
    if(res.status === 'ambiguous') return askWhich('chores', res.matches, 'chores', 'title');
    if(completionFor(res.match.id, todayISO())){
      return nothing('chores', `"${res.match.title}" is already ticked off for today.`);
    }
    // The person is resolved here so the stars land on the right child; an
    // unrecognised name falls through to the app's own "who did it?" sheet
    // rather than guessing.
    const kidId = resolvePersonId(route.params.person, justKids());
    const kid = kidId ? personById(kidId) : null;
    return propose('chores', res.match,
      `Mark "${res.match.title}" done for today${kid ? ' — ' + kid.name : ''}.`
      + (route.params.person && !kid ? `\n\nI did not recognise "${route.params.person}", so I will ask who did it.` : ''),
      { kidId });
  }

  if(route.intent === 'mark_event_handled'){
    const res = resolveEntity(route.params.event, liveEvents(), 'title');
    if(res.status === 'none'){
      return nothing('events', `I cannot find anything called "${route.params.event}".`);
    }
    if(res.status === 'ambiguous') return askWhich('events', res.matches, 'events', 'title');
    if(res.match.handled){
      return nothing('events', `"${res.match.title}" is already marked as handled.`);
    }
    return propose('events', res.match,
      `Mark "${res.match.title}" as handled, so it stops warning you.`);
  }

  if(route.intent === 'edit_event'){
    const res = resolveEntity(route.params.event, liveEvents(), 'title');
    if(res.status === 'none'){
      return nothing('events', `I cannot find an event called "${route.params.event}".`);
    }
    if(res.status === 'ambiguous') return askWhich('events', res.matches, 'events', 'title');
    const changes = eventEditChanges(route.params, res.match);
    if(!Object.keys(changes).length){
      // Writing an identical row and reporting success is a lie the user
      // cannot see through.
      return nothing('events', describeEdit(changes, res.match));
    }
    return propose('events', res.match, describeEdit(changes, res.match), { changes });
  }

  if(route.intent === 'delete_event' || route.intent === 'delete_chore'){
    const isChore = route.intent === 'delete_chore';
    const spoken = isChore ? route.params.chore : route.params.event;
    const res = resolveEntity(spoken, isChore ? S.chores : liveEvents(), 'title');
    if(res.status === 'none'){
      return nothing(isChore ? 'chores' : 'events',
        `I cannot find ${isChore ? 'a chore' : 'an event'} called "${spoken}".`);
    }
    // A delete is the one place ambiguity absolutely must not resolve itself.
    if(res.status === 'ambiguous') return askWhich(isChore ? 'chores' : 'events', res.matches,
      isChore ? 'chores' : 'events', 'title');
    return propose(isChore ? 'chores' : 'events', res.match);
  }

  return { answer:'That is not something I can do yet.', cited:[], domain:'events', sourceNote:'' };
}"""

rep(OLD, NEW)

OLDC = """/** The explicit yes. This is the only path that writes. */
function confirmPendingAction(listId){
  if(!pendingAction){ return; }
  const route = pendingAction.route;
  const target = listId
    ? S.lists.find(l => l.id === listId)
    : pendingAction.target;
  pendingAction = null;
  if(!target){ toast('That list is gone'); render(); return; }
  if(route.intent === 'add_list_item'){
    route.params.items.forEach(text => {
      S.listItems.push({ id:uid(), listId:target.id, text:String(text), checked:false, deleted:false });
    });
    save();
    const n = route.params.items.length;
    // Undo, same as every other destructive-ish action in the app.
    toast(`Added ${n} item${n===1?'':'s'} to ${target.name}`, { label:'Undo', fn:() => {
      S.listItems = S.listItems.filter(i => !(i.listId === target.id
        && route.params.items.includes(i.text) && !i.checked));
      save(); render(); toast('Undone');
    }});
  }
  render();
}"""

NEWC = r"""/**
 * The explicit yes. This is the only path in the app that turns an assistant
 * sentence into a change.
 *
 * It calls the app's OWN functions wherever one exists -- softDelete,
 * markHandled, completeChore -- rather than reimplementing the write. A second
 * implementation is a second set of bugs, and completeChore in particular
 * carries behaviour Gordon must not skip (the "who did it?" sheet on a chore
 * that belongs to nobody). Everything here is undoable.
 */
function confirmPendingAction(chosenId){
  if(!pendingAction){ return; }
  const pa = pendingAction;
  const route = pa.route;

  // Coming back from a "which one did you mean?" prompt.
  let target = pa.target;
  if(chosenId){
    const coll = pa.collection && S[pa.collection] ? S[pa.collection] : [];
    target = coll.find(x => x.id === chosenId) || null;
  }
  pendingAction = null;

  const needsTarget = route.intent !== 'create_list';
  if(needsTarget && !target){ toast('That is gone now'); render(); return; }

  switch(route.intent){
    case 'create_list': {
      const name = String(route.params.name || '').trim();
      if(!name) break;
      const row = { id:uid(), name, deleted:false };
      S.lists.push(row); save();
      toast(`Started "${name}"`, { label:'Undo', fn:() => {
        S.lists = S.lists.filter(l => l.id !== row.id); save(); render(); toast('Undone');
      }});
      break;
    }
    case 'add_list_item': {
      const added = route.params.items.map(text => {
        const row = { id:uid(), listId:target.id, text:String(text), checked:false, deleted:false };
        S.listItems.push(row); return row.id;
      });
      save();
      toast(`Added ${added.length} item${added.length===1?'':'s'} to ${target.name}`,
        { label:'Undo', fn:() => {
          // By id, not by text: undoing must not remove an identically-named
          // item the user added themselves.
          S.listItems = S.listItems.filter(i => !added.includes(i.id));
          save(); render(); toast('Undone');
        }});
      break;
    }
    case 'check_list_item': {
      const ids = pa.itemIds || [];
      const changed = S.listItems.filter(i => ids.includes(i.id) && !i.checked);
      changed.forEach(i => { i.checked = true; });
      save();
      toast(`Ticked off ${changed.length} item${changed.length===1?'':'s'}`,
        { label:'Undo', fn:() => {
          changed.forEach(i => { i.checked = false; });
          save(); render(); toast('Undone');
        }});
      break;
    }
    case 'complete_chore': {
      // completeChore handles stars and the toast; toggleChore handles the
      // "who did it?" sheet when the chore belongs to nobody. Use whichever
      // matches what we know, so the assistant path behaves like a tap.
      const kidId = pa.kidId || target.kidId || null;
      if(kidId) completeChore(target, kidId); else toggleChore(target.id);
      break;
    }
    case 'mark_event_handled':
      markHandled(target.id);
      break;
    case 'edit_event': {
      const changes = pa.changes || {};
      const before = { date: target.date, time: target.time, title: target.title };
      Object.assign(target, changes);
      save();
      toast(`Updated "${target.title}"`, { label:'Undo', fn:() => {
        Object.assign(target, before); save(); render(); toast('Put back');
      }});
      break;
    }
    case 'delete_event':
      softDelete('events', target.id, '"' + target.title + '"');
      break;
    case 'delete_chore':
      // Stars already earned are kept either way -- softDelete only flags the
      // chore row, and completions are a separate collection.
      softDelete('chores', target.id, '"' + target.title + '"');
      break;
  }
  render();
}"""

rep(OLDC, NEWC)

# The choice buttons already call confirmPendingAction(id); the label now
# comes from whichever collection was offered.
rep("""      ${t.choices ? t.choices.map(c => `<button class="btn alt" style="margin-bottom:8px"
          onclick="confirmPendingAction('${esc(c.id)}')">${esc(c.name)}</button>`).join('')""",
"""      ${t.choices && pendingAction ? t.choices.map(c => `<button class="btn alt" style="margin-bottom:8px"
          onclick="confirmPendingAction('${esc(c.id)}')">${esc(c.name)}</button>`).join('')""")

if fail:
    print('FAILED — nothing written:'); [print(' ',f) for f in fail]; sys.exit(1)
open(p,'w').write(src); print('actions wired (part 2)')
