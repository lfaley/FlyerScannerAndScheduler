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
  // Icon integrity. ico('name') renders <use href="#i-name">. A name with no
  // matching <symbol> renders NOTHING -- no error, no fallback, just a blank
  // gap where a control's icon should be. Same silent-failure shape as the
  // inline-handler hazard above, so it gets the same treatment.
  // -------------------------------------------------------------------------
  console.log('\nIcon sprite integrity');

  // viewBox in the match keeps this to real sprite entries -- the helper's own
  // doc comment names a placeholder symbol id by way of explanation.
  const spriteIds = new Set(
    [...html.matchAll(/<symbol id="i-([\w-]+)" viewBox=/g)].map(m => m[1]));
  // Strict: the literal first argument, plus the icon: field that sheet
  // buttons carry as data. Every one of these MUST resolve to a symbol.
  const referenced = new Set([
    ...[...script.matchAll(/\bico\(\s*'([\w-]+)'/g)].map(m => m[1]),
    ...[...script.matchAll(/\bicon\s*:\s*'([\w-]+)'/g)].map(m => m[1]),
  ]);
  // Loose: any quoted name near an ico( call. This also catches a name chosen
  // by an expression -- the lists screen picks cart-or-note at render time.
  const mentioned = new Set(referenced);
  for(const m of script.matchAll(/\bico\(/g)){
    for(const q of script.slice(m.index, m.index + 140).matchAll(/'([\w-]+)'/g))
      mentioned.add(q[1]);
  }

  test('every icon referenced exists in the sprite', () => {
    const missing = [...referenced].filter(n => !spriteIds.has(n));
    assert.deepStrictEqual(missing, [],
      'ico() names with no <symbol> (these render as blank gaps): ' + missing.join(', '));
  });

  test('the sprite carries no unused symbols', () => {
    const dead = [...spriteIds].filter(n => !mentioned.has(n));
    assert.deepStrictEqual(dead, [], 'symbols nothing references: ' + dead.join(', '));
  });

  test('no emoji left in UI chrome (content emoji are allowed)', () => {
    // Controls must not wear emoji. Reward stars, the celebration banner and
    // the chore-title placeholder example are CONTENT and stay -- they are
    // listed here explicitly so the exception is a decision, not a leak.
    const ALLOWED = new Set(['⭐', '🎉', '🦷']);
    const chrome = [];
    const re = /(?:class="(?:btn|linkbtn|sheetbtn|chip)[^"]*"[^>]*>|label:\s*'|ic:\s*')([^`'<]{0,40})/g;
    let m;
    while((m = re.exec(script)) !== null){
      for(const ch of [...m[1]]){
        if(ch.codePointAt(0) > 0x2100 && !ALLOWED.has(ch) && !'‑–—…→·✓✗›‹'.includes(ch))
          chrome.push(ch + ' in: ' + m[1].trim().slice(0, 30));
      }
    }
    assert.deepStrictEqual(chrome, [],
      'emoji still used as UI chrome -- use ico() instead: ' + chrome.join(' | '));
  });

  test('the inlined <style> matches css/ exactly', () => {
    // Same contract as the js/ modules: css/tokens.css + css/components.css
    // are the source of truth; index.html carries an inlined copy for
    // single-file delivery. tools/inline.js syncs them; this catches drift.
    const stripHeader = s => s.replace(/^\/\*[\s\S]*?\*\/\n/, '');
    const source = ['tokens.css', 'components.css']
      .map(f => stripHeader(fs.readFileSync('css/' + f, 'utf8')).trim()).join('\n');
    const inlined = html.split('<style>')[1].split('</style>')[0];
    const norm = s => s.replace(/\s+/g, ' ').trim();
    assert.strictEqual(norm(inlined), norm(source),
      'index.html <style> differs from css/ -- edit css/, then run: node tools/inline.js');
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

  // -------------------------------------------------------------------------
  // Design-token contrast. Computes real WCAG 2.x ratios (relative luminance
  // per the spec formula) for every foreground/background pair the UI uses,
  // in BOTH themes. A palette tweak that silently drops below AA fails the
  // build with the exact pair named.
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // THE PRODUCTION GUARD. This is the one that exists because the app went
  // dark for real users.
  //
  // v8.1-v8.5 shipped index.html with <script type="module"> and real ES
  // imports. In an installed iOS PWA a failed subresource import kills the
  // ENTIRE script silently: blank background, no error, no console anyone can
  // reach. It reached production and had to be emergency-reverted in v8.6.
  //
  // Modular SOURCE is good and stays (js/*.js, css/*.css). What must never
  // ship is a shipped file that depends on FETCHING anything to boot. If
  // real modules are ever wanted again they need verification on an actual
  // installed PWA first -- the Node sandbox faked imports and green tests
  // gave false confidence. Deleting this test is not the way to pass it.
  // -------------------------------------------------------------------------
  console.log('\nShipped file boots with no subresources');

  test('index.html loads no external script, stylesheet or module', () => {
    const offenders = [];
    if(/<script[^>]*\btype=["']module["']/.test(html)) offenders.push('<script type="module">');
    if(/<script[^>]*\bsrc=/.test(html)) offenders.push('<script src=...>');
    if(/<link[^>]*rel=["']stylesheet["']/.test(html)) offenders.push('<link rel="stylesheet">');
    assert.deepStrictEqual(offenders, [],
      'the shipped file must be self-contained -- a failed fetch blanks the '
      + 'installed PWA (v8.1-v8.5): ' + offenders.join(', '));
  });

  test('the shipped script has no import/export of its own', () => {
    // js/*.js keep their export keywords -- those are SOURCE. The inlined
    // copies must have them stripped, or the script is a module by accident.
    const bad = script.split('\n')
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => /^\s*(?:import\s|export\s|export\{|import\()/.test(l))
      .map(([n, l]) => n + ': ' + l.trim().slice(0, 60));
    assert.deepStrictEqual(bad, [],
      'import/export in the shipped script turns it into a module: ' + bad.join(' | '));
  });

  test('the service worker can cache everything the app needs to boot', () => {
    // Belt and braces on the same failure: if boot ever needs a file the SW
    // does not cache, the app breaks offline instead of on a bad network.
    const sw = fs.readFileSync('sw.js', 'utf8');
    const shell = (sw.match(/const SHELL\s*=\s*\[([^\]]*)\]/) || [,''])[1];
    ['index.html', 'manifest.json'].forEach(f =>
      assert.ok(shell.includes(f), 'sw.js SHELL is missing ' + f));
  });

  // -------------------------------------------------------------------------
  // Accessibility guards. Each one maps to a WCAG 2.2 success criterion and
  // to a failure that is invisible to a sighted developer -- which is exactly
  // why it belongs in the build rather than in a checklist someone re-walks.
  // -------------------------------------------------------------------------
  console.log('\nAccessibility');

  test('pinch-zoom is not blocked (SC 1.4.4 Resize Text)', () => {
    const vp = (html.match(/<meta name="viewport"[^>]*>/) || [''])[0];
    assert.ok(!/user-scalable\s*=\s*(no|0)/i.test(vp), 'user-scalable=no blocks zoom');
    const max = vp.match(/maximum-scale\s*=\s*([\d.]+)/i);
    assert.ok(!max || Number(max[1]) >= 2, 'maximum-scale below 2 blocks zoom');
  });

  test('every text input has an accessible name (SC 4.1.2, 3.3.2)', () => {
    // A placeholder is NOT a name: it vanishes on first keystroke and is not
    // reliably announced. Each input needs aria-label or a <label for>.
    const labelled = new Set(
      [...html.matchAll(/<label[^>]*\bfor="([\w-]+)"/g)].map(m => m[1]));
    const nameless = [];
    for(const m of html.matchAll(/<(input|textarea)\b([^>]*)>/g)){
      const attrs = m[2];
      const id = (attrs.match(/\bid="([\w-]+)"/) || [])[1];
      if(/\btype="(hidden|submit|button)"/.test(attrs)) continue;
      if(/aria-label(?:ledby)?=/.test(attrs)) continue;
      if(id && labelled.has(id)) continue;
      nameless.push(id || attrs.trim().slice(0, 40));
    }
    assert.deepStrictEqual(nameless, [],
      'inputs a screen reader cannot name: ' + nameless.join(', '));
  });

  test('the active tab is marked aria-current (SC 1.4.1, not colour alone)', () => {
    assert.ok(/aria-current="page"/.test(script),
      'nav renders the active tab without aria-current -- colour is the only cue');
  });

  test('landmarks and a page heading exist', () => {
    assert.ok(/<main id="main"[^>]*>/.test(html), 'no main landmark');
    assert.ok(/<nav id="nav"[^>]*aria-label=/.test(html), 'nav landmark has no name');
    assert.ok(/<h1 class="htitle">/.test(script), 'the screen title is not an h1');
  });

  test('the toast is announced (SC 4.1.3 Status Messages)', () => {
    const t = (html.match(/<div class="toast"[^>]*>/) || [''])[0];
    assert.ok(/aria-live="polite"/.test(t) && /role="status"/.test(t),
      'toast is not a live region -- undo offers would be silent: ' + t);
  });

  test('no button contains only an icon without naming itself', () => {
    // The name belongs on the control. ico({title}) also produces a legal
    // name via the image inside, but only aria-label on the button itself is
    // announced identically across VoiceOver, TalkBack and NVDA -- and a DOM
    // audit reading innerText sees nothing otherwise.
    const bad = [];
    for(const m of script.matchAll(/<button\b([^>]*)>\s*\$\{ico\([^)]*\)\}\s*<\/button>/g)){
      if(!/aria-label=/.test(m[1])) bad.push(m[0].slice(0, 70));
    }
    assert.deepStrictEqual(bad, [],
      'icon-only buttons with no aria-label: ' + bad.join(' | '));
  });

  test('decorative icons are hidden from assistive tech', () => {
    assert.ok(/aria-hidden="true"/.test(script),
      'icons beside a text label must be aria-hidden or they are announced twice');
  });

  test('motion respects prefers-reduced-motion (SC 2.3.3)', () => {
    assert.ok(/@media \(prefers-reduced-motion: reduce\)/.test(css), 'no reduced-motion block');
  });

  test('tap targets meet the 44px AAA target (SC 2.5.5)', () => {
    const tap = css.match(/--tap:\s*(\d+)px/);
    assert.ok(tap && Number(tap[1]) >= 44, 'tap token is below 44px');
  });

  console.log('\nDesign token contrast (WCAG AA)');

  const lum = (hex) => {
    const h = hex.length === 4 ? '#' + [...hex.slice(1)].map(c => c + c).join('') : hex;
    const [r, g, b] = [1, 3, 5].map(i => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const parseTokens = (block) => {
    const t = {};
    for(const m of block.matchAll(/--([\w-]+)\s*:\s*(#[0-9A-Fa-f]{3,8})\s*[;}]/g)) t[m[1]] = m[2];
    return t;
  };

  const rootBlock = css.split(':root{')[1].split('}')[0];
  const darkBlock = (css.split('prefers-color-scheme: dark')[1] || '').split('@media')[0];
  const light = parseTokens(rootBlock);
  const dark  = Object.assign({}, light, parseTokens(darkBlock));

  // [foreground, background, minimum, where it is used]
  const PAIRS = [
    ['ink', 'bg', 4.5, 'body text'],
    ['ink', 'card', 4.5, 'card titles'],
    ['muted', 'card', 4.5, 'card meta'],
    ['muted', 'bg', 4.5, 'help text'],
    ['faint', 'card', 4.5, 'provenance lines'],
    ['faint', 'bg', 4.5, 'version stamp, captions'],
    ['accent', 'card', 4.5, 'links on cards'],
    ['accent', 'bg', 4.5, 'links on page'],
    ['accent', 'green-lt', 4.5, 'badges, sheet buttons'],
    ['on-accent', 'green', 4.5, 'button labels, header'],
    ['on-accent', 'red', 4.5, 'urgent badges'],
    ['on-accent', 'amber', 4.5, 'NEW flags'],
    ['red-accent', 'card', 4.5, 'destructive links'],
    ['red-accent', 'red-lt', 4.5, 'danger sheet buttons'],
    ['amber-accent', 'card', 4.5, 'unseen chip'],
    ['amber-accent', 'bg', 4.5, 'problem-log button'],
    ['bg', 'ink', 4.5, 'toast text'],
    ['placeholder', 'card', 3.0, "empty checkboxes (non-text UI, WCAG 1.4.11)"],
  ];

  for(const [theme, tokens] of [['light', light], ['dark', dark]]){
    test(`${theme} palette meets AA on every used pair`, () => {
      const bad = [];
      for(const [fg, bg, min, use] of PAIRS){
        assert.ok(tokens[fg], `token --${fg} missing in ${theme}`);
        assert.ok(tokens[bg], `token --${bg} missing in ${theme}`);
        const r = ratio(tokens[fg], tokens[bg]);
        if(r < min) bad.push(`--${fg} on --${bg} = ${r.toFixed(2)} (needs ${min}; ${use})`);
      }
      assert.deepStrictEqual(bad, [], theme + ' contrast failures: ' + bad.join('; '));
    });
  }

  test('no raw colors outside the token blocks (kid palette and tap-highlights excepted)', () => {
    const body = css.replace(/:root\{[\s\S]*?\}/, '').replace(/@media \(prefers-color-scheme: dark\)\{[\s\S]*?\}\s*\}/, '');
    const raw = [];
    for(const m of body.matchAll(/[^{};]*(?:#[0-9A-Fa-f]{3,8}\b|rgba?\([^)]*\))[^;}]*/g)){
      if(!/tap-highlight/.test(m[0])) raw.push(m[0].trim().slice(0, 60));
    }
    assert.deepStrictEqual(raw, [], 'raw colors that must become tokens: ' + raw.join(' | '));
  });
};
