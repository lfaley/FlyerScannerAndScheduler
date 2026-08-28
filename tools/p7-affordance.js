/**
 * P7 — Affordance and discoverability.  CODE-REVIEW-PLAN.md phase 7.
 *
 *   node tools/p7-affordance.js
 *
 * The source methodology has no equivalent of this phase. It exists because the
 * trigger for this whole review was a UX defect with NO code defect behind it:
 * Logan asked how to dismiss a clash warning, and the answer was that he already
 * could, from two different controls, neither of which said "dismiss".
 *
 * The existing a11y suite passes on that x -- it has an aria-label. The suite has
 * no notion of a VISIBLE label, so this whole class is currently unguarded.
 *
 * A. Icon-only controls: a control whose only name is an aria-label.
 * B. Duplicate actions: one handler reached from two controls with DIFFERENT
 *    visible text, so the same outcome wears two names.
 * C. Destructive controls that are not visually marked as destructive.
 * D. confirm() vs undo-toast: the inventory of which pattern is used where.
 *
 * VALIDATION FIRST. This tool is checked against two facts already established
 * by hand before ANY of its other output is trusted:
 *    - the clash-banner x must appear in A
 *    - dismissConflict must appear in B
 * Six of the seven analysis tools written for this review were wrong on their
 * first run. "The tool said so" is not evidence on this codebase.
 */
'use strict';
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const openTag = html.includes('<script type="module">') ? '<script type="module">' : '<script>';
const script = html.split(openTag)[1].split('</script>')[0];
const off = html.split(openTag)[0].split('\n').length;
const lineAt = (pos) => script.slice(0, pos).split('\n').length + off - 1;

// Every <button ...>...</button> in the shipped script, with its attributes and
// inner text. Icon placeholders are removed so an SVG does not count as a word;
// any OTHER template expression is left in, because it may well render words.
const controls = [];
const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
let m;
while ((m = re.exec(script))) {
  const attrs = m[1];
  const visible = m[2]
    .replace(/\$\{ico\([^}]*\)\}/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const handler = (/on(?:click|change)="([^"]*)"/.exec(attrs) || [])[1] || '';
  // Skip method calls: `document.getElementById('x').click()` must not report
  // its handler as getElementById(). Match only an identifier NOT after a dot.
  const fn = (/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/.exec(
    handler.replace(/^event\.stopPropagation\(\);?/, '')) || [])[1] || '';
  controls.push({
    line: lineAt(m.index), handler, fn, visible,
    // CORRECTION, caught by checking the output against buttons I wrote myself:
    // a ${...} expression very often RENDERS words -- the notes Pin control is
    // `${n.pinned ? 'Unpin' : 'Pin'}` and has a perfectly good visible label.
    // Stripping every expression reported 15 such buttons as nameless. An
    // expression counts as words when it contains a quoted string with letters.
    hasWords: /[A-Za-z]{2}/.test(visible.replace(/\$\{[^}]*\}/g, ' '))
           || /\$\{[^}]*['"][^'"]*[A-Za-z]{2}[^'"]*['"][^}]*\}/.test(visible),
    aria: (/aria-label="([^"]*)"/.exec(attrs) || [])[1] || '',
    red: /\bred\b|danger|--red-accent/.test(attrs),
  });
}

console.log('== A. controls whose only name is an aria-label ==');
const iconOnly = controls.filter(c => !c.hasWords && c.aria);
iconOnly.forEach(c => console.log(
  `   index.html:${String(c.line).padEnd(6)} aria-label="${c.aria}"  ->  ${c.fn || c.handler.slice(0, 40)}`));
const iconNoName = controls.filter(c => !c.hasWords && !c.aria);
console.log(`   ${iconOnly.length} icon-only-with-aria, ${iconNoName.length} icon-only-with-NO-name, of ${controls.length} buttons.`);
iconNoName.forEach(c => console.log(`   NO NAME AT ALL  index.html:${c.line}  -> ${c.fn}`));

console.log('');
console.log('== B. one action, two different visible names ==');
const byFn = new Map();
controls.forEach(c => {
  if (!c.fn) return;
  if (!byFn.has(c.fn)) byFn.set(c.fn, []);
  byFn.get(c.fn).push(c);
});
let dup = 0;
[...byFn.entries()].sort().forEach(([fn, list]) => {
  const names = new Set(list.map(c => c.hasWords ? c.visible : '[icon] ' + c.aria));
  if (names.size < 2) return;
  dup++;
  console.log(`   ${fn}()`);
  [...names].forEach(n => console.log(`      ${n.slice(0, 76)}`));
});
console.log(`   ${dup} handler(s) reached from controls with different names.`);

console.log('');
console.log('== C. destructive controls with no red styling ==');
const DESTRUCTIVE = /^(del|remove|clear|erase|discard|purge|dismiss|forget|startFresh|keepOnly|bulkDelete|applyDedupe|softDelete)/i;
const bare = controls.filter(c => c.fn && DESTRUCTIVE.test(c.fn) && !c.red);
bare.forEach(c => console.log(
  `   index.html:${String(c.line).padEnd(6)} ${(c.fn + '()').padEnd(26)} ${c.hasWords ? '"' + c.visible.slice(0, 44) + '"' : '[icon] ' + c.aria}`));
console.log(`   ${bare.length} destructive control(s) not marked red.`);

console.log('');
console.log('== D. confirm() vs undo-toast ==');
console.log(`   confirm( calls        : ${[...script.matchAll(/[^.\w]confirm\s*\(/g)].length}`);
console.log(`   toasts offering Undo  : ${[...script.matchAll(/label:'Undo'/g)].length}`);
