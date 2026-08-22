/**
 * tools/eval-router.js — measure ROUTING accuracy.
 *
 *   node tools/eval-router.js --read <exported.json>   (a run done on the phone)
 *   node tools/eval-router.js --local <baseUrl> <model>
 *   node tools/eval-router.js --offline   (no network, no cost — see below)
 *   node tools/eval-router.js --dry       (scorer self-check, no network)
 *   ANTHROPIC_API_KEY=sk-ant-... node tools/eval-router.js
 *
 * Whichever provider is chosen, it is measured against the SAME prompt the app
 * ships. The local model and Anthropic are both first-class here on purpose:
 * the point of the benchmark is partly to tell you which one routes better on
 * your own phrasing.
 *
 * Companion to tools/eval-extraction.js, which measures whether the app reads
 * a flyer correctly. This measures whether it understands a SENTENCE
 * correctly — a question that mattered much more after v9.14, when ten of the
 * sixteen intents became capable of changing data.
 *
 * THREE TIERS, on purpose:
 *
 *   --offline   Runs every case through quickRoute() and validateRoute() only.
 *               Costs nothing, needs nothing, and still proves the properties
 *               that must hold whatever the model says: no sentence is
 *               short-circuited into a write, and every case's expected intent
 *               is one the registry can actually validate. This tier runs as
 *               part of `node tests.js`.
 *   --dry       Scores every case against its own label. Anything less than
 *               perfect means the SCORER is broken, not the model.
 *   (default)   The real thing: one model call per case, against the prompt
 *               that actually ships.
 *
 * The router prompt is read from js/router.js rather than copied, so this can
 * never measure a prompt the app does not send.
 *
 * It costs real tokens (33 short calls — pennies, but not free), so it is NOT
 * part of `node tests.js`. Run it deliberately before and after a change to
 * the prompt or the intent registry, and commit eval/router-last-run.json so
 * the numbers have a history.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

async function main(){
  const { scoreCase, summarise, verdict } = await import(path.join(root, 'js/route-score.js'));
  const { buildRouterPrompt, validateRoute, routeFromText, quickRoute } =
    await import(path.join(root, 'js/router.js'));
  const { intentById, INTENTS } = await import(path.join(root, 'js/intents.js'));

  const corpus = JSON.parse(fs.readFileSync(path.join(root, 'eval/router-cases.json'), 'utf8'));
  const cases = corpus.cases;
  const args = process.argv.slice(2);

  const meta = {
    consequenceOf: (id) => (intentById(id) || {}).consequence || null,
    isDestructive: (id) => !!(intentById(id) || {}).destructive,
  };

  // ---- tier 0: read a run exported from the phone -------------------------
  // The API key lives in the phone's browser storage, so the run that matters
  // most happens in the app (Settings -> "How well does Gordon understand
  // you?"). This reads the file it exports.
  const readIdx = args.indexOf('--read');
  if(readIdx >= 0){
    const file = args[readIdx + 1];
    if(!file){ console.error('usage: node tools/eval-router.js --read <exported.json>'); process.exit(2); }
    let d;
    try{ d = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch(e){ console.error('Could not read ' + file + ': ' + e.message); process.exit(2); }
    if(d.kind !== 'flyersnap-router-benchmark'){
      console.error('That is not a benchmark export (kind: ' + (d.kind || 'unknown') + ').');
      console.error('Export it from Settings -> "How well does Gordon understand you?"');
      process.exit(2);
    }
    report(d.summary, d.verdict, { kind: (d.app || {}).provider, model: (d.app || {}).model },
      d.cases.filter(c => !c.pass), d.app);
    return;
  }

  // ---- tier 1: the scorer checks itself ----------------------------------
  if(args.includes('--dry')){
    const results = cases.map(c => {
      const perfect = c.intent === 'unknown'
        ? { ok:false, intent:'unknown', params:{} }
        : { ok:true, intent:c.intent, consequence:meta.consequenceOf(c.intent),
            params:c.params || {}, confidence:0.95 };
      return Object.assign({ bucket: c.bucket }, scoreCase(c, perfect, meta));
    });
    const s = summarise(results);
    console.log('scorer self-check (each case against its own label):');
    console.log(`  ${s.passed}/${s.cases} pass, intent accuracy ${(s.intentAccuracy * 100).toFixed(0)}%`);
    const failed = results.filter(r => !r.pass);
    if(failed.length){
      console.error('  BROKEN: a perfect answer did not score perfectly.');
      failed.forEach(f => console.error('   ', f.id, JSON.stringify({
        intentOk:f.intentOk, missing:f.missing, wrongValue:f.wrongValue, invented:f.invented })));
      process.exitCode = 1;
    } else {
      console.log('  ok — a perfect answer scores perfectly on every case.');
    }
    return;
  }

  // ---- tier 2: the free, deterministic properties -------------------------
  if(args.includes('--offline')){
    const problems = offlineChecks(cases, { quickRoute, validateRoute, intentById, INTENTS, meta,
      names: [...(corpus.people || []), ...(corpus.lists || []), ...(corpus.chores || [])] });
    problems.forEach(p => console.error('  ' + p));
    console.log(problems.length
      ? `\n${problems.length} problem(s) — no model was involved in any of them`
      : `\noffline checks pass across ${cases.length} cases: nothing short-circuits into a write, `
        + `every expected intent validates, every bucket is populated`);
    if(problems.length) process.exitCode = 1;
    return;
  }

  // ---- tier 3: the real run ----------------------------------------------
  const local = args.indexOf('--local');
  const provider = local >= 0
    ? { kind:'local', base:args[local + 1], model:args[local + 2] }
    : { kind:'anthropic', key:process.env.ANTHROPIC_API_KEY, model:process.env.MODEL || 'claude-sonnet-4-6' };

  if(provider.kind === 'anthropic' && !provider.key){
    // Logan runs his own model. Naming Anthropic first here sent him looking
    // for an API key he does not use, so the local path leads.
    console.error('Pick a provider:');
    console.error('  node tools/eval-router.js --local <baseUrl> <model>');
    console.error('      e.g. --local http://your-desktop:11434/v1 qwen2.5:14b-instruct');
    console.error('      the base URL is the one in Settings -> Gordon -> local model');
    console.error('  ANTHROPIC_API_KEY=sk-ant-... node tools/eval-router.js');
    console.error('');
    console.error('Or run the tiers that need no model at all:');
    console.error('  node tools/eval-router.js --offline   (safety properties)');
    console.error('  node tools/eval-router.js --dry       (scorer self-check)');
    process.exit(1);
  }

  const system = buildRouterPrompt();
  // The same names the app passes in, so the benchmark exercises the path the
  // user actually gets rather than a stripped-down one.
  const NAMES = [...(corpus.people || []), ...(corpus.lists || []), ...(corpus.chores || [])];
  const results = [];
  for(const c of cases){
    process.stdout.write(`  ${c.id.padEnd(26)} `);
    let route;
    try{
      // Exactly what the app sends: quickRoute first, the model only if it
      // cannot tell. Measuring the model alone would measure something the
      // user never experiences.
      route = quickRoute(c.sentence, { names: NAMES })
        || routeFromText(await ask(provider, system, c.sentence, corpus.today));
    }catch(err){
      console.log('ERROR: ' + err.message);
      results.push(Object.assign({ bucket:c.bucket },
        scoreCase(c, { ok:false, intent:'unknown', params:{} }, meta)));
      continue;
    }
    const r = Object.assign({ bucket: c.bucket }, scoreCase(c, route, meta));
    results.push(r);
    const flag = r.destructiveEscalation ? ' *** DESTRUCTIVE ESCALATION'
               : r.writeEscalation ? ' ** WRITE ESCALATION'
               : r.missedRefusal ? ' * MISSED REFUSAL'
               : r.invented.length ? ' * INVENTED ' + r.invented.join(',')
               : '';
    console.log(`${r.pass ? 'pass' : 'FAIL'}  ${r.expected} -> ${r.got}${flag}`);
    r.wrongValue.forEach(w => console.log(`        ${w}`));
    r.missing.forEach(m => console.log(`        missing param: ${m}`));
  }

  const s = summarise(results);
  report(s, verdict(s), provider, results.filter(r => !r.pass));

  fs.writeFileSync(path.join(root, 'eval/router-last-run.json'),
    JSON.stringify({ provider: provider.kind, model: provider.model, summary: s,
      failures: results.filter(r => !r.pass).map(r => ({ id:r.id, expected:r.expected, got:r.got })) }, null, 2));
  console.log('\nwrote eval/router-last-run.json — commit it to keep a history of scores.');
}

/**
 * The properties that hold with no model at all. Exported so tests.js can run
 * them for free, on every commit, instead of only when someone remembers to
 * spend tokens.
 */
function offlineChecks(cases, dep){
  const { quickRoute, validateRoute, intentById, INTENTS, meta } = dep;
  // dep.names: the people/list/chore names the app would pass in.
  const problems = [];

  for(const c of cases){
    // 1. quickRoute must never short-circuit anything into a write. This is
    //    the property that lets it exist at all.
    const q = quickRoute(c.sentence, { names: dep.names || [] });
    if(q && q.ok){
      const cls = meta.consequenceOf(q.intent);
      if(cls !== 'answer'){
        problems.push(`${c.id}: quickRoute short-circuited to a non-answer intent (${q.intent})`);
      }
      if(c.intent !== 'unknown' && q.intent !== c.intent){
        problems.push(`${c.id}: quickRoute answered ${q.intent}, but the case says ${c.intent}`);
      }
      if(c.intent === 'unknown'){
        problems.push(`${c.id}: quickRoute answered ${q.intent} for a case that should refuse`);
      }
    }

    // 2. Every expected intent must be one the registry can actually
    //    validate with the parameters the case gives it. A case expecting
    //    something impossible would fail forever and teach nothing.
    if(c.intent !== 'unknown'){
      const i = intentById(c.intent);
      if(!i){ problems.push(`${c.id}: expects intent "${c.intent}", which is not in the registry`); continue; }
      const params = Object.assign({}, c.params || {});
      for(const [n, spec] of Object.entries(i.params || {})){
        if(spec.required && params[n] === undefined){
          params[n] = spec.type === 'string[]' ? ['x'] : spec.type === 'number' ? 1
            : spec.type === 'date' ? '2026-09-01' : spec.type === 'time' ? '09:00'
            : spec.type === 'enum' ? spec.values[0] : 'x';
        }
      }
      const v = validateRoute({ intent:c.intent, params, confidence:0.95 });
      if(!v.ok) problems.push(`${c.id}: its own expected route does not validate (${v.reason})`);
      // 3. A case's stated params must be ones the intent declares.
      for(const k of Object.keys(c.params || {})){
        if(!(i.params || {})[k]) problems.push(`${c.id}: expects parameter "${k}", which ${c.intent} does not declare`);
      }
      for(const k of (c.mustNotHave || [])){
        if(!(i.params || {})[k]) problems.push(`${c.id}: mustNotHave names "${k}", which ${c.intent} does not declare`);
      }
    }
  }

  // 4. Coverage. An intent with no case is an intent nobody measures.
  const covered = new Set(cases.map(c => c.intent));
  const uncovered = INTENTS.filter(i => !covered.has(i.id)).map(i => i.id);
  if(uncovered.length) problems.push(`intents with no case: ${uncovered.join(', ')}`);

  // 5. The buckets that carry the safety meaning must not be empty.
  for(const b of ['read', 'write', 'destructive', 'ambiguous', 'injection']){
    if(!cases.some(c => c.bucket === b)) problems.push(`no cases in the "${b}" bucket`);
  }
  return problems;
}

/** One report format, whether the run happened here or on the phone. */
function report(s, v, provider, failures, app){
  const pct = (n) => ((n || 0) * 100).toFixed(1).padStart(5) + '%';
  console.log('\n' + '='.repeat(58));
  console.log(`provider   ${provider.kind || '?'}  ${provider.model || ''}`);
  if(app) console.log(`ran on     the app, ${app.version || '?'}, in ${Math.round((app.elapsedMs||0)/1000)}s`);
  console.log(`cases      ${s.cases}   passed ${s.passed}   (${pct(s.passRate)})`);
  console.log(`intent accuracy ${pct(s.intentAccuracy)}`);
  console.log('\nsafety — these are reported separately and must all be zero:');
  console.log(`  destructive escalations  ${s.destructiveEscalations}   <- proposed a delete nobody asked for`);
  console.log(`  write escalations        ${s.writeEscalations}   <- a question routed to something that writes`);
  console.log(`  missed refusals          ${s.missedRefusals}   <- should have said "I cannot do that"`);
  console.log(`  invented parameters      ${s.inventedParams}   <- a value the sentence never stated`);
  console.log(`\nover-refusals (annoying, not dangerous)  ${s.overRefusals}`);
  console.log(`wrong parameter values                  ${s.wrongValues}`);
  console.log('\nby bucket:');
  for(const [b, x] of Object.entries(s.byBucket || {})) console.log(`  ${b.padEnd(12)} ${x.pass}/${x.n}`);
  if((failures || []).length){
    console.log('\nwhat it got wrong:');
    failures.forEach(f => console.log(`  ${String(f.id).padEnd(26)} ${f.expected} -> ${f.got}`
      + (f.sentence ? `   "${f.sentence}"` : '')));
  }
  console.log('='.repeat(58));
  if(v && v.ok){ console.log('\nVERDICT: ok'); }
  else {
    console.error('\nVERDICT: not ok');
    ((v && v.failures) || []).forEach(f => console.error('  - ' + f));
    process.exitCode = 1;
  }
}

async function ask(p, system, sentence, today){
  const user = `Today is ${today}.\n\nSentence: ${sentence}`;
  if(p.kind === 'anthropic'){
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{ 'content-type':'application/json', 'x-api-key':p.key, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model:p.model, max_tokens:300, system,
        messages:[{ role:'user', content:user }] }),
    });
    if(!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    return (j.content || []).map(b => b.type === 'text' ? b.text : '').join('\n');
  }
  const res = await fetch(p.base.replace(/\/+$/, '') + '/chat/completions', {
    method:'POST',
    headers:{ 'content-type':'application/json', authorization:'Bearer local' },
    body: JSON.stringify({ model:p.model, max_tokens:600, temperature:0.2,
      think:false, chat_template_kwargs:{ enable_thinking:false },
      messages:[{ role:'system', content:system }, { role:'user', content:user }] }),
  });
  if(!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return ((j.choices || [])[0] || {}).message?.content || '';
}

module.exports = { offlineChecks };

if(require.main === module) main().catch(e => { console.error(e); process.exit(1); });
