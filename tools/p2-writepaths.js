/**
 * P2 — Write-path and persistence audit.  CODE-REVIEW-PLAN.md phase 2.
 *
 *   node tools/p2-writepaths.js            # the full enumeration
 *   node tools/p2-writepaths.js --risky    # only the ones needing a human verdict
 *
 * The source methodology calls P2 the highest-yield phase and says to run it
 * first if only one phase is run. Its MECHANISM does not transfer -- FlyerSnap
 * has no database, no worker and no server writer -- but its QUESTION does:
 *
 *     can a write be lost?
 *
 * FlyerSnap's version of an interleaving is an `await`. JS is single-threaded,
 * so two functions cannot run at once -- but an `await` yields to the event
 * loop, and a timer, a JSONP callback, a render or a user tap can run in the
 * gap. A function that READS part of S, awaits, then WRITES back what it read
 * is a read-modify-write with a real window in the middle.
 *
 * This tool NARROWS; it does not judge. Every candidate it prints gets read by
 * a human and a verdict recorded in CODE-REVIEW-FINDINGS.md. A tool that
 * pronounced on these would be guessing with extra steps.
 */
'use strict';
const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
const openTag = html.includes('<script type="module">') ? '<script type="module">' : '<script>';
const script = html.split(openTag)[1].split('</script>')[0];
const lines = script.split('\n');
const htmlOffset = html.split(openTag)[0].split('\n').length;   // so line numbers match index.html

// Comments are prose (CLAUDE.md rule 21). Strip them before deciding anything,
// but keep line count identical so reported line numbers stay true.
const stripped = lines.map(l => l.replace(/\/\/.*$/, ' '));

// ---------------------------------------------------------------- functions
// Top-level function boundaries. The shipped script indents nested code, so a
// line starting at column 0 with `function` or `async function` opens one and
// the next such line closes it.
const funcs = [];
lines.forEach((l, i) => {
  const m = /^(async\s+)?function\s+(\w+)\s*\(/.exec(l);
  if (m) funcs.push({ name: m[2], isAsync: !!m[1], start: i, end: lines.length });
});
funcs.forEach((f, i) => { if (funcs[i + 1]) f.end = funcs[i + 1].start; });
const owner = (i) => funcs.find(f => i >= f.start && i < f.end) || { name: '(top level)', isAsync: false, start: 0, end: 0 };

// ---------------------------------------------------------------- the sets
const SAVE = /(^|[^.\w$])save\s*\(\s*\)/;
const S_WRITE = /\bS(?:\.\w+)+\s*(?:=[^=]|\+=|-=)|\bS\.\w+\.(?:push|unshift|splice|pop|shift|sort|reverse)\s*\(|\bS\s*=\s*/;
const S_READ = /\bS\.\w+/;
const AWAIT = /\bawait\b/;

const saveSites = [];
stripped.forEach((l, i) => { if (SAVE.test(l)) saveSites.push(i); });

const settingsWrites = [];
stripped.forEach((l, i) => { if (/\bS\.settings\.\w+\s*=[^=]/.test(l)) settingsWrites.push(i); });

// ---------------------------------------------------------------- verdicts
// A function is a CANDIDATE if, inside it, a read of S is followed by an await
// which is followed by a write to S. That is the only shape that can lose a
// write in a single-threaded runtime.
const candidates = [];
for (const f of funcs) {
  const body = stripped.slice(f.start, f.end);
  const awaits = body.map((l, i) => AWAIT.test(l) ? i : -1).filter(i => i >= 0);
  if (!awaits.length) continue;
  const reads  = body.map((l, i) => S_READ.test(l) ? i : -1).filter(i => i >= 0);
  const writes = body.map((l, i) => S_WRITE.test(l) ? i : -1).filter(i => i >= 0);
  const saves  = body.map((l, i) => SAVE.test(l) ? i : -1).filter(i => i >= 0);
  const firstAwait = awaits[0], lastAwait = awaits[awaits.length - 1];
  const readBefore  = reads.some(r => r < lastAwait);
  const writeAfter  = writes.some(w => w > firstAwait);
  const saveAfter   = saves.some(s => s > firstAwait);
  if (readBefore && (writeAfter || saveAfter)) {
    candidates.push({
      name: f.name,
      line: f.start + htmlOffset,
      awaits: awaits.length,
      firstRead: reads[0] + f.start + htmlOffset,
      firstAwait: firstAwait + f.start + htmlOffset,
      writes: writes.filter(w => w > firstAwait).map(w => w + f.start + htmlOffset),
      saves: saves.filter(s => s > firstAwait).map(s => s + f.start + htmlOffset),
    });
  }
}

const riskyOnly = process.argv.includes('--risky');

if (!riskyOnly) {
  console.log('== the sets, enumerated ==');
  console.log(`   top-level functions in the shipped script : ${funcs.length}`);
  console.log(`   async functions                            : ${funcs.filter(f => f.isAsync).length}`);
  console.log(`   save() call sites                          : ${saveSites.length}`);
  console.log(`   direct S.settings.<key> = writes           : ${settingsWrites.length}`);
  console.log('');
  console.log('== every save() call site, with its enclosing function ==');
  console.log('   "async" marks a function that contains an await ANYWHERE --');
  console.log('   not yet a verdict, just the set that needs one.');
  const byFn = new Map();
  saveSites.forEach(i => {
    const f = owner(i);
    if (!byFn.has(f.name)) byFn.set(f.name, { fn: f, at: [] });
    byFn.get(f.name).at.push(i + htmlOffset);
  });
  [...byFn.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, v]) => {
    const body = stripped.slice(v.fn.start, v.fn.end).join('\n');
    const tag = AWAIT.test(body) ? 'AWAIT ' : '      ';
    console.log(`   ${tag} ${name.padEnd(28)} ${v.at.length}x  index.html:${v.at.join(', ')}`);
  });
  console.log('');
}

console.log('== read -> await -> write candidates (need a human verdict) ==');
console.log('   Rule: inside one function, a read of S occurs before an await,');
console.log('   and a write to S or a save() occurs after one. Everything else');
console.log('   cannot lose a write, because nothing else yields.');
console.log(`   ${candidates.length} candidate(s) out of ${funcs.length} functions.\n`);
candidates.forEach(c => {
  console.log(`   ${c.name}  (index.html:${c.line})`);
  console.log(`      first S read  : ${c.firstRead}`);
  console.log(`      first await   : ${c.firstAwait}   (${c.awaits} await(s) in the function)`);
  if (c.writes.length) console.log(`      S writes after: ${c.writes.join(', ')}`);
  if (c.saves.length)  console.log(`      save() after  : ${c.saves.join(', ')}`);
  console.log('');
});
