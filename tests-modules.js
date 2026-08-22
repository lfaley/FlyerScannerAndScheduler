/**
 * Module-layer tests. Run as part of `node tests.js`.
 *
 * Two jobs:
 *   1. Verify each extracted module in isolation.
 *   2. Guard the migration itself -- specifically the inline-handler hazard,
 *      which is the thing most likely to break silently during this refactor.
 */
'use strict';
const fs = require('fs');
const assert = require('assert');

module.exports = async function runModuleTests(test){

  console.log('\nExtracted modules');

  const fmt = await import('./js/format.js');

  test('format module exports what the app needs', () => {
    ['todayISO','daysUntil','fmt12','fmtTimeRange','esc']
      .forEach(k => assert.strictEqual(typeof fmt[k], 'function', 'missing: ' + k));
  });

  test('fmt12 matches the behaviour it had inside index.html', () => {
    assert.strictEqual(fmt.fmt12('17:30'), '5:30 PM');
    assert.strictEqual(fmt.fmt12('00:00'), '12:00 AM');
    assert.strictEqual(fmt.fmt12('12:00'), '12:00 PM');
    assert.strictEqual(fmt.fmt12(''), '');
    assert.strictEqual(fmt.fmt12('garbage'), 'garbage');
  });

  test('daysUntil counts whole days regardless of clock time', () => {
    const base = new Date(2026, 7, 21, 23, 30);      // late evening
    assert.strictEqual(fmt.daysUntil('2026-08-22', base), 1, 'tomorrow is 1, not 0');
    assert.strictEqual(fmt.daysUntil('2026-08-21', base), 0);
    assert.strictEqual(fmt.daysUntil('2026-08-20', base), -1);
  });

  test('esc closes every HTML injection route', () => {
    assert.strictEqual(fmt.esc('<script>'), '&lt;script&gt;');
    assert.strictEqual(fmt.esc('a"b'), 'a&quot;b');
    assert.strictEqual(fmt.esc("it's"), 'it&#39;s');
    assert.strictEqual(fmt.esc(null), '');
  });

  // -------------------------------------------------------------------------
  // The migration guard. index.html has ~101 inline onclick handlers, which
  // resolve against the GLOBAL scope. The moment a function moves into an ES
  // module it stops being global, and every handler naming it silently stops
  // working -- no error, just a button that does nothing. We have chased
  // exactly that symptom twice already.
  //
  // This test fails the build instead.
  // -------------------------------------------------------------------------
  console.log('\nInline handlers still resolve');

  const html = fs.readFileSync('index.html', 'utf8');
  const openTag = html.indexOf('<script type="module">') >= 0
    ? '<script type="module">' : '<script>';
  const script = html.split(openTag)[1].split('</script>')[0];

  const handlerNames = new Set();
  // The handlers live inside template literals in the SCRIPT, not in static
  // markup -- scanning the markup alone finds none. But comments in the script
  // also mention handler syntax by way of explanation, and those produce
  // phantom failures. So scan the script with its comments stripped.
  const code = script
    .replace(/^\s*\/\/.*$/gm, '')            // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '');       // block comments
  const re = /on(?:click|change|input|submit)="\s*([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while((m = re.exec(code)) !== null) handlerNames.add(m[1]);

  test('every inline handler names something that exists', () => {
    const missing = [];
    handlerNames.forEach(name => {
      const defined =
        new RegExp('function\\s+' + name + '\\s*\\(').test(script) ||
        new RegExp('(?:const|let|var)\\s+' + name + '\\s*=').test(script) ||
        new RegExp('window\\.' + name + '\\s*=').test(script);
      if(!defined) missing.push(name);
    });
    assert.deepStrictEqual(missing, [],
      'handlers with no definition (a tap on these does nothing): ' + missing.join(', '));
  });

  console.log('\nMigration module');

  const mig = await import('./js/migrate.js');

  test('migrate is pure: same object back, upgraded in place', () => {
    const save = { schemaVersion: 3, events: [], kids: [] };
    const out = mig.migrate(save, 3);
    assert.strictEqual(out, save, 'returns the object it was given');
    assert.strictEqual(out.schemaVersion, mig.SCHEMA_VERSION);
  });

  test('an already-current save is stamped, not re-migrated', () => {
    const save = { schemaVersion: mig.SCHEMA_VERSION, events: [{ id:'e1', unread: true }] };
    mig.migrate(save, mig.SCHEMA_VERSION);
    assert.strictEqual(save.events[0].unread, true, 'existing data untouched');
  });

  test('a v1 save reaches the current version without losing rows', () => {
    const save = { schemaVersion: 1,
      events: [{ id:'e1', title:'Recital', date:'2026-12-01', kidId:'k1' }],
      kids: [{ id:'k1', name:'Olivia' }] };
    mig.migrate(save, 1);
    assert.strictEqual(save.schemaVersion, mig.SCHEMA_VERSION);
    assert.strictEqual(save.events.length, 1, 'no event dropped');
    assert.strictEqual(save.kids.length, 1, 'no person dropped');
  });

  test('running the same migration twice changes nothing the second time', () => {
    const a = { schemaVersion: 1, events: [{ id:'e1', kidId:'k1' }], kids: [{ id:'k1', name:'O' }] };
    mig.migrate(a, 1);
    const once = JSON.stringify(a);
    mig.migrate(a, a.schemaVersion);
    assert.strictEqual(JSON.stringify(a), once, 'migration is idempotent');
  });

  test('SCHEMA_VERSION has a migration block for every step', () => {
    const src = fs.readFileSync('js/migrate.js', 'utf8');
    for(let v = 2; v <= mig.SCHEMA_VERSION; v++){
      assert.ok(src.includes('from < ' + v),
        'no migration guard for version ' + v + ' -- old saves would be stamped current without upgrading');
    }
  });

  console.log('\nService worker caches every module');

  test('the inlined copies match js/ exactly', () => {
    // index.html inlines the modules for delivery, because a failed ES import
    // in the installed PWA kills the whole script and renders a blank screen.
    // That means two copies exist, and the tests exercise the js/ files. If the
    // copies drift, the tests are validating code that does not ship.
    const drifted = [];
    fs.readdirSync('js').filter(f => f.endsWith('.js')).forEach(f => {
      const body = fs.readFileSync('js/' + f, 'utf8')
        .replace(/^export\s+/gm, '').trim();
      // Compare on collapsed whitespace: indentation differs after inlining.
      const norm = s => s.replace(/\s+/g, ' ').trim();
      if(!norm(script).includes(norm(body))) drifted.push(f);
    });
    assert.deepStrictEqual(drifted, [],
      'inlined copy differs from source -- re-run the inline step for: ' + drifted.join(', '));
  });

  test('there are handlers to check, so this guard is not vacuous', () => {
    assert.ok(handlerNames.size > 50,
      'expected many inline handlers, found ' + handlerNames.size);
  });

  // -------------------------------------------------------------------------
  // Fixed-position safety. The .fab buttons are position:fixed DESCENDANTS of
  // <main>. Any transform/perspective/filter on <main> (or html/body) -- even
  // one left behind by a finished animation with fill-mode -- turns it into
  // their containing block, and the "floating" buttons pin to the content
  // instead of the screen. That shipped in v8.6: mid-page overlap on Chores,
  // button invisible on Events. This guard fails the build instead.
  // -------------------------------------------------------------------------
  console.log('\nFixed-position safety');

  const css = html.split('<style>')[1].split('</style>')[0];

  // Selectors whose SUBJECT (last compound) is an ancestor of the fab.
  const isAncestorSubject = sel => sel.split(',').some(s => {
    const last = s.trim().split(/[\s>+~]+/).pop() || '';
    return /^(html|body|main)([.:[]|$)/.test(last);
  });

  test('no animation on an ancestor of .fab animates a containing-block property', () => {
    const offenders = [];
    const ruleRe = /([^{}@]+)\{([^{}]*)\}/g;
    let r;
    while((r = ruleRe.exec(css)) !== null){
      const sel = r[1].trim(), body = r[2];
      if(!isAncestorSubject(sel)) continue;
      const anim = body.match(/animation(?:-name)?\s*:\s*([A-Za-z_][\w-]*)/);
      if(anim){
        const kf = css.match(new RegExp('@keyframes\\s+' + anim[1] + '\\s*\\{[\\s\\S]*?\\}\\s*\\}'));
        if(kf && /transform|perspective|filter/.test(kf[0]))
          offenders.push(sel + ' animates ' + anim[1] + ' (touches transform/perspective/filter)');
      }
      if(/will-change\s*:[^;]*(transform|perspective|filter)|(?:^|;)\s*(transform|perspective|filter)\s*:(?!\s*none)/.test(body))
        offenders.push(sel + ' sets a containing-block property directly');
    }
    assert.deepStrictEqual(offenders, [],
      'these make <main>/<body> the containing block for the fixed .fab buttons: ' + offenders.join('; '));
  });

  test('the fab is still position:fixed, so the guard above is not vacuous', () => {
    assert.ok(/\.fab\s*\{[^}]*position\s*:\s*fixed/.test(css), '.fab is no longer position:fixed');
    assert.ok(/main\.enter\s*\{[^}]*animation/.test(css), 'main.enter no longer animates -- update this guard');
  });
};
