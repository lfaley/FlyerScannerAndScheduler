#!/usr/bin/env python3
"""Name the operation on every AI call, and log the local provider too.

wire-ailog.py instrumented the Anthropic transport and left `aiOp` stuck at
'unknown'. A log that cannot say WHAT was being attempted answers no useful
question, so the operation name becomes an explicit parameter of callAI --
one place, set once, read by both transports.
"""
import sys
p='index.html'; src=open(p).read(); fail=[]
def rep(o,n,c=1):
    global src
    got=src.count(o)
    if got!=c: fail.append(f'expected {c}x {o[:80]!r}, found {got}'); return
    src=src.replace(o,n)

# 1. Replace the unused withAiOp helper, and instrument the local transport.
#    Timing and success live HERE rather than inside callLocalModel, so both
#    providers are measured at the same boundary and mean the same thing.
rep("""// Which task the current call belongs to. A module-level value rather than a
// threaded parameter because callClaude/callLocalModel are reached from a
// dozen call sites; threading it would touch all of them for no gain.
let aiOp = 'unknown';
function withAiOp(op, fn){ aiOp = op; try{ return fn(); } finally { /* next call sets its own */ } }

async function callAI(contentBlocks, maxTokens, system){
  if(aiProvider() === 'local'){
    try{
      return await callLocalModel(contentBlocks, maxTokens, system);
    }catch(err){
      const unsupported = /^UNSUPPORTED_BLOCK:/.test(err.message);
      if(S.settings.aiFallback){
        recordAiCall({ op: aiOp, provider:'local', reqModel: S.settings.localModel || null,
          ok:false, errorType: unsupported ? 'unsupported_input' : classifyError(err),
          detail: err && err.message, fellBackTo:'anthropic' });
        toast(unsupported ? 'PDFs need Anthropic — using it for this one'
                          : 'Local model unavailable — using Anthropic');""",
"""// Which task the current call belongs to (gen_ai.operation.name). Set once at
// the top of callAI and read by both transports, so a log line says WHAT was
// being attempted -- "extract.photo failed" rather than "a call failed".
let aiOp = 'unknown';

async function callAI(contentBlocks, maxTokens, system, op){
  aiOp = op || 'unknown';
  if(aiProvider() === 'local'){
    // Timed at this boundary rather than inside callLocalModel so that a
    // local millisecond and an Anthropic millisecond mean the same thing.
    const started = Date.now();
    try{
      const out = await callLocalModel(contentBlocks, maxTokens, system);
      recordAiCall({ op: aiOp, provider:'local', reqModel: S.settings.localModel || null,
        ok:true, ms: Date.now() - started });
      return out;
    }catch(err){
      const unsupported = /^UNSUPPORTED_BLOCK:/.test(err.message);
      const localFail = { op: aiOp, provider:'local',
        reqModel: S.settings.localModel || null, ok:false, ms: Date.now() - started,
        errorType: unsupported ? 'unsupported_input' : classifyError(err),
        detail: err && err.message };
      if(S.settings.aiFallback){
        recordAiCall(Object.assign({}, localFail, { fellBackTo:'anthropic' }));
        toast(unsupported ? 'PDFs need Anthropic — using it for this one'
                          : 'Local model unavailable — using Anthropic');""")

# 2. The two non-fallback local failures must be recorded as well, or turning
#    fallback off would silently turn logging off with it.
rep("""      if(unsupported){
        logProblem('Local model', 'Cannot read PDFs or fetched links', aiModelName());""",
"""      recordAiCall(localFail);
      if(unsupported){
        logProblem('Local model', 'Cannot read PDFs or fetched links', aiModelName());""")

# 3. Name every call site. These strings are the vocabulary of the log, so they
#    are dotted and stable: area.thing.
rep("""  const text = await callAI([block,
    {type:'text', text: CLASSIFY_PROMPT.replace('{TODAY}', todayISO())}], 3000);""",
"""  const text = await callAI([block,
    {type:'text', text: CLASSIFY_PROMPT.replace('{TODAY}', todayISO())}], 3000,
    undefined, isPdf ? 'classify.pdf' : 'classify.image');""")

rep("""  const text = await callAI(withContext([block]), 3000, GROUNDING_EVENTS);
  return parseExtractedEvents(text);
}

async function extractEventsFromUrl(url){""",
"""  const text = await callAI(withContext([block]), 3000, GROUNDING_EVENTS,
    isPdf ? 'extract.pdf' : 'extract.image');
  return parseExtractedEvents(text);
}

async function extractEventsFromUrl(url){""")

rep("""  const block = {type:'document', source:{type:'url', url}};
  const text = await callAI(withContext([block]), 3000, GROUNDING_EVENTS);""",
"""  const block = {type:'document', source:{type:'url', url}};
  const text = await callAI(withContext([block]), 3000, GROUNDING_EVENTS, 'extract.url');""")

rep("""  const text = await callAI(blocks, 2000, GROUNDING_RECIPE);""",
    """  const text = await callAI(blocks, 2000, GROUNDING_RECIPE, 'extract.recipe');""")

rep("""      const routeText = await callAI(
        [{ type:'text', text:`Today is ${todayISO()}.\\n\\nSentence: ${q}` }],
        300, buildRouterPrompt());""",
"""      const routeText = await callAI(
        [{ type:'text', text:`Today is ${todayISO()}.\\n\\nSentence: ${q}` }],
        300, buildRouterPrompt(), 'ask.route');""")

rep("""    const text = await callAI([{ type:'text', text: built.user }], 700, built.system);""",
    """    const text = await callAI([{ type:'text', text: built.user }], 700, built.system, 'ask.answer');""")

rep("""      const text = await callAI(blocks, 8000, GROUNDING_EVENTS);
      const events = parseExtractedEvents(text) || [];""",
"""      const text = await callAI(blocks, 8000, GROUNDING_EVENTS, 'email.combined');
      const events = parseExtractedEvents(text) || [];""")

rep("""        {type:'text', text:eventPrompt()}], 8000, GROUNDING_EVENTS);""",
    """        {type:'text', text:eventPrompt()}], 8000, GROUNDING_EVENTS, 'email.body');""")

rep("""      const text = await callAI(blocks, 8000, GROUNDING_EVENTS);
      (parseExtractedEvents(text)||[]).forEach(e => found.push(e));""",
"""      const text = await callAI(blocks, 8000, GROUNDING_EVENTS, 'email.attachment');
      (parseExtractedEvents(text)||[]).forEach(e => found.push(e));""")

rep("""      compareResult.anthropic = parseExtractedEvents(
        await callAI(blocks(), 8000, GROUNDING_EVENTS)) || [];""",
"""      compareResult.anthropic = parseExtractedEvents(
        await callAI(blocks(), 8000, GROUNDING_EVENTS, 'compare.anthropic')) || [];""")

rep("""      compareResult.local = parseExtractedEvents(
        await callAI(blocks(), 8000, GROUNDING_EVENTS)) || [];""",
"""      compareResult.local = parseExtractedEvents(
        await callAI(blocks(), 8000, GROUNDING_EVENTS, 'compare.local')) || [];""")

if fail:
    print('FAILED — nothing written:'); [print(' ',f) for f in fail]; sys.exit(1)
open(p,'w').write(src); print('operation names + local provider logging wired')
