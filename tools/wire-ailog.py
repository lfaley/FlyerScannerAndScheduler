#!/usr/bin/env python3
"""Instrument the AI calls and add a desktop-readable diagnostics export."""
import sys
p='index.html'; src=open(p).read(); fail=[]
def rep(o,n,c=1):
    global src
    got=src.count(o)
    if got!=c: fail.append(f'expected {c}x {o[:75]!r}, found {got}'); return
    src=src.replace(o,n)

# 1. Inline js/ailog.js.
body = open('js/ailog.js').read().replace('export const','const').replace('export function','function').strip()
rep("// ---------- State & storage ----------", body + "\n\n// ---------- State & storage ----------")

# 2. Somewhere to keep it.
rep("  redemptions:[], lists:[], listItems:[], ask:{ turns:[] },",
    "  redemptions:[], lists:[], listItems:[], ask:{ turns:[] }, aiLog:[],")

# 3. The recorder.
rep("function aiName(){ return ASSISTANT_NAME; }",
"""function aiName(){ return ASSISTANT_NAME; }

// ---------- AI call logging (see js/ailog.js) ----------
// Field names follow the OpenTelemetry GenAI conventions so the log means
// what an engineer would expect. Prompt and answer text are NEVER recorded:
// in this app the prompts are children's names, schools and schedules.
function recordAiCall(fields){
  try{
    S.aiLog = appendEntry(S.aiLog || [], makeEntry(
      Object.assign({ at: new Date().toISOString() }, fields)));
    save();
  }catch(e){ /* logging must never break the thing it is logging about */ }
}""")

# 4. Instrument the Anthropic transport.
rep("""async function callClaude(contentBlocks, maxTokens, system){
  if(!S.settings.apiKey) throw new Error('NO_API_KEY');
  const res = await fetch(API_URL, {""",
"""async function callClaude(contentBlocks, maxTokens, system){
  if(!S.settings.apiKey){
    recordAiCall({ op: aiOp, provider:'anthropic', reqModel: MODEL, ok:false,
      errorType:'no_api_key', detail:'No API key saved' });
    throw new Error('NO_API_KEY');
  }
  const started = Date.now();
  let res;
  try{
    res = await fetch(API_URL, {""")

rep("""      system ? { system: SECRETARY_PERSONA + '\\n\\n' + system } : {}))
  });
  if(!res.ok){
    const body = await res.text();
    throw new Error('API error '+res.status+': '+body.slice(0,200));
  }
  const data = await res.json();
  return (data.content||[]).map(b=>b.type==='text'?b.text:'').join('\\n')
    .replace(/```json|```/g,'').trim();
}""",
"""      system ? { system: SECRETARY_PERSONA + '\\n\\n' + system } : {}))
    });
  }catch(err){
    // A thrown fetch is the network layer: no status, no body.
    recordAiCall({ op: aiOp, provider:'anthropic', reqModel: MODEL, ok:false,
      ms: Date.now() - started, errorType: classifyError(err), detail: err && err.message });
    throw err;
  }
  if(!res.ok){
    const body = await res.text();
    recordAiCall({ op: aiOp, provider:'anthropic', reqModel: MODEL, ok:false,
      ms: Date.now() - started, status: res.status,
      errorType: classifyError(null, res.status), detail: body.slice(0, 300) });
    throw new Error('API error '+res.status+': '+body.slice(0,200));
  }
  const data = await res.json();
  const u = data.usage || {};
  recordAiCall({ op: aiOp, provider:'anthropic', reqModel: MODEL,
    resModel: data.model || null, ok:true, ms: Date.now() - started,
    inTokens: u.input_tokens, outTokens: u.output_tokens,
    finish: data.stop_reason || null });
  return (data.content||[]).map(b=>b.type==='text'?b.text:'').join('\\n')
    .replace(/```json|```/g,'').trim();
}""")

# 5. Name the operation, so the log says WHAT was being done rather than just
#    "a call happened". Set by callAI around each dispatch.
rep("async function callAI(contentBlocks, maxTokens, system){",
"""// Which task the current call belongs to. A module-level value rather than a
// threaded parameter because callClaude/callLocalModel are reached from a
// dozen call sites; threading it would touch all of them for no gain.
let aiOp = 'unknown';
function withAiOp(op, fn){ aiOp = op; try{ return fn(); } finally { /* next call sets its own */ } }

async function callAI(contentBlocks, maxTokens, system){""")

# 6. Record the fallback itself -- "local failed, Anthropic answered" is the
#    single most useful line in this log for Logan's setup.
rep("""      if(S.settings.aiFallback){
        toast(unsupported ? 'PDFs need Anthropic — using it for this one'
                          : 'Local model unavailable — using Anthropic');""",
"""      if(S.settings.aiFallback){
        recordAiCall({ op: aiOp, provider:'local', reqModel: S.settings.localModel || null,
          ok:false, errorType: unsupported ? 'unsupported_input' : classifyError(err),
          detail: err && err.message, fellBackTo:'anthropic' });
        toast(unsupported ? 'PDFs need Anthropic — using it for this one'
                          : 'Local model unavailable — using Anthropic');""")

# 7. The export. This is the file Logan opens on his desktop.
rep("function exportBackup(){",
"""// Diagnostics leave the phone as their own file. Deliberately NOT the full
// backup: no events, chores, lists, notes or API key, so it is safe to email
// or AirDrop to a desktop.
function exportDiagnostics(){
  try{
    const diag = buildDiagnostics(S, {
      now: new Date().toISOString(),
      appVersion: (document.body.innerHTML.match(/FlyerSnap v[0-9.]+/) || [])[0] || null,
      provider: aiProvider(), model: aiModelName(),
      includeLocalUrl: true,
      userAgent: navigator.userAgent,
    });
    const blob = new Blob([JSON.stringify(diag, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'flyersnap-diagnostics-' + todayISO() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    toast(`Diagnostics downloaded (${diag.aiLog.length} AI calls, ${diag.problems.length} problems)`);
  }catch(e){
    alert('Could not build the diagnostics file: ' + (e && e.message));
  }
}

function exportBackup(){""")

# 8. Surface it in Settings, next to the problem log.
OLD8 = """      `<button class="btn alt" onclick="openProblems()">Problem log</button>`}
"""
NEW8 = """      `<button class="btn alt" onclick="openProblems()">Problem log</button>`}

    <button class="btn alt" onclick="exportDiagnostics()">${ico('download')}Export diagnostics for desktop</button>
    <div class="help">A small file with the AI call log and anything reported as a
      problem — no events, notes or API key in it, so it is safe to email to
      yourself. Read it on the desktop with: node tools/diagnostics.js &lt;file&gt;</div>
"""
rep(OLD8, NEW8)

if fail:
    print('FAILED — nothing written:'); [print(' ',f) for f in fail]; sys.exit(1)
open(p,'w').write(src); print('AI logging + diagnostics export wired')
