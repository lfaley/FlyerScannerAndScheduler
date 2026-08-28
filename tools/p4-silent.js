/**
 * P4 — Silent failures.  CODE-REVIEW-PLAN.md phase 4.
 *
 *   node tools/p4-silent.js
 *
 * Question: what fails, or succeeds pointlessly, without telling anyone?
 *
 * A. Every catch block, classified by the SHAPE of its body:
 *      empty                  -- nothing at all, not even a reason
 *      comment only           -- swallowed on purpose, with the reason stated
 *      console only           -- visible to a developer, invisible to the user
 *      handled                -- alerts, toasts, logProblem, rethrows, recovers
 *    Only a human can say which of those is a USER'S ACTION FAILING INVISIBLY.
 *    The tool sorts; it does not judge.
 *
 * B. Computed then discarded: a local built out of user-facing words that
 *    nothing later reads. FlyerSnap has a confirmed instance --
 *    fetchEmailQueue() assembles a full "Queue: N items, skipped N already
 *    imported..." report and both callers destructure only { fresh }.
 *
 * C. logProblem() coverage.
 *
 * CORRECTIONS made to this tool before its results were trusted -- both were the
 * same failure this review has now hit three times, method vs. reality:
 *   1. The first version stripped comments to spaces BEFORE measuring the body,
 *      so every catch whose body was only a comment read as EMPTY -- 33 of
 *      them, erasing the exact distinction the phase exists to make.
 *   2. The first version bounded a function at the NEXT `function` keyword, so
 *      top-level constants declared after a function closed were attributed to
 *      it. It reported `const THEME_LABELS` as living inside matchListItems().
 *      Function bodies are now found by brace matching.
 */
'use strict';
const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
const openTag = html.includes('<script type="module">') ? '<script type="module">' : '<script>';
const appOffset = html.split(openTag)[0].split('\n').length;

const files = [
  { name: 'index.html', src: html.split(openTag)[1].split('</script>')[0], offset: appOffset },
  ...fs.readdirSync('js').filter(f => f.endsWith('.js'))
      .map(f => ({ name: 'js/' + f, src: fs.readFileSync('js/' + f, 'utf8'), offset: 1 })),
  { name: 'gmail-watcher.gs', src: fs.readFileSync('gmail-watcher.gs', 'utf8'), offset: 1 },
];

// Body between the braces starting at `from`, using real brace matching.
function block(src, from) {
  let i = src.indexOf('{', from);
  if (i < 0) return null;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return { body: src.slice(i + 1, j), end: j }; }
  }
  return null;
}
const lineAt = (src, pos) => src.slice(0, pos).split('\n').length;
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

// ------------------------------------------------------------------ A
console.log('== A. every catch block, by shape ==');
const rows = [];
for (const f of files) {
  const re = /\bcatch\s*\(/g;
  let m;
  while ((m = re.exec(f.src))) {
    const b = block(f.src, m.index);
    if (!b) continue;
    const raw = b.body.trim();
    const code = decomment(b.body).trim();
    const flat = code.replace(/\s+/g, ' ');
    let shape;
    if (!code && !raw) shape = 'empty';
    else if (!code) shape = 'comment only';
    else if (/^console\.[a-z]+\([^;]*\);?$/.test(flat)) shape = 'console only';
    else shape = 'handled';
    rows.push({ file: f.name, line: lineAt(f.src, m.index) + f.offset - 1, shape,
                code: flat.slice(0, 88), why: raw.replace(/\s+/g, ' ').slice(0, 88) });
  }
}
const count = (s) => rows.filter(r => r.shape === s).length;
console.log(`   ${rows.length} catch blocks across ${files.length} files ` +
  `(${rows.filter(r => r.file === 'index.html').length} index.html, ` +
  `${rows.filter(r => r.file.startsWith('js/')).length} js/, ` +
  `${rows.filter(r => r.file === 'gmail-watcher.gs').length} gmail-watcher.gs).`);
console.log(`   handled ${count('handled')}   comment only ${count('comment only')}   ` +
            `console only ${count('console only')}   empty ${count('empty')}\n`);
['empty', 'console only', 'comment only'].forEach(shape => {
  const list = rows.filter(r => r.shape === shape);
  if (!list.length) return;
  console.log(`   --- ${shape} (${list.length}) ---`);
  list.forEach(r => console.log(`   ${(r.file + ':' + r.line).padEnd(28)} ${shape === 'comment only' ? r.why : r.code}`));
  console.log('');
});

// ------------------------------------------------------------------ B
console.log('== B. computed then discarded ==');
console.log('   CORRECTION: the first rule was "a local nothing reads again inside');
console.log('   the function". It found nothing, and it was the wrong question --');
console.log("   fetchEmailQueue's `report` IS read inside the function (it is in the");
console.log('   return), and discarded by every CALLER. The rule is now: a key on a');
console.log('   returned object literal that no call site anywhere ever reads.');
const app = files[0];
// Everything that is not the shipped script: the suites and the tooling.
const elsewhere = decomment(['tests.js','tests-cases.js','tests-modules.js','tests-refactor.js']
  .map(f => fs.readFileSync(f, 'utf8')).join('\n')
  // Exclude this review's OWN tools: they are prose ABOUT the code, and their
  // comments name the very keys under investigation. Letting them count would
  // make the audit read its own writing as evidence -- CLAUDE.md rule 21 again,
  // now recursively.
  + fs.readdirSync('tools').filter(f => f.endsWith('.js') && !/^p[0-9]-/.test(f))
      .map(f => fs.readFileSync('tools/' + f, 'utf8')).join('\n'));
let unread = 0;
const fnRe = /(?:^|\n)(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*/g;
let fm;
while ((fm = fnRe.exec(app.src))) {
  const b = block(app.src, fm.index + fm[0].length - 1);
  if (!b) continue;
  const fn = fm[1];
  const body = decomment(b.body);
  // Keys on `return { a, b, c }` -- shorthand and `k:` alike.
  const keys = new Set();
  for (const rm of body.matchAll(/return\s*\{([^{}]*)\}/g)) {
    rm[1].split(',').forEach(part => {
      const k = /^\s*(\w+)\s*(?::|$)/.exec(part);
      if (k) keys.add(k[1]);
    });
  }
  if (!keys.size) continue;
  // Everything outside this function is where a caller could read the key.
  // `b.end` is already an ABSOLUTE index into app.src. The first version added
  // it to fm.index + fm[0].length, which skipped a large slice of the file and
  // made three keys look unread that are read plainly a few hundred lines later.
  const outside = decomment(app.src.slice(0, fm.index) + app.src.slice(b.end + 1));
  for (const k of keys) {
    if (k.length < 4) continue;                       // ok, id, at -- too common to mean anything
    const re = new RegExp('[.{,\\s]' + k + '\\b');
    if (re.test(outside)) continue;                   // some other shipped code reads it
    // CORRECTION #2 to this check: "outside" first meant only index.html, which
    // reported a dozen js/ module return keys as unread when the tests read
    // them. A key the TESTS read is a weaker finding than one nothing reads at
    // all, so the two are reported separately rather than lumped together.
    const bucket = re.test(elsewhere) ? 'read only by tests/tools' : 'read by NOTHING';
    unread++;
    console.log(`   ${bucket.padEnd(26)} ${fn}() returns { ... ${k} ... }  index.html:${lineAt(app.src, fm.index) + app.offset}`);
  }
}
if (!unread) console.log('   none.');

// ------------------------------------------------------------------ C
console.log('\n== C. logProblem coverage ==');
console.log(`   logProblem() called from ${[...app.src.matchAll(/logProblem\s*\(/g)].length - 1} site(s) ` +
            `(excluding its own definition).`);
