/**
 * tools/eval-extraction.js — measure extraction accuracy.
 *
 *   ANTHROPIC_API_KEY=sk-ant-... node tools/eval-extraction.js
 *   node tools/eval-extraction.js --local http://192.168.1.9:11434/v1 qwen3-vl:8b
 *   node tools/eval-extraction.js --read <exported.json>  (a run done on the phone)
 *   node tools/eval-extraction.js --dry          (scorer self-check, no network)
 *
 * Runs every case in eval/cases.json through a provider, scores the result
 * against the hand-labelled expected events, and prints per-field accuracy.
 *
 * Why this exists: before it, "did that prompt change help?" could only be
 * answered by reading a few outputs and forming an impression. That cannot
 * detect a small regression, and it cannot compare two providers fairly.
 *
 * It costs real API tokens. It is NOT part of `node tests.js` -- the test
 * suite must stay free, offline and instant. Run this deliberately, before
 * and after a prompt change, and keep the numbers.
 *
 * The prompt is read from js/prompts.js, so the benchmark always measures the
 * prompt that actually ships.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

async function main(){
  const { scoreExtraction: scoreCase, aggregateExtraction: aggregate, FIELDS } =
    await import(path.join(root, 'js/extract-score.js'));
  const corpus = JSON.parse(fs.readFileSync(path.join(root, 'eval/cases.json'), 'utf8'));
  const cases = corpus.cases;
  const args = process.argv.slice(2);

  // Read a run exported from the phone. The API key lives in the browser's
  // storage, so the run that matters most happens in the app.
  const readIdx = args.indexOf('--read');
  if(readIdx >= 0){
    const file = args[readIdx + 1];
    if(!file){ console.error('usage: node tools/eval-extraction.js --read <exported.json>'); process.exit(2); }
    let d;
    try{ d = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch(e){ console.error('Could not read ' + file + ': ' + e.message); process.exit(2); }
    if(d.kind !== 'flyersnap-extraction-benchmark'){
      console.error('That is not a reading-benchmark export (kind: ' + (d.kind || 'unknown') + ').');
      console.error('Export it from Settings -> "How well does it read paperwork?"');
      process.exit(2);
    }
    const a = d.summary, app = d.app || {};
    const pct = (v) => v === null || v === undefined ? '  n/a' : (v * 100).toFixed(1).padStart(5) + '%';
    console.log('\n' + '='.repeat(52));
    console.log(`ran on     the app, ${app.version || '?'}, ${app.provider || '?'} ${app.model || ''}`);
    console.log(`cases      ${a.cases}   expected ${a.expected}   returned ${a.returned}`);
    console.log(`precision ${pct(a.precision)}   recall ${pct(a.recall)}   f1 ${pct(a.f1)}`);
    console.log(`missed     ${a.missedTotal}`);
    console.log(`INVENTED   ${a.inventedTotal}   <- the failure that matters most`);
    console.log('\nper-field accuracy, within correctly matched events:');
    for(const f of FIELDS) console.log(`  ${f.padEnd(10)} ${pct(a.fields[f].rate)}  (${a.fields[f].right}/${a.fields[f].seen})`);
    const bad = (d.cases || []).filter(c => c.invented.length || c.missed.length || c.transportError);
    if(bad.length){
      console.log('\nwhere it slipped:');
      bad.forEach(c => {
        console.log('  ' + c.id + (c.transportError ? '  CALL FAILED: ' + c.transportError : ''));
        c.invented.forEach(e => console.log(`      INVENTED: ${e.date} ${e.title}`));
        c.missed.forEach(e => console.log(`      missed:   ${e.date} ${e.title}`));
      });
    }
    console.log('='.repeat(52));
    if(a.inventedTotal) process.exitCode = 1;
    return;
  }

  if(args.includes('--dry')){
    // Self-check: score every case against its OWN labels. Anything below a
    // perfect score means the scorer is broken, not the model.
    const results = cases.map(c => scoreCase(c.expected, c.expected));
    const agg = aggregate(results);
    console.log('scorer self-check (expected vs itself):');
    console.log(`  precision ${agg.precision.toFixed(3)}  recall ${agg.recall.toFixed(3)}  f1 ${agg.f1.toFixed(3)}`);
    const bad = FIELDS.filter(f => agg.fields[f].rate !== null && agg.fields[f].rate < 1);
    if(agg.f1 !== 1 || bad.length){
      console.error('  BROKEN: a perfect answer did not score perfectly. Fields off:', bad.join(', '));
      process.exitCode = 1;
    } else {
      console.log('  ok — a perfect answer scores perfectly on every field.');
    }
    return;
  }

  const local = args.indexOf('--local');
  const provider = local >= 0
    ? { kind: 'local', base: args[local + 1], model: args[local + 2] }
    : { kind: 'anthropic', key: process.env.ANTHROPIC_API_KEY, model: process.env.MODEL || 'claude-sonnet-4-6' };

  if(provider.kind === 'anthropic' && !provider.key){
    console.error('Set ANTHROPIC_API_KEY, or pass --local <baseUrl> <model>.');
    console.error('To check the scorer without spending anything: node tools/eval-extraction.js --dry');
    process.exit(1);
  }

  // Read the SHIPPING prompt rather than a copy, so the benchmark can never
  // measure something the app does not actually send.
  const prompts = fs.readFileSync(path.join(root, 'js/prompts.js'), 'utf8');
  const grab = (name) => {
    const m = prompts.match(new RegExp(name + '\\s*=\\s*`([\\s\\S]*?)`;'));
    if(!m) throw new Error('could not read ' + name + ' from js/prompts.js');
    return m[1];
  };
  const system = grab('SECRETARY_PERSONA') + '\n\n' + grab('GROUNDING_EVENTS');

  const results = [];
  for(const c of cases){
    process.stdout.write(`  ${c.id} ... `);
    let events = [];
    try {
      const text = await ask(provider, system, c.source, c.today);
      events = parseEvents(text);
    } catch (err) {
      console.log('ERROR: ' + err.message);
      results.push(scoreCase(c.expected, []));
      continue;
    }
    const r = scoreCase(c.expected, events);
    results.push(r);
    console.log(`p=${r.precision.toFixed(2)} r=${r.recall.toFixed(2)}`
      + (r.invented.length ? `  INVENTED ${r.invented.length}` : '')
      + (r.missed.length ? `  missed ${r.missed.length}` : ''));
    for(const m of r.missed)    console.log(`      missed:   ${m.date} ${m.title}`);
    for(const i of r.invented)  console.log(`      INVENTED: ${i.date} ${i.title}`);
  }

  const agg = aggregate(results);
  const pct = (v) => v === null ? '  n/a' : (v * 100).toFixed(1).padStart(5) + '%';
  console.log('\n' + '='.repeat(52));
  console.log(`provider   ${provider.kind}  ${provider.model || ''}`);
  console.log(`cases      ${agg.cases}   expected ${agg.expected}   returned ${agg.returned}`);
  console.log(`precision ${pct(agg.precision)}   recall ${pct(agg.recall)}   f1 ${pct(agg.f1)}`);
  console.log(`missed     ${agg.missedTotal}`);
  console.log(`INVENTED   ${agg.inventedTotal}   <- the failure that matters most:`);
  console.log(`                a missed flyer gets noticed; an invented event gets trusted`);
  console.log('\nper-field accuracy, within correctly matched events:');
  for(const f of FIELDS) console.log(`  ${f.padEnd(10)} ${pct(agg.fields[f].rate)}  (${agg.fields[f].right}/${agg.fields[f].seen})`);
  console.log('='.repeat(52));

  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  fs.writeFileSync(path.join(root, 'eval/last-run.json'),
    JSON.stringify({ when: stamp, provider: provider.kind, model: provider.model, summary: agg }, null, 2));
  console.log('\nwrote eval/last-run.json — commit it to keep a history of scores.');
}

async function ask(p, system, source, today){
  const user = `Today is ${today}.\n\n${source}`;
  if(p.kind === 'anthropic'){
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': p.key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: p.model, max_tokens: 4000, system, messages: [{ role: 'user', content: user }] }),
    });
    if(!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    return (j.content || []).map(b => b.text || '').join('');
  }
  const res = await fetch(p.base.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: p.model, think: false, chat_template_kwargs: { enable_thinking: false },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if(!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return j.choices?.[0]?.message?.content || '';
}

/**
 * Pull the JSON array out of a model reply. Mirrors what the app does: strip
 * <think> blocks and markdown fences, then scan for the outermost bracket
 * with a STRING-AWARE scanner -- a naive bracket counter is defeated by a
 * bracket inside a quoted string, which is a bug this project has already had.
 */
function parseEvents(text){
  let s = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = s.indexOf('[');
  if(start < 0) return [];
  let depth = 0, inStr = false, esc = false;
  for(let i = start; i < s.length; i++){
    const ch = s[i];
    if(inStr){
      if(esc) esc = false;
      else if(ch === '\\') esc = true;
      else if(ch === '"') inStr = false;
      continue;
    }
    if(ch === '"') inStr = true;
    else if(ch === '[') depth++;
    else if(ch === ']' && --depth === 0){
      const out = JSON.parse(s.slice(start, i + 1));
      return Array.isArray(out) ? out : [];
    }
  }
  return [];
}

main().catch(e => { console.error(e); process.exit(1); });
