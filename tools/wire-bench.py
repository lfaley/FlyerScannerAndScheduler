#!/usr/bin/env python3
"""v9.17 — run the routing benchmark from inside the app.

The API key lives in the phone's browser storage, so a desktop Node script
cannot reach the provider actually in use. Logan asked for this directly:
"can we use the application to run these and feed the data back to you."
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

# 1. Inline the scorer and the corpus, right after the router they measure.
rep("""  return validateRoute({ intent, params, confidence: 0.95 });
}
""",
"""  return validateRoute({ intent, params, confidence: 0.95 });
}

""" + inline('js/route-score.js') + "\n\n" + inline('js/bench-cases.js') + "\n")

# 2. State and the runner.
rep("function aiName(){ return ASSISTANT_NAME; }",
"""function aiName(){ return ASSISTANT_NAME; }

// ---------- Routing benchmark (see js/route-score.js, js/bench-cases.js) ----
//
// Measures how well the CURRENT provider turns a sentence into an intent. It
// runs here rather than on the desktop for one reason: the API key lives in
// this browser's storage, so a Node script cannot reach the provider actually
// in use. tools/eval-router.js runs the same corpus through the same scorer
// when a key is available on the desktop; the two cannot disagree, because
// they share both files.
//
// SAFETY. This routes and scores. It NEVER calls performRoute, so no case can
// draft, propose or write anything -- a corpus containing "delete the dentist
// appointment" must not be able to touch a real event. There is a test.
let benchState = null;   // { running, done, i, total, results, cancelled, provider, model, ms }

function benchMeta(){
  return { consequenceOf: (id) => (intentById(id) || {}).consequence || null,
           isDestructive: (id) => !!(intentById(id) || {}).destructive };
}

async function runRoutingBench(){
  if(benchState && benchState.running) return;
  benchState = { running:true, done:false, i:0, total:BENCH.cases.length, results:[],
                 cancelled:false, provider:aiProvider(), model:aiModelName(),
                 startedAt:Date.now(), ms:0, error:'' };
  sub('bench');
  const system = buildRouterPrompt();
  try{
    for(const c of BENCH.cases){
      if(benchState.cancelled) break;
      benchState.i++;
      render();
      // Yield so the progress actually paints between calls.
      await new Promise(r => setTimeout(r, 0));
      let route;
      try{
        // Exactly the path a typed sentence takes, quickRoute included.
        // Measuring the model alone would measure something no user meets.
        route = quickRoute(c.sentence, { names: BENCH.names })
          || routeFromText(cleanModelText(await callAI(
              [{ type:'text', text:`Today is ${BENCH.today}.\\n\\nSentence: ${c.sentence}` }],
              300, system, 'bench.route')));
      }catch(err){
        // A transport failure is not a routing failure, but it must not be
        // silently scored as one either -- it is recorded and shown.
        route = { ok:false, intent:'unknown', params:{} };
        benchState.results.push(Object.assign({ bucket:c.bucket, transportError: err && err.message },
          scoreCase(c, route, benchMeta())));
        continue;
      }
      benchState.results.push(Object.assign({ bucket:c.bucket }, scoreCase(c, route, benchMeta())));
    }
  }catch(err){
    benchState.error = (err && err.message) || String(err);
  }
  benchState.running = false;
  benchState.done = true;
  benchState.ms = Date.now() - benchState.startedAt;
  render();
}

function cancelRoutingBench(){
  if(benchState) benchState.cancelled = true;
  toast('Stopping after this one');
}

function benchSummary(){
  return benchState ? summarise(benchState.results) : null;
}

// The file that goes back to the desktop. Sentences and labels only -- they
// came from the repo, not from Logan's data -- plus what each one routed to.
// Deliberately carries no events, no notes, no API key, exactly like the
// diagnostics export.
function exportBenchmark(){
  if(!benchState || !benchState.results.length){ toast('Nothing to export yet'); return; }
  try{
    const s = benchSummary();
    const payload = {
      kind: 'flyersnap-router-benchmark',
      version: 1,
      generatedAt: new Date().toISOString(),
      app: { version: APP_VERSION, provider: benchState.provider, model: benchState.model,
             elapsedMs: benchState.ms },
      corpusToday: BENCH.today,
      summary: s,
      verdict: verdict(s),
      cases: benchState.results.map(r => ({
        id:r.id, bucket:r.bucket, sentence:r.sentence, expected:r.expected, got:r.got,
        pass:r.pass, intentOk:r.intentOk,
        destructiveEscalation:r.destructiveEscalation, writeEscalation:r.writeEscalation,
        missedRefusal:r.missedRefusal, overRefusal:r.overRefusal,
        missing:r.missing, wrongValue:r.wrongValue, invented:r.invented,
        transportError: r.transportError ? redact(r.transportError) : undefined,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'flyersnap-router-benchmark-' + todayISO() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    toast(`Exported ${payload.cases.length} results`);
  }catch(e){
    alert('Could not build the benchmark file: ' + (e && e.message));
  }
}""")

# 3. The screen.
rep("function renderCompare(m){",
"""function renderBench(m){
  setHeader('Routing benchmark', true);
  const b = benchState;
  if(!b){ m.innerHTML = `<div class="empty"><div class="eb">Nothing has been run yet.</div></div>`; return; }

  if(b.running){
    m.innerHTML = `<div class="spin" style="padding:24px"><div class="spinner"></div>
      <div style="font-weight:700">${b.i} of ${b.total}</div>
      <div class="meta">${esc(b.model)} \\u00b7 ${esc(b.provider)}</div>
      <div class="help">Each sentence is classified the same way a typed one is.
        Nothing is added, changed or deleted by any of this.</div></div>
      <button class="btn alt" onclick="cancelRoutingBench()">Stop</button>`;
    return;
  }

  const s = benchSummary();
  const v = verdict(s);
  const pct = (n) => (n * 100).toFixed(0) + '%';
  const safety = [
    ['Proposed a delete nobody asked for', s.destructiveEscalations],
    ['A question routed to something that writes', s.writeEscalations],
    ['Should have refused, but acted', s.missedRefusals],
    ['Invented a value the sentence never gave', s.inventedParams],
  ];
  const failures = b.results.filter(r => !r.pass);

  m.innerHTML = `
    <div class="card" style="border-left:5px solid var(--${v.ok ? 'accent' : 'red-accent'})">
      <div style="font-weight:800;font-size:17px">${v.ok ? 'Passed' : 'Did not pass'}</div>
      <div class="meta">${s.passed} of ${s.cases} cases \\u00b7 ${pct(s.intentAccuracy)} of intents right
        \\u00b7 ${(b.ms / 1000).toFixed(0)}s</div>
      <div class="meta" style="font-size:12px">${esc(b.model)} \\u00b7 ${esc(b.provider)}</div>
      ${b.cancelled ? `<div class="help" style="margin:8px 0 0">Stopped early — this is a partial run.</div>` : ''}
      ${b.error ? `<div class="help" style="margin:8px 0 0">${esc(b.error)}</div>` : ''}
    </div>

    <div class="sect">Safety</div>
    <div class="help">These are counted on their own and never averaged into the
      score. There is no acceptable rate for any of them.</div>
    ${safety.map(([label, n]) => `<div class="card row" style="padding:12px">
      <div class="grow" style="font-size:14px">${label}</div>
      <span style="font-weight:800;color:var(--${n ? 'red-accent' : 'accent'})">${n}</span>
    </div>`).join('')}

    <div class="sect">By kind of sentence</div>
    ${Object.entries(s.byBucket).map(([k, x]) => `<div class="card row" style="padding:12px">
      <div class="grow" style="font-size:14px">${esc(k)}</div>
      <span style="font-weight:700;color:var(--${x.pass === x.n ? 'accent' : 'amber-accent'})">${x.pass}/${x.n}</span>
    </div>`).join('')}

    ${failures.length ? `<div class="sect">What it got wrong</div>` + failures.map(r => `
      <div class="card">
        <div style="font-weight:700;font-size:15px">${esc(r.sentence)}</div>
        <div class="meta" style="font-size:12px">expected <b>${esc(r.expected)}</b>, got <b>${esc(r.got)}</b></div>
        ${r.transportError ? `<div class="help" style="margin:6px 0 0">Call failed: ${esc(r.transportError)}</div>` : ''}
        ${r.wrongValue.length ? `<div class="help" style="margin:6px 0 0">${r.wrongValue.map(esc).join('<br>')}</div>` : ''}
        ${r.missing.length ? `<div class="help" style="margin:6px 0 0">missing: ${esc(r.missing.join(', '))}</div>` : ''}
        ${r.invented.length ? `<div class="help" style="margin:6px 0 0">invented: ${esc(r.invented.join(', '))}</div>` : ''}
      </div>`).join('') : ''}

    <button class="btn" style="margin-top:12px" onclick="exportBenchmark()">${ico('download')}Export results for desktop</button>
    <div class="help">Sentences and labels only — they come from the repo, not from
      your family's data. No events, notes or API key, so it is safe to email.</div>
    <button class="btn alt" onclick="runRoutingBench()">${ico('refresh')}Run it again</button>`;
}

function renderCompare(m){""")

rep("    problems:renderProblems,     selfTest:renderSelfTest, compare:renderCompare,",
    "    problems:renderProblems,     selfTest:renderSelfTest, compare:renderCompare, bench:renderBench,")

# 4. Reachable from Settings, for BOTH providers -- this measures routing, not
#    local-model health, so hiding it behind the local branch would be wrong.
rep("""    <div class="sect">Gmail watcher</div>""",
"""    <div class="sect">How well does ${aiName()} understand you?</div>
    <div class="help">Runs ${BENCH.cases.length} example sentences through whatever model is
      selected above and scores what each one was understood to mean — including
      whether a plain question was ever taken as an instruction to change
      something. It makes ${BENCH.cases.length} short calls and takes a minute or two.
      It only classifies: nothing is added, changed or deleted by any of it.</div>
    <button class="btn alt" onclick="runRoutingBench()">${ico('flask')}Run the routing benchmark</button>
    ${benchState && benchState.done ? `<div class="help" style="margin-top:8px">
      Last run: ${benchSummary().passed}/${benchSummary().cases} passed.
      <button class="linkbtn" onclick="sub('bench')">See the results</button></div>` : ''}

    <div class="sect">Gmail watcher</div>""")

if fail:
    print('FAILED — nothing written:'); [print(' ',f) for f in fail]; sys.exit(1)
open(p,'w').write(src); print('routing benchmark wired into the app')
