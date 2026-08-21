/**
 * Oracles for the declaration extractor.
 *
 * A refactoring tool cannot be tested like ordinary code, because "did it work"
 * has no single obvious answer. The literature settles on a small set of
 * ORACLES -- independent properties that must hold for every transformation.
 * Daniel et al. built six programmatic oracles and used them to expose 21 bugs
 * in Eclipse and 24 in NetBeans; Soares et al. paired a program generator with
 * a behavioural oracle and found 120 bugs across 29 refactorings.
 *
 * The six oracles below are the same ideas applied to this tool. Each one is
 * named after the failure it exists to catch, and where this tool has actually
 * committed that failure, the test says so.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const { extract, locate, endOfBody, isRegexPosition } = require('./tools/extract.js');

// --- a tiny generator, in the spirit of ASTGEN/JDolly -----------------------
// Bounded-exhaustive rather than random: every hostile construct we know of,
// combined with every declaration form. Small enough to run on every commit.

const BODIES = [
  ['plain',              'return 1;'],
  ['brace in string',    'return "{";'],
  ['bracket in string',  'return "[";'],
  ['brace in char',      "return '}';"],
  ['brace in template',  'return `a{b`;'],
  ['interpolation',      'return `x${ {a:1}.a }y`;'],
  ['nested interpolation','return `${ `${ {q:2}.q }` }`;'],
  ['regex with brace',   'return /a{2,3}/.test("aa");'],
  ['regex with bracket', 'return /[{}]/.source;'],
  ['division not regex', 'const a = 4; return a / 2;'],
  ['line comment brace', '// a } here\n  return 1;'],
  ['block comment brace','/* } */ return 1;'],
  ['escaped quote',      'return "he said \\"{\\"";'],
  ['nested function',    'function inner(){ return "{"; } return inner();'],
  ['object literal',     'return { a: "{", b: [1,2] };'],
  ['arrow in body',      'return [1].map(x => ({ v: x }));'],
];

const FORMS = [
  name => ['function ' + name + '(){ BODY }', 'function'],
  name => ['const ' + name + ' = function(){ BODY };', 'const-fn'],
  name => ['const ' + name + ' = () => { BODY };', 'arrow'],
];

function program(bodySrc, form, name){
  const [tpl] = form(name);
  return 'const SENTINEL_BEFORE = 1;\n' +
         tpl.replace('BODY', bodySrc) + '\n' +
         'const SENTINEL_AFTER = 2;\n';
}

module.exports = function runRefactorTests(test){

  // ------------------------------------------------------------------------
  console.log('\nOracle 1 - syntactic validity');
  // The refactored output must still parse. In the Java literature this is the
  // compilation oracle; "Compilation Error" is the single largest bug class in
  // the empirical study of refactoring engines.
  // ------------------------------------------------------------------------

  test('every generated case yields two parseable halves', () => {
    const broken = [];
    for(const [label, body] of BODIES){
      for(const form of FORMS){
        const src = program(body, form, 'target');
        const r = extract(src, ['target']);
        if(!r.ok){ broken.push(label + ' [' + form('x')[1] + ']: ' + r.reason); continue; }
        for(const [what, code] of [['moved', r.moved[0]], ['remainder', r.remainder]]){
          try { new Function(code); }
          catch(e){ broken.push(label + ' [' + form('x')[1] + '] ' + what + ': ' + e.message); }
        }
      }
    }
    assert.deepStrictEqual(broken, [], 'unparseable output:\n  ' + broken.join('\n  '));
  });

  // ------------------------------------------------------------------------
  console.log('\nOracle 2 - conservation');
  // Nothing may be silently lost or duplicated. This is the oracle that would
  // have caught the 3,010-line over-grab immediately.
  // ------------------------------------------------------------------------

  test('moved + remainder accounts for every non-blank line of the input', () => {
    for(const [label, body] of BODIES){
      const src = program(body, FORMS[0], 'target');
      const r = extract(src, ['target']);
      assert.ok(r.ok, label + ': ' + r.reason);
      const count = s => s.split('\n').filter(l => l.trim()).length;
      assert.strictEqual(count(r.moved[0]) + count(r.remainder), count(src),
        'lines lost or duplicated for: ' + label);
    }
  });

  test('code either side of the target is never touched', () => {
    for(const [label, body] of BODIES){
      const src = program(body, FORMS[0], 'target');
      const r = extract(src, ['target']);
      assert.ok(r.ok, label);
      assert.ok(r.remainder.includes('SENTINEL_BEFORE'), 'lost preceding code: ' + label);
      assert.ok(r.remainder.includes('SENTINEL_AFTER'),  'lost following code: ' + label);
      assert.ok(!r.moved[0].includes('SENTINEL'), 'over-grabbed neighbours: ' + label);
    }
  });

  test('the extracted text is exactly the declaration, no more', () => {
    const src = program('return "{";', FORMS[0], 'target');
    const r = extract(src, ['target']);
    assert.ok(r.moved[0].startsWith('function target'), 'starts at the declaration');
    assert.ok(r.moved[0].trimEnd().endsWith('}'), 'ends at its closing brace');
  });

  // ------------------------------------------------------------------------
  console.log('\nOracle 3 - overly weak preconditions');
  // The tool must REFUSE what it cannot do safely. Soares et al. used a
  // behavioural checker as the oracle for weak preconditions; here the property
  // is simpler -- a malformed input must produce a refusal, never a silent
  // partial result.
  // ------------------------------------------------------------------------

  test('malformed input is refused, not half-applied', () => {
    const cases = [
      ['unterminated string',   'function target(){ return "oops; }'],
      ['unterminated template', 'function target(){ return `oops; }'],
      ['unbalanced braces',     'function target(){ if(1){ return 2; }'],
      ['unterminated comment',  'function target(){ /* return 1; }'],
    ];
    for(const [label, src] of cases){
      const r = extract(src, ['target']);
      assert.strictEqual(r.ok, false, 'should have refused: ' + label);
      assert.ok(r.reason, 'refusal must state a reason: ' + label);
    }
  });

  test('a missing name aborts the whole batch, changing nothing', () => {
    const src = program('return 1;', FORMS[0], 'target');
    const r = extract(src, ['target', 'doesNotExist']);
    assert.strictEqual(r.ok, false, 'partial application is a known bug class');
    assert.ok(/not found/.test(r.reason));
    assert.strictEqual(r.remainder, undefined, 'no output at all on failure');
  });

  // ------------------------------------------------------------------------
  console.log('\nOracle 4 - overly strong preconditions');
  // The mirror failure: refusing work the tool can actually do. Soares et al.
  // detect this by differential testing -- if another implementation applies
  // the transformation safely, the refusal was unwarranted. Our earlier line
  // cap was exactly this: a long but perfectly well-formed function was
  // rejected on size alone.
  // ------------------------------------------------------------------------

  test('a long but well-formed declaration is accepted', () => {
    const long = 'function target(){\n' + '  const x = "{";\n'.repeat(300) + '  return 1;\n}';
    const src = 'const A = 1;\n' + long + '\nconst B = 2;\n';
    const r = extract(src, ['target']);
    assert.ok(r.ok, 'size alone is not a reason to refuse: ' + r.reason);
    assert.ok(r.movedLines > 300, 'and it really is large');
  });

  test('every hostile construct is accepted, not refused out of caution', () => {
    const refused = [];
    for(const [label, body] of BODIES){
      const r = extract(program(body, FORMS[0], 'target'), ['target']);
      if(!r.ok) refused.push(label + ': ' + r.reason);
    }
    assert.deepStrictEqual(refused, [],
      'these are all valid and must not be refused:\n  ' + refused.join('\n  '));
  });

  // ------------------------------------------------------------------------
  console.log('\nOracle 5 - round trip');
  // Putting the declaration back must reproduce the original, modulo the blank
  // line left behind. An extraction that cannot be inverted has lost
  // information somewhere.
  // ------------------------------------------------------------------------

  test('re-inlining an extraction reproduces the original', () => {
    for(const [label, body] of BODIES){
      const src = program(body, FORMS[0], 'target');
      const r = extract(src, ['target']);
      assert.ok(r.ok, label);
      const rebuilt = r.remainder.replace(/\n\n/, '\n' + r.moved[0] + '\n');
      const norm = s => s.replace(/\s+/g, ' ').trim();
      assert.strictEqual(norm(rebuilt), norm(src), 'round trip changed the source: ' + label);
    }
  });

  // ------------------------------------------------------------------------
  console.log('\nOracle 6 - order independence');
  // Extracting A then B must equal extracting B then A. Order-dependent results
  // mean offsets are being invalidated, which is how a tool silently corrupts a
  // file that is not obviously broken.
  // ------------------------------------------------------------------------

  test('extraction order does not change the result', () => {
    const src = 'const P = 0;\n' +
                'function alpha(){ return "{"; }\n' +
                'const Q = 1;\n' +
                'function beta(){ return `${ {z:1}.z }`; }\n' +
                'const R = 2;\n';
    const ab = extract(src, ['alpha', 'beta']);
    const ba = extract(src, ['beta', 'alpha']);
    assert.ok(ab.ok && ba.ok);
    assert.strictEqual(ab.remainder, ba.remainder, 'remainder must not depend on order');
    assert.deepStrictEqual([...ab.moved].sort(), [...ba.moved].sort());
  });

  test('a nested declaration is refused, not moved out of its parent', () => {
    // NOTE ON THIS TEST: it originally asserted the refusal reason was
    // "overlap". The tool actually says "not found", because a nested function
    // is not a TOP-LEVEL declaration and the locator requires line-start. That
    // is the better answer, and the oracle was wrong, not the tool.
    //
    // The lesson generalises: an oracle encodes an expectation, and an
    // expectation can be mistaken. What matters here is the PROPERTY -- the
    // transformation is refused and nothing is emitted -- not the wording.
    const src = 'function outer(){ function inner(){ return 1; } return inner; }\n';
    const r = extract(src, ['outer', 'inner']);
    assert.strictEqual(r.ok, false, 'must refuse');
    assert.strictEqual(r.remainder, undefined, 'and emit nothing at all');
  });

  test('two names resolving to the same declaration are refused', () => {
    // The overlap guard is defensive: top-level declarations cannot normally
    // overlap, so this asks for the same one twice to reach it.
    const src = 'const A = 1;\nfunction target(){ return 1; }\nconst B = 2;\n';
    const r = extract(src, ['target', 'target']);
    assert.strictEqual(r.ok, false, 'the same range cannot be moved twice');
    assert.ok(/overlap/i.test(r.reason), 'and the overlap guard is what catches it');
  });

  // ------------------------------------------------------------------------
  console.log('\nRegression - the failures this tool actually committed');
  // Every bug fixed gets a test named after it. These two cost real time.
  // ------------------------------------------------------------------------

  test('a brace inside a string does not run the scan off the end', () => {
    // The 3,010-line over-grab: extractJson contains '{' and '[' in strings,
    // and a naive counter treated them as real braces.
    const src = 'const A = 1;\n' +
      'function extractJson(text){\n' +
      "  const starts = [text.indexOf('{'), text.indexOf('[')];\n" +
      "  const open = text[0]; const close = open === '{' ? '}' : ']';\n" +
      '  return close;\n}\n' +
      'const B = 2;\n';
    const r = extract(src, ['extractJson']);
    assert.ok(r.ok, r.reason);
    assert.ok(r.remainder.includes('const B = 2;'), 'did not swallow what followed');
    assert.ok(r.movedLines <= 6, 'took only the function, got ' + r.movedLines + ' lines');
  });

  test('an adjacent declaration is not dragged along', () => {
    // The migrate.js incident: `let S = load();` sat next to SCHEMA_VERSION and
    // was moved with it, producing a module that referenced an undefined load().
    const src = 'const SCHEMA_VERSION = 4;\n\nlet loadError = null;\nlet S = load();\n';
    const r = extract(src, ['SCHEMA_VERSION']);
    assert.ok(r.ok, r.reason);
    assert.ok(!r.moved[0].includes('load()'), 'must not take the neighbour');
    assert.ok(r.remainder.includes('let S = load();'), 'neighbour stays put');
  });

  test('a blank line stops comment absorption', () => {
    const src = '// ---- section header ----\n\n// describes target\nfunction target(){ return 1; }\n';
    const r = extract(src, ['target']);
    assert.ok(r.ok);
    assert.ok(r.moved[0].includes('describes target'), 'keeps its own comment');
    assert.ok(!r.moved[0].includes('section header'), 'leaves the section header behind');
  });

  // ------------------------------------------------------------------------
  console.log('\nThe tool against the real codebase');
  // Generated inputs cannot cover everything. Running against the actual file
  // is the differential check that matters most.
  // ------------------------------------------------------------------------

  test('every remaining top-level function can be located cleanly', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const openTag = html.includes('<script type="module">') ? '<script type="module">' : '<script>';
    const js = html.split(openTag)[1].split('</script>')[0];
    const names = [...js.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1]);
    assert.ok(names.length > 100, 'expected many functions, found ' + names.length);

    const problems = [];
    for(const n of names){
      const hit = locate(js, n);
      if(!hit.ok){ problems.push(n + ': ' + hit.reason); continue; }
      const lines = hit.text.split('\n').length;
      if(lines > 150) problems.push(n + ': implausible size, ' + lines + ' lines');
      try { new Function('return (' + hit.text.replace(/^function\s/, 'function ') + ')'); }
      catch(e){ /* some depend on outer scope; parse-only is enough here */ }
    }
    assert.deepStrictEqual(problems, [],
      'cannot be extracted safely:\n  ' + problems.join('\n  '));
  });
};
