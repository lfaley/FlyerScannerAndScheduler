/**
 * P3 — One fact, one place (including across surfaces). CODE-REVIEW-PLAN.md P3.
 *
 *   node tools/p3-onefact.js
 *
 * Two truths is a guaranteed future bug, because nothing keeps them equal.
 * This project has already shipped two of them this month: the Gordon model tag
 * (four sites in the app plus a fifth in the meal planner) and the watcher queue
 * entry shape (defined once in gmail-watcher.gs and once in index.html, and the
 * two disagreed about whether an entry has a `date`).
 *
 * FlyerSnap's surfaces do not share a module system, so a shared fact can only
 * be a duplicated LITERAL. This finds them.
 *
 * A. Every localStorage / Script Property key literal, and every place it is named.
 * B. Every distinctive literal that appears on more than one SURFACE.
 *    Surfaces: the shipped script, gmail-watcher.gs, sw.js, manifest.json,
 *    deploy.ps1. js/*.js is excluded -- index.html carries inlined copies of it
 *    by design, and the drift test already owns that rule (P1 check D).
 *
 * It NARROWS. Every pair it prints gets a human verdict: shared-on-purpose and
 * pinned, shared-on-purpose and unpinned, or genuinely two truths.
 */
'use strict';
const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
const openTag = html.includes('<script type="module">') ? '<script type="module">' : '<script>';
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const app = strip(html.split(openTag)[1].split('</script>')[0]);

const surfaces = {
  'index.html': app,
  'gmail-watcher.gs': strip(fs.readFileSync('gmail-watcher.gs', 'utf8')),
  'sw.js': strip(fs.readFileSync('sw.js', 'utf8')),
  'manifest.json': fs.readFileSync('manifest.json', 'utf8'),
  'deploy.ps1': fs.readFileSync('deploy.ps1', 'utf8'),
};
const lineOf = (src, needle) => {
  const at = src.indexOf(needle);
  return at < 0 ? '?' : src.slice(0, at).split('\n').length;
};

// ------------------------------------------------------------------ A
console.log('== A. storage keys and Script Properties, and who names them ==');
const keys = new Map();
const add = (k, where) => { if(!keys.has(k)) keys.set(k, new Set()); keys.get(k).add(where); };
for (const [name, src] of Object.entries(surfaces)) {
  for (const m of src.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*['"]([^'"]+)['"]/g)) add(m[1], name);
  for (const m of src.matchAll(/(?:getProperty|setProperty|deleteProperty)\(\s*['"]([^'"]+)['"]/g)) add(m[1] + '  (Script Property)', name);
  for (const m of src.matchAll(/getProp\(\s*['"]([^'"]+)['"]/g)) add(m[1] + '  (Script Property)', name);
}
[...keys.entries()].sort().forEach(([k, where]) => {
  console.log(`   ${k.padEnd(34)} ${[...where].join(', ')}`);
});
console.log(`   ${keys.size} distinct keys.`);

// ------------------------------------------------------------------ B
console.log('\n== B. literals that appear on more than one surface ==');
console.log('   Rule: a quoted literal >= 8 chars, containing no whitespace, that');
console.log('   appears in two or more surfaces. Those surfaces do not share a');
console.log('   module system, so any shared value is a duplicated literal by');
console.log('   necessity -- the question is whether anything keeps them equal.');
const lits = new Map();
for (const [name, src] of Object.entries(surfaces)) {
  for (const m of src.matchAll(/['"]([^'"\s]{8,80})['"]/g)) {
    const v = m[1];
    if (/^[\d.]+$/.test(v)) continue;                 // bare numbers
    if (!lits.has(v)) lits.set(v, new Set());
    lits.get(v).add(name);
  }
}
const shared = [...lits.entries()].filter(([, s]) => s.size > 1).sort();
shared.forEach(([v, s]) => {
  const locs = [...s].map(n => `${n}:${lineOf(surfaces[n], v)}`).join('  ');
  console.log(`   ${v}`);
  console.log(`      ${locs}`);
});
console.log(`   ${shared.length} literal(s) shared across surfaces.`);
