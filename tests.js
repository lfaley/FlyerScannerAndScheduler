/**
 * FlyerSnap test runner — run with:  node tests.js
 *
 * No dependencies. Loads the <script> out of index.html into a sandbox with the
 * browser bits stubbed, then runs tests-cases.js against it.
 *
 * The cases focus on what would actually hurt: the app must never destroy your
 * data. Add a case whenever a bug gets fixed, so it cannot come back.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const store = {
  _d: {}, _fail: false,
  getItem(k){ return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v){
    if(this._fail){ const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
    this._d[k] = String(v);
  },
  removeItem(k){ delete this._d[k]; },
  key(i){ return Object.keys(this._d)[i]; },
  get length(){ return Object.keys(this._d).length; }
};
// A stand-in element. It must carry everything a REAL element carries that the
// app actually calls, or a code path is untestable for a reason that has
// nothing to do with the code: focus/blur/setSelectionRange were missing until
// v9.60, so every caret-preserving handler in the app (onEventSearch, addItem,
// the list-item editor, the notes search) threw "focus is not a function" the
// moment a test touched it, and so none of them had ever been tested.
const el = () => ({ innerHTML:'', className:'', value:'', textContent:'',
  classList:{ add(){}, remove(){}, toggle(){} },
  selectionStart:0, selectionEnd:0,
  focus(){}, blur(){}, select(){}, setSelectionRange(){},
  appendChild(){}, append(){}, remove(){}, click(){}, set href(v){} });

const box = {
  console, assert, localStorage: store,
  // documentElement and querySelector added v9.80: applyTheme() touches both,
  // so before this it could not be called from a test at all.
  document: { getElementById: el, createElement: el, body:{ appendChild(){}, append(){} },
    documentElement: { setAttribute(){}, removeAttribute(){} },
    querySelector: () => null,
    addEventListener(){}, hidden:false },
  navigator: { share: () => Promise.resolve(), canShare: () => true },
  window: { scrollTo(){}, scrollY:0, open: () => ({}) },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL(){} },
  fetch: () => Promise.resolve({ ok:true, json: () => Promise.resolve({ items:[] }) }),
  setTimeout, clearTimeout,
  // Added v9.80. importBackup -- the single most destructive function in the
  // app -- had NO tests, because the harness had no FileReader. A file here is
  // any object carrying __text.
  FileReader: class {
    readAsText(file){ this.result = (file && file.__text) || ''; if(this.onload) this.onload(); }
  },
  Blob: class { constructor(parts){ box.lastBlob = parts[0]; } },
  File: class { constructor(parts, name){ this.name = name; } },
  alert: (m) => { box.lastAlert = m; },
  confirm: () => true,
  lastBlob: null, lastAlert: null,
  results: { passed: 0, failed: 0 }
};
box.globalThis = box;
vm.createContext(box);

// Stand in for the ES imports at the top of index.html's module. Every file in
// js/ is loaded from source with `export` stripped, so the sandbox can never
// drift from what actually ships -- and a new module needs no runner change.
function loadModulesInto(ctx){
  const dir = __dirname + '/js';
  if(!fs.existsSync(dir)) return;
  fs.readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .sort()                                   // deterministic order
    .forEach(f => {
      const code = fs.readFileSync(dir + '/' + f, 'utf8')
        .replace(/^export\s+/gm, '')
        .replace(/^import\s[^;]*;\s*$/gm, '');   // deps are all loaded here anyway
      vm.runInContext(code, ctx, { filename: 'js/' + f });
    });
}
// index.html now inlines the js/ modules for delivery (a failed ES import in
// the installed PWA blanks the whole app), so loading them here as well would
// redeclare them. tests-modules.js still imports them properly and a test
// asserts the inlined copies match the files.
// loadModulesInto(box);

const html = fs.readFileSync(__dirname + '/index.html', 'utf8');

// index.html's script is an ES module now. The sandbox runs plain script, so
// strip the import line and inject the imported functions directly -- they come
// from js/format.js, which tests-modules.js covers on its own.
const openTag = html.indexOf('<script type="module">') >= 0
  ? '<script type="module">' : '<script>';
// P9 guard (code review, 28 Aug 2026). The two comment banners below decide
// HOW MUCH OF THE APP THIS SUITE EXECUTES. Reword either -- an ordinary edit,
// and nothing used to say otherwise -- and the suite silently changes what it
// runs. Proven in P8: removing the first one made the sandbox load the file-
// input wiring it normally excludes, and the whole run died with
// "addEventListener is not a function" before a single test executed.
//
// This check cannot live in a test: by the time tests run, the damage is done.
// It fails here, early, with a message that says what to do.
const BOUNDARIES = ['// ---------- File input wiring ----------', '// Bridge for inline handlers.'];
BOUNDARIES.forEach(mk => {
  if (html.includes(mk)) return;
  console.error('\n  FAIL  the test harness boundary marker is gone from index.html');
  console.error('        missing: ' + mk);
  console.error('        tests.js splits the app on this exact comment to decide what to');
  console.error('        execute. Restore the wording, or update BOUNDARIES in tests.js.\n');
  process.exit(1);
});

let app = html.split(openTag)[1].split('</script>')[0]
  .split(BOUNDARIES[0])[0]
  .replace(/^import\s+\{[^}]*\}\s+from\s+'[^']*';\s*$/gm, '');

// The bridge assigns to window, which the sandbox does not need and which would
// fail on names trimmed off with the file-input wiring above.
app = app.split(BOUNDARIES[1])[0]
         .replace(/Object\.assign\(window,\s*\{[\s\S]*$/, '');

vm.runInContext(app, box, { filename: 'index.html' });
vm.runInContext(fs.readFileSync(__dirname + '/tests-cases.js', 'utf8'), box,
  { filename: 'tests-cases.js' });

// Module-layer tests run after the in-page ones. They use real ES module
// imports, so they must be awaited -- hence the async wrapper.
(async () => {
  try {
    // Async in-page tests register a promise instead of a result. Settle them
    // BEFORE the summary, or an async failure is printed after the count and
    // never counted (found 28 Aug when node exited 1 on "0 failed").
    if (Array.isArray(box.pendingTests) && box.pendingTests.length) {
      await Promise.all(box.pendingTests);
    }
    const runRefactorTests = require(__dirname + '/tests-refactor.js');
    runRefactorTests((name, fn) => {
      try { fn(); box.results.passed++; console.log('  ok    ' + name); }
      catch(e){ box.results.failed++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
    });

    const runModuleTests = require(__dirname + '/tests-modules.js');
    await runModuleTests((name, fn) => {
      try { fn(); box.results.passed++; console.log('  ok    ' + name); }
      catch(e){ box.results.failed++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
    });
  } catch(e){
    box.results.failed++;
    console.log('  FAIL  module tests could not run\n        ' + e.message);
  }

  console.log('\n' + box.results.passed + ' passed, ' + box.results.failed + ' failed\n');
  process.exitCode = box.results.failed ? 1 : 0;
})();
