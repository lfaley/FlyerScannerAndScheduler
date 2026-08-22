/**
 * tools/diagnostics.js — read a FlyerSnap diagnostics file on the desktop.
 *
 *   node tools/diagnostics.js flyersnap-diagnostics-2026-08-22.json
 *   node tools/diagnostics.js <file> --errors     # only the failures
 *   node tools/diagnostics.js <file> --all        # every call, not just 40
 *   node tools/diagnostics.js <file> --json       # machine-readable summary
 *
 * The phone writes the file (Settings → Export diagnostics for desktop); this
 * reads it. It is deliberately a separate file from a backup: it carries the
 * AI call log and the manually-reported problem log and nothing else — no
 * events, no notes, no API key — so it is safe to email or AirDrop across.
 *
 * WHAT TO LOOK AT FIRST
 *
 * The health block. A failure rate above a few percent, or a `fellBack` count
 * anywhere near the call count, is the answer to "why is this slow / why does
 * it keep saying the local model is unavailable". Error types are the
 * OpenTelemetry `error.type` classes, so they group the way you would expect:
 * `network` and `timeout` are Logan's desktop being asleep or Tailscale down;
 * `auth` is the API key; `rate_limit` is Anthropic pushing back; `provider_error`
 * is their side; `bad_response` is the model answering with something we could
 * not parse, which usually means a local model narrating instead of answering.
 *
 * No dependencies, no network. Node 18+.
 */
'use strict';
const fs = require('fs');

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const flag = n => args.includes('--' + n);

if(!file){
  console.error('usage: node tools/diagnostics.js <diagnostics.json> [--errors] [--all] [--json]');
  process.exit(2);
}

let d;
try{
  d = JSON.parse(fs.readFileSync(file, 'utf8'));
}catch(e){
  console.error('Could not read ' + file + ': ' + e.message);
  process.exit(2);
}

if(d && d.kind !== 'flyersnap-diagnostics'){
  // A backup file is the likely mistake, and it contains events — say so
  // rather than printing a confusing empty report.
  console.error('That is not a diagnostics file (kind: ' + (d.kind || 'unknown') + ').');
  console.error('Export it from Settings → "Export diagnostics for desktop".');
  process.exit(2);
}

const log = Array.isArray(d.aiLog) ? d.aiLog : [];
const problems = Array.isArray(d.problems) ? d.problems : [];
const s = d.aiSummary || {};

if(flag('json')){
  console.log(JSON.stringify({ app: d.app, summary: s,
    openProblems: problems.filter(p => !p.resolved).length }, null, 2));
  process.exit(0);
}

// ---------- formatting helpers ----------
const pad = (v, n) => String(v == null ? '' : v).padEnd(n);
const padL = (v, n) => String(v == null ? '' : v).padStart(n);
const ms = n => n == null ? '—' : (n >= 1000 ? (n / 1000).toFixed(1) + 's' : n + 'ms');
const clock = iso => {
  if(!iso) return '—';
  const t = new Date(iso);
  return isNaN(t) ? '—' : t.toISOString().slice(0, 16).replace('T', ' ');
};
const rule = (t) => console.log('\n' + t + '\n' + '─'.repeat(Math.max(t.length, 60)));

// ---------- header ----------
const app = d.app || {};
rule('FlyerSnap diagnostics');
console.log('generated   ' + clock(d.generatedAt));
console.log('app         ' + (app.version || 'unknown'));
console.log('provider    ' + (app.provider || '?') + '  model: ' + (app.model || '?'));
console.log('api key     ' + (app.hasApiKey ? 'saved' : 'NOT SAVED') +
            '        AI: ' + (app.aiEnabled ? 'on' : 'OFF'));
if(app.localBaseUrl) console.log('local url   ' + app.localBaseUrl);
if(app.userAgent)    console.log('device      ' + app.userAgent);
if(d.counts) console.log('data        ' + d.counts.events + ' events, ' +
  d.counts.chores + ' chores, ' + d.counts.lists + ' lists');

// ---------- health ----------
rule('AI health');
if(!log.length){
  console.log('No AI calls recorded. Either nothing has been asked since the log');
  console.log('was added, or the log was cleared.');
}else{
  const rate = (s.failureRate || 0) * 100;
  console.log('calls       ' + s.calls + '   ok ' + s.ok + '   failed ' + s.failed +
              '   (' + rate.toFixed(1) + '% failed)');
  console.log('latency     median ' + ms(s.medianMs) + '   slowest ' + ms(s.slowestMs));
  console.log('fell back   ' + (s.fellBack || 0) + ' time(s) from local to Anthropic');
  console.log('tokens      ' + (s.inTokens || 0) + ' in / ' + (s.outTokens || 0) + ' out');
  const types = Object.entries(s.byErrorType || {}).sort((a, b) => b[1] - a[1]);
  if(types.length){
    console.log('failures    ' + types.map(([k, v]) => k + ' ×' + v).join(', '));
  }

  // Per-operation, because "extraction is fine but Ask is failing" is a
  // different problem from "everything is failing".
  const byOp = new Map();
  for(const r of log){
    const k = (r.op || 'unknown') + '  ' + (r.provider || '?');
    const e = byOp.get(k) || { n: 0, bad: 0, t: [] };
    e.n++; if(!r.ok) e.bad++; if(r.ok && typeof r.ms === 'number') e.t.push(r.ms);
    byOp.set(k, e);
  }
  rule('By operation');
  console.log(pad('operation / provider', 30) + padL('calls', 6) + padL('failed', 8) + padL('median', 9));
  for(const [k, e] of [...byOp.entries()].sort((a, b) => b[1].n - a[1].n)){
    e.t.sort((a, b) => a - b);
    console.log(pad(k, 30) + padL(e.n, 6) + padL(e.bad || '', 8) +
                padL(e.t.length ? ms(e.t[Math.floor(e.t.length / 2)]) : '—', 9));
  }
}

// ---------- the calls ----------
const rows = flag('errors') ? log.filter(r => !r.ok) : log;
const shown = flag('all') ? rows : rows.slice(-40);
if(shown.length){
  rule((flag('errors') ? 'Failed calls' : 'Calls') +
       (shown.length < rows.length ? '  (last ' + shown.length + ' of ' + rows.length + ' — use --all)' : ''));
  console.log(pad('when', 18) + pad('op', 20) + pad('prov', 10) + padL('ms', 8) + '  result');
  for(const r of shown){
    const result = r.ok
      ? 'ok' + (r.inTokens != null ? '  ' + r.inTokens + '→' + r.outTokens + ' tok' : '') +
              (r.finish && r.finish !== 'end_turn' ? '  finish:' + r.finish : '')
      : (r.errorType || 'unknown') + (r.status ? ' ' + r.status : '') +
        (r.fellBackTo ? ' → ' + r.fellBackTo : '');
    console.log(pad(clock(r.at), 18) + pad(r.op, 20) + pad(r.provider, 10) + padL(ms(r.ms), 8) + '  ' + result);
    if(!r.ok && r.detail) console.log(' '.repeat(18) + '↳ ' + r.detail.replace(/\s+/g, ' ').slice(0, 140));
  }
}else if(flag('errors')){
  console.log('\nNo failed calls in the log.');
}

// ---------- manual reports ----------
rule('Reported problems (' + problems.filter(p => !p.resolved).length + ' open of ' + problems.length + ')');
if(!problems.length){
  console.log('None.');
}else{
  for(const p of problems.slice(-30)){
    console.log((p.resolved ? '[done] ' : '[open] ') + clock(p.last) +
                '  ' + (p.where || '?') + (p.count > 1 ? '  ×' + p.count : ''));
    console.log('        ' + String(p.message || '').replace(/\s+/g, ' ').slice(0, 160));
    if(p.detail) console.log('        (' + String(p.detail).slice(0, 100) + ')');
  }
}

// ---------- what this most likely means ----------
// Not a diagnosis, a shortlist. Stated as "check X", never as a cause, because
// this file cannot see the network it is describing.
const hints = [];
const t = s.byErrorType || {};
if(t.network || t.timeout) hints.push(
  'network/timeout failures: the desktop running the local model is asleep, or Tailscale is down.');
if(t.auth) hints.push('auth failures: the Anthropic API key is missing, wrong, or revoked.');
if(t.rate_limit) hints.push('rate_limit: Anthropic is throttling — retry later, or slow down bulk imports.');
if(t.bad_response) hints.push(
  'bad_response: the model answered with something unparseable — usually a local model narrating instead of returning JSON.');
if(t.unsupported_input) hints.push('unsupported_input: PDFs and fetched links cannot go to the local model.');
if((s.fellBack || 0) > 0 && s.calls) hints.push(
  'fell back to Anthropic ' + s.fellBack + '× — that path is slow because it waits for local to fail first.');
if(!app.hasApiKey) hints.push('No API key is saved, so every Anthropic call will fail.');
if(hints.length){
  rule('Worth checking');
  hints.forEach(h => console.log('• ' + h));
}
console.log('');
