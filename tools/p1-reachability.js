/**
 * P1 — Reachability and drift.  CODE-REVIEW-PLAN.md phase 1.
 *
 *   node tools/p1-reachability.js
 *
 * Enumerates, never samples. Every set it reports is complete for the rule it
 * states, and it prints the rule so the enumeration can be argued with.
 *
 * Four questions:
 *   A. Every `export` in js/*.js — does anything that SHIPS or TESTS reach it?
 *   B. Every name in Object.assign(window, {...}) — does any inline handler
 *      actually name it?
 *   C. Every identifier called from an inline on*= attribute — is it defined?
 *   D. Reported, not re-implemented: the js/ ↔ inlined-copy drift check already
 *      lives in tests-modules.js and compares whole file bodies. Re-writing it
 *      here would be a second source of truth for the same rule.
 */
'use strict';
const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
const openTag = html.includes('<script type="module">') ? '<script type="module">' : '<script>';
const script = html.split(openTag)[1].split('</script>')[0];
const modules = fs.readdirSync('js').filter(f => f.endsWith('.js'));
const testSrc = ['tests.js', 'tests-cases.js', 'tests-modules.js', 'tests-refactor.js']
  .map(f => fs.readFileSync(f, 'utf8')).join('\n');
const toolSrc = fs.readdirSync('tools').filter(f => f.endsWith('.js') && f !== 'p1-reachability.js')
  .map(f => fs.readFileSync('tools/' + f, 'utf8')).join('\n');

const line = (s) => console.log(s);
// Comments are prose. A name that appears only inside one is NOT reached --
// certifying dead code by reading a comment is CLAUDE.md rule 21 wearing a
// different hat, so every reachability question below runs on stripped code.
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const idx = (hay, needle) => {
  const at = hay.indexOf(needle);
  return at < 0 ? null : hay.slice(0, at).split('\n').length;
};

// ---------------------------------------------------------------- A
line('== A. js/ exports reachable from something that ships or tests ==');
line('   Rule: an export is REACHED if its name appears in the shipped script,');
line('   in another js/ module, or in tools/. Test-only use is called out');
line('   separately: it means the code is tested but nothing runs it.');
const exportRows = [];
for (const f of modules) {
  const src = fs.readFileSync('js/' + f, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s+(?:const|let|var|class)\s+(\w+)/gm)) names.add(m[1]);
  const siblings = strip(modules.filter(o => o !== f)
    .map(o => fs.readFileSync('js/' + o, 'utf8')).join('\n'));
  for (const n of names) {
    const used = (re) => re.test(strip(script)) ? 'shipped'
      : new RegExp('\\b' + n + '\\b').test(siblings) ? 'sibling module'
      : new RegExp('\\b' + n + '\\b').test(strip(toolSrc)) ? 'tools/'
      : new RegExp('\\b' + n + '\\b').test(strip(testSrc)) ? 'TESTS ONLY'
      : 'UNREACHED';
    exportRows.push({ file: f, name: n, where: used(new RegExp('\\b' + n + '\\b')) });
  }
}
const bad = exportRows.filter(r => r.where === 'UNREACHED' || r.where === 'TESTS ONLY');
line(`   ${exportRows.length} exports across ${modules.length} modules.`);
if (!bad.length) line('   All reached by shipped code, a sibling, or tooling.');
bad.forEach(r => line(`   ${r.where.padEnd(11)} js/${r.file}  ${r.name}`));

// ---------------------------------------------------------------- B
line('\n== B. window exports: is anything actually calling them? ==');
line('   CORRECTION to the first run of this script: the first version asked only');
line('   "does an on*= attribute name it", and reported syncEventForm as unreached.');
line('   That was the wrong question twice over -- handlers are also built by');
line('   string concatenation, which the attribute regex cannot see, and a name');
line('   can be legitimately called from JS. Split into two honest questions.');
const winBlock = (script.match(/Object\.assign\(window, \{[\s\S]*?\n\}\);/) || [''])[0];
const winNames = [...winBlock.matchAll(/^\s{2}(\w+),/gm)].map(m => m[1]);

// Comments are prose. An identifier inside one is not a call site -- the whole
// reason CLAUDE.md rule 21 exists.
const code = strip(script);
const codeNoWin = code.replace(winBlock, ' ');

const attrPairs = [...code.matchAll(/\bon(?:click|change|input|keydown|keyup|blur|focus|submit)="([^"]*)"/g)]
  .map(m => m[1]).join(' ; ');
const namedByHandler = new Set(
  [...attrPairs.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[2]));

const b1 = [], b2 = [];
for (const n of winNames) {
  // Every occurrence outside the bridge block and outside its own definition.
  const callish = new RegExp('(^|[^.\\w$])' + n + '\\s*\\(', 'g');
  const hits = [...codeNoWin.matchAll(callish)].length;
  const defs = [...codeNoWin.matchAll(new RegExp('function\\s+' + n + '\\s*\\(', 'g'))].length;
  if (hits - defs <= 0) b1.push(n);
  else if (!namedByHandler.has(n)) b2.push(n);
}
line(`   ${winNames.length} names on the bridge; ${namedByHandler.size} distinct functions named by a literal on*= attribute.`);
line(`   B1 -- nothing calls it anywhere (dead on the bridge): ${b1.length}`);
b1.forEach(n => line('        ' + n));
line(`   B2 -- called from JS but never from a handler attribute: ${b2.length}`);
line('        (these do not need to be on the bridge; the block says it is');
line('         "generated from the markup", so anything here is hand-added)');
b2.forEach(n => line('        ' + n));
const unnamed = b1;

// ---------------------------------------------------------------- C
line('\n== C. every function called from an inline handler is defined ==');
line('   CORRECTION to the first run: the first version matched any identifier');
line('   followed by "(", so it reported .replace(, .toLowerCase(, .stringify(');
line('   and getElementById( as undefined functions, and picked up "foo" out of');
line('   a COMMENT that explains the bridge. Method vs. prose, again. Now it');
line('   strips comments first and refuses to match after a dot.');
const defined = new Set([...code.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+(\w+)/g)].map(m => m[1]));
for (const m of code.matchAll(/(?:^|\n)\s*(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/g)) defined.add(m[1]);
for (const m of code.matchAll(/(?:^|\n)\s*(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function/g)) defined.add(m[1]);
const BUILTIN = new Set(['event','if','return','alert','confirm','parseInt','parseFloat',
  'String','Number','Boolean','Array','Object','JSON','Math','Date','Set','Map',
  'encodeURIComponent','decodeURIComponent','setTimeout','clearTimeout']);
const missing = [...namedByHandler].filter(n => !defined.has(n) && !BUILTIN.has(n) && !winNames.includes(n));
line(`   ${namedByHandler.size} distinct functions called from handlers.`);
if (!missing.length) line('   Every one resolves to a definition in the shipped script.');
missing.forEach(n => line(`   UNDEFINED  ${n}   first seen index.html:${idx(html, n + '(')}`));

// ---------------------------------------------------------------- D
line('\n== D. js/ <-> inlined copy drift ==');
line('   Not re-implemented here. tests-modules.js "the inlined copies match');
line('   js/ exactly" compares every module body against the shipped script');
line('   with export/import stripped and whitespace collapsed. Run node tests.js.');
const inlineMarkers = [...html.matchAll(/inlined from (js\/[\w.-]+)/g)].map(m => m[1]);
line(`   ${new Set(inlineMarkers).size} modules carry an explicit "inlined from" marker;`);
line(`   the drift test covers all ${modules.length} regardless of marker.`);
const unmarked = modules.filter(f => !inlineMarkers.includes('js/' + f));
line(`   ${unmarked.length} module(s) inlined without a marker comment: ` + unmarked.join(', '));

line('\n== summary ==');
line(`   A exports unreached/test-only : ${bad.length}`);
line(`   B1 window exports nothing calls : ${b1.length}\n   B2 on bridge but no handler uses: ${b2.length}`);
line(`   C handlers with no definition : ${missing.length}`);
