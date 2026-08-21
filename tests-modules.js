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
  const script = html.split('<script>')[1].split('</script>')[0];

  const handlerNames = new Set();
  const re = /on(?:click|change|input|submit)="\s*([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while((m = re.exec(html)) !== null) handlerNames.add(m[1]);

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

  test('there are handlers to check, so this guard is not vacuous', () => {
    assert.ok(handlerNames.size > 50,
      'expected many inline handlers, found ' + handlerNames.size);
  });
};
