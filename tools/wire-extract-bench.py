#!/usr/bin/env python3
"""v9.19 — run the EXTRACTION benchmark from inside the app.

v9.17 did this for routing. Reading a flyer is the app's primary job and had
never been measured at all -- there is no eval/last-run.json -- for the same
reason: the API key lives in the phone's browser storage, so the desktop
harness could never be pointed at the provider actually in use.

The two benchmarks share the runner shell (progress, cancel, export) and
differ only in what they call and how they score. benchState.kind says which.
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

# 1. Inline the extraction scorer and its corpus, beside the routing pair.
rep("\n// ---------- State & storage ----------",
    "\n" + inline('js/extract-score.js') + "\n\n" + inline('js/extract-cases.js')
    + "\n\n// ---------- State & storage ----------")

# 2. The runner. Shares benchState with the routing one; `kind` says which.
rep("""async function runRoutingBench(){
  if(benchState && benchState.running) return;""",
"""// Reading a flyer is what this app is FOR, and until v9.19 it had never been
// measured -- the harness existed from v9.6 and could never be run, because
// the key is here rather than on the desktop.
//
// Same safety property as the routing benchmark: this extracts and scores. It
// never touches pendingEvents, never opens the review screen, never saves. A
// benchmark that could write would be a benchmark nobody dares run.
async function runExtractionBench(){
  if(benchState && benchState.running) return;
  benchState = { kind:'extraction', running:true, done:false, i:0,
                 total:EXTRACT_BENCH.cases.length, results:[], cancelled:false,
                 provider:aiProvider(), model:aiModelName(),
                 startedAt:Date.now(), ms:0, error:'' };
  sub('bench');
  try{
    for(const c of EXTRACT_BENCH.cases){
      if(benchState.cancelled) break;
      benchState.i++;
      render();
      await new Promise(r => setTimeout(r, 0));
      let events = [];
      let transportError = null;
      try{
        // The SHIPPING prompt, and the app's own parser, so this measures the
        // pipeline rather than a clean-room reimplementation of it.
        const text = await callAI(
          [{ type:'text', text:`Today is ${c.today}.\\n\\n${c.source}` },
           { type:'text', text: eventPrompt() }],
          3000, GROUNDING_EVENTS, 'bench.extract');
        events = parseExtractedEvents(text) || [];
      }catch(err){
        transportError = (err && err.message) || String(err);
      }
      const r = scoreExtraction(c.expected, events);
      benchState.results.push(Object.assign({ id:c.id, transportError }, r));
    }
  }catch(err){
    benchState.error = (err && err.message) || String(err);
  }
  benchState.running = false;
  benchState.done = true;
  benchState.ms = Date.now() - benchState.startedAt;
  render();
}

async function runRoutingBench(){
  if(benchState && benchState.running) return;""")

rep("""  benchState = { running:true, done:false, i:0, total:BENCH.cases.length, results:[],
                 cancelled:false, provider:aiProvider(), model:aiModelName(),
                 startedAt:Date.now(), ms:0, error:'' };""",
"""  benchState = { kind:'routing', running:true, done:false, i:0, total:BENCH.cases.length,
                 results:[], cancelled:false, provider:aiProvider(), model:aiModelName(),
                 startedAt:Date.now(), ms:0, error:'' };""")

rep("""function benchSummary(){
  return benchState ? summarise(benchState.results) : null;
}""",
"""function benchSummary(){
  if(!benchState) return null;
  return benchState.kind === 'extraction'
    ? aggregateExtraction(benchState.results)
    : summarise(benchState.results);
}""")

# 3. Export. Sources are corpus text, not the family's paperwork.
rep("""function exportBenchmark(){
  if(!benchState || !benchState.results.length){ toast('Nothing to export yet'); return; }
  try{
    const s = benchSummary();
    const payload = {
      kind: 'flyersnap-router-benchmark',""",
"""function exportBenchmark(){
  if(!benchState || !benchState.results.length){ toast('Nothing to export yet'); return; }
  if(benchState.kind === 'extraction') return exportExtractionBenchmark();
  try{
    const s = benchSummary();
    const payload = {
      kind: 'flyersnap-router-benchmark',""")

rep("function renderBench(m){",
"""// Its own file kind and its own shape -- the two benchmarks measure different
// things and a reader must not have to guess which one it is holding.
function exportExtractionBenchmark(){
  try{
    const s = benchSummary();
    const payload = {
      kind: 'flyersnap-extraction-benchmark',
      version: 1,
      generatedAt: new Date().toISOString(),
      app: { version: APP_VERSION, provider: benchState.provider, model: benchState.model,
             elapsedMs: benchState.ms },
      summary: s,
      cases: benchState.results.map(r => ({
        id: r.id, precision: r.precision, recall: r.recall,
        matched: r.matched, missed: r.missed, invented: r.invented,
        fields: r.fields,
        transportError: r.transportError ? redact(r.transportError) : undefined,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'flyersnap-extraction-benchmark-' + todayISO() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    toast(`Exported ${payload.cases.length} results`);
  }catch(e){
    alert('Could not build the benchmark file: ' + (e && e.message));
  }
}

function renderExtractionBench(m, b){
  const s = benchSummary();
  const pct = (v) => v === null || v === undefined ? '—' : (v * 100).toFixed(0) + '%';
  const failures = b.results.filter(r => r.invented.length || r.missed.length
    || r.precision < 1 || r.recall < 1 || r.transportError);
  // Invented first and alone. A missed flyer gets noticed; an invented event
  // quietly gets trusted, which is the failure this whole app exists to stop.
  const invented = b.results.reduce((n, r) => n + r.invented.length, 0);
  m.innerHTML = `
    <div class="card" style="border-left:5px solid var(--${invented ? 'red' : 'accent'}-accent)">
      <div style="font-weight:800;font-size:17px">${invented
        ? invented + ' invented event' + (invented === 1 ? '' : 's')
        : 'Nothing invented'}</div>
      <div class="meta">An event that was never in the paperwork is the worst
        thing this can do — a missed one gets noticed, an invented one gets trusted.</div>
    </div>

    <div class="card">
      <div class="meta">${s.cases} cases \\u00b7 ${s.expected} events expected \\u00b7
        ${s.returned} returned \\u00b7 ${(b.ms / 1000).toFixed(0)}s</div>
      <div class="meta" style="font-size:12px">${esc(b.model)} \\u00b7 ${esc(b.provider)}</div>
      ${b.cancelled ? `<div class="help" style="margin:8px 0 0">Stopped early — a partial run.</div>` : ''}
      ${b.error ? `<div class="help" style="margin:8px 0 0">${esc(b.error)}</div>` : ''}
    </div>

    <div class="sect">Did it find the right events?</div>
    ${[['Precision — of what it returned, how much was real', s.precision],
       ['Recall — of what was there, how much it found', s.recall],
       ['F1 — the two together', s.f1]].map(([label, v]) => `
      <div class="card row" style="padding:12px">
        <div class="grow" style="font-size:14px">${label}</div>
        <span style="font-weight:800">${pct(v)}</span>
      </div>`).join('')}
    <div class="card row" style="padding:12px">
      <div class="grow" style="font-size:14px">Missed entirely</div>
      <span style="font-weight:800;color:var(--${s.missedTotal ? 'amber' : 'accent'}-accent)">${s.missedTotal}</span>
    </div>

    <div class="sect">Field by field</div>
    <div class="help">Within events it matched correctly. A wrong time inside a
      right event is a different failure from missing the event.</div>
    ${FIELDS.map(f => `<div class="card row" style="padding:12px">
      <div class="grow" style="font-size:14px">${f}</div>
      <span class="meta" style="font-size:12px">${s.fields[f].right}/${s.fields[f].seen}</span>
      <span style="font-weight:700;margin-left:10px">${pct(s.fields[f].rate)}</span>
    </div>`).join('')}

    ${failures.length ? `<div class="sect">Where it slipped</div>` + failures.map(r => `
      <div class="card">
        <div style="font-weight:700;font-size:15px">${esc(r.id)}</div>
        ${r.transportError ? `<div class="help" style="margin:6px 0 0">Call failed: ${esc(r.transportError)}</div>` : ''}
        ${r.invented.map(e => `<div class="help" style="margin:6px 0 0;color:var(--red-accent)">
          invented: ${esc(e.date || 'no date')} ${esc(e.title || '')}</div>`).join('')}
        ${r.missed.map(e => `<div class="help" style="margin:6px 0 0">
          missed: ${esc(e.date || 'no date')} ${esc(e.title || '')}</div>`).join('')}
      </div>`).join('') : ''}

    <button class="btn" style="margin-top:12px" onclick="exportBenchmark()">${ico('download')}Export results for desktop</button>
    <div class="help">The source text comes from the repo, not from your paperwork.
      No events, notes or API key, so it is safe to email.</div>
    <button class="btn alt" onclick="runExtractionBench()">${ico('refresh')}Run it again</button>`;
}

function renderBench(m){""")

# 4. Route the results screen by kind.
rep("""  const s = benchSummary();
  const v = verdict(s);
  const pct = (n) => (n * 100).toFixed(0) + '%';""",
"""  if(b.kind === 'extraction') return renderExtractionBench(m, b);

  const s = benchSummary();
  const v = verdict(s);
  const pct = (n) => (n * 100).toFixed(0) + '%';""")

rep("""      <div style="font-weight:700">${b.i} of ${b.total}</div>""",
    """      <div style="font-weight:700">${b.i} of ${b.total}</div>
      <div class="meta">${b.kind === 'extraction' ? 'reading paperwork' : 'understanding sentences'}</div>""")

rep("""  setHeader('Routing benchmark', true);""",
    """  setHeader(benchState && benchState.kind === 'extraction' ? 'Reading benchmark' : 'Routing benchmark', true);""")

# 5. Offer it in Settings, beside the routing one.
rep("""    <div class="sect">Gmail watcher</div>""",
"""    <div class="sect">How well does it read paperwork?</div>
    <div class="help">Runs ${EXTRACT_BENCH.cases.length} sample flyers and emails through the model
      selected above and scores what it pulled out — including whether it ever
      invented an event that was not there. ${EXTRACT_BENCH.cases.length} calls, about a minute.
      Nothing is added, changed or deleted by any of it.</div>
    <button class="btn alt" onclick="runExtractionBench()">${ico('flask')}Run the reading benchmark</button>

    <div class="sect">Gmail watcher</div>""")

if fail:
    print('FAILED — nothing written:'); [print(' ',f) for f in fail]; sys.exit(1)
open(p,'w').write(src); print('extraction benchmark wired into the app')
