#!/usr/bin/env python3
"""v9.14 — Gordon can act. Wire js/assistant-actions.js and the new intents in.

See ASSISTANT-ACTIONS-PLAN.md. The capability already existed; what was
missing was discoverability, the person parameter, and the six new CONFIRM
intents Logan asked for.
"""
import sys, re
p='index.html'; src=open(p).read(); fail=[]
def rep(o,n,c=1):
    global src
    got=src.count(o)
    if got!=c: fail.append(f'expected {c}x {o[:90]!r}, found {got}'); return
    src=src.replace(o,n)

def inline(path):
    body = open(path).read()
    body = re.sub(r'^import\s[^;]*;\s*$', '', body, flags=re.M)
    body = re.sub(r'^export\s+', '', body, flags=re.M)
    return body.strip()

# 1. Re-inline intents.js and router.js (both changed), and inline the new
#    actions.js after them. The drift test compares the whole file body, so a
#    partial patch of the inlined copy would fail the build.
def resync(path, first_line, last_line):
    global src
    body = inline(path)
    start = src.find(first_line)
    end = src.find(last_line)
    if start < 0 or end < 0:
        fail.append(f'{path}: could not find inline boundaries'); return
    end += len(last_line)
    src = src[:start] + body + src[end:]

resync('js/intents.js',
       "const CONSEQUENCE = {",
       "  return { status:'none' };\n}")
resync('js/router.js',
       "const MIN_CONFIDENCE = 0.6;",
       "  return validateRoute({ intent, params, confidence: 0.95 });\n}")

# actions.js goes straight after the router block.
rep("""  return validateRoute({ intent, params, confidence: 0.95 });
}
""",
"""  return validateRoute({ intent, params, confidence: 0.95 });
}

""" + inline('js/assistant-actions.js') + "\n")

# 2. The chips. The old helper picked the first four intents in registry
#    order, which were four QUESTIONS -- so nothing on the screen ever hinted
#    that Gordon can act. capabilityChips() guarantees one per consequence
#    class. (NN/g: "the burden of figuring out what the bot can and can't do
#    fell on the user".)
rep("""function assistantCapabilityChips(){
  // NN/g: a conversational surface "places the burden of discovering an app's
  // capabilities upon the user". These chips remove that burden -- recognition
  // instead of recall -- and they are generated from the registry, so they
  // cannot advertise something the app cannot do.
  return INTENTS.filter(i => (i.examples || []).length)
    .map(i => i.examples[0])
    .slice(0, 4);   // four is enough to teach the shape; six is a wall
}""",
"""// Kept as a thin wrapper so every call site stays put; the selection itself
// lives in js/assistant-actions.js where it is testable.
function assistantCapabilityChips(){ return capabilityChips(4); }""")

# 3. The screen said, in three places, that it could not act. It has been able
#    to since v9.8.
rep("// ---------- Ask (read-only -- see js/ask.js) ----------",
    "// ---------- Ask (see js/ask.js, js/router.js, js/assistant-actions.js) ----------")

rep("""    ${!a.turns.length ? `<div class="help" style="margin-top:0">
      Answers from what is already in this app — never the internet — and shows
      what each answer was based on. It cannot change anything on its own.
    </div>` : ''}""",
"""    ${!a.turns.length ? `<div class="help" style="margin-top:0">
      Ask about what is in this app — never the internet — or tell ${esc(aiName())} to
      add an event, start a chore or tick something off. He shows you what he is
      about to do and waits for you to say yes; nothing is saved before that.
    </div>` : ''}""")

rep("""        placeholder="${a.turns.length ? 'Ask a follow-up…' : 'Ask about events, chores or lists…'}\"""",
    """        placeholder="${a.turns.length ? 'Ask a follow-up…' : 'Ask, or tell me to add something…'}\"""")

rep("""    ${!a.turns.length && !a.busy ? `<div class="label">Try one of these</div>""",
    """    ${!a.turns.length && !a.busy ? `<div class="label">Ask, or tell me to do one of these</div>""")

# 4. The confirm buttons. Apple's App Intents confirmation takes an
#    `actionName` -- "the name to use in the button that confirms the action".
#    Every CONFIRM intent shared one button reading "Yes, do it".
rep("""      ${t.confirm && pendingAction ? `<div class="card" style="border-left:5px solid var(--amber-accent)">
        <div class="meta" style="font-size:12px;margin-bottom:8px">Nothing has been saved yet.</div>
        <div class="actionrow" style="margin-bottom:0">
          <button class="btn" onclick="confirmPendingAction()">Yes, do it</button>
          <button class="btn alt" onclick="cancelPendingAction()">No</button>
        </div></div>` : ''}""",
"""      ${t.confirm && pendingAction ? `<div class="card" style="border-left:5px solid var(--${t.destructive ? 'red' : 'amber'}-accent)">
        <div class="meta" style="font-size:12px;margin-bottom:8px">${t.destructive
          ? 'Nothing has been deleted yet. You will be able to undo it.'
          : 'Nothing has been saved yet.'}</div>
        <div class="actionrow" style="margin-bottom:0">
          <button class="btn${t.destructive ? ' danger' : ''}" onclick="confirmPendingAction()">${esc(t.actionName || 'Do it')}</button>
          <button class="btn alt" onclick="cancelPendingAction()">Cancel</button>
        </div></div>` : ''}""")

# 5. Carry the new fields through the turn record, so a re-render keeps the
#    right button label instead of falling back to a generic one.
rep("""      askState.turns.push({ q, a: out.answer, domain: out.domain, day: todayISO(),
        cited: out.cited || [], sourceNote: out.sourceNote || '',
        confirm: !!out.confirm, choices: out.choices || null,
        intentTitle: (intentById(route.intent) || {}).title || '' });""",
"""      askState.turns.push({ q, a: out.answer, domain: out.domain, day: todayISO(),
        cited: out.cited || [], sourceNote: out.sourceNote || '',
        confirm: !!out.confirm, choices: out.choices || null,
        actionName: out.actionName || '', destructive: !!out.destructive,
        intentTitle: (intentById(route.intent) || {}).title || '' });""")

# 6. DRAFT: the person named in the sentence now survives into the draft, and
#    "due Friday" can produce a deadline rather than an event.
rep("""    if(route.intent === 'add_event'){
      pendingEvents = [{
        title: route.params.title,
        date: route.params.date || '',
        time: route.params.time || '',
        endTime: null, kind:'event', location:null, notes:null,
        selected: true, dup:false, personIds:[], kidId:null,
        aiSource: aiModelName(),
      }];
      pendingSource = 'assistant';
      setTimeout(() => sub('review'), 350);
      return { answer:'Drafted it — check the details before saving.', cited:[],
        domain:'events', sourceNote:'Nothing is saved until you tap through the review screen.' };
    }""",
"""    if(route.intent === 'add_event'){
      const draft = buildEventDraft(route.params, allPeople(), aiModelName());
      pendingEvents = [draft];
      pendingSource = 'assistant';
      setTimeout(() => sub('review'), 350);
      // Say what was NOT understood as well as what was. A name that matched
      // nobody must not silently vanish -- the user needs to know to tag it.
      const who = draft.personIds.length ? personById(draft.personIds[0]) : null;
      const notes = [];
      if(route.params.person && !who) notes.push(`I did not recognise "${route.params.person}" — tag it yourself on the review screen.`);
      if(!draft.date) notes.push('No date was given, so you will need to pick one.');
      return { answer:`Drafted a ${draft.kind === 'deadline' ? 'deadline' : 'event'}`
          + `${who ? ' for ' + who.name : ''} — check the details before saving.`
          + (notes.length ? '\\n\\n' + notes.join('\\n') : ''),
        cited:[], domain:'events',
        sourceNote:'Nothing is saved until you tap through the review screen.' };
    }""")

rep("""    // add_chore: open the chore form PRE-FILLED. Set the form state directly
    // rather than calling newChoreForm(), which takes no arguments and resets
    // it -- calling that here would silently throw the draft away. Field
    // shape copied from newChoreForm so the form renders identically.
    choreForm = { title: route.params.title, kidId: null,
      frequency: route.params.frequency || 'daily', days: [],
      stars: typeof route.params.stars === 'number' ? route.params.stars : 1 };
    setTimeout(() => nav('chores'), 350);
    return { answer:'Filled in a chore for you — check it and save.', cited:[],
      domain:'chores', sourceNote:'Nothing is saved until you tap Save.' };""",
"""    // add_chore: open the chore form PRE-FILLED. Set the form state directly
    // rather than calling newChoreForm(), which takes no arguments and resets
    // it -- calling that here would silently throw the draft away.
    choreForm = buildChoreDraft(route.params, justKids());
    setTimeout(() => nav('chores'), 350);
    const kid = choreForm.kidId ? personById(choreForm.kidId) : null;
    return { answer:`Filled in a chore${kid ? ' for ' + kid.name : ''} — check it and save.`
        + (route.params.person && !kid ? `\\n\\nI did not recognise "${route.params.person}", so it is set to anyone.` : ''),
      cited:[], domain:'chores', sourceNote:'Nothing is saved until you tap Save.' };""")

if fail:
    print('FAILED — nothing written:'); [print(' ',f) for f in fail]; sys.exit(1)
open(p,'w').write(src); print('actions wired (part 1)')
