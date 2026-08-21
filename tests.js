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
const el = () => ({ innerHTML:'', className:'', value:'', classList:{ add(){}, remove(){} },
  appendChild(){}, append(){}, remove(){}, click(){}, set href(v){} });

const box = {
  console, assert, localStorage: store,
  document: { getElementById: el, createElement: el, body:{ appendChild(){}, append(){} },
    addEventListener(){}, hidden:false },
  navigator: { share: () => Promise.resolve(), canShare: () => true },
  window: { scrollTo(){}, scrollY:0, open: () => ({}) },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL(){} },
  fetch: () => Promise.resolve({ ok:true, json: () => Promise.resolve({ items:[] }) }),
  setTimeout, clearTimeout,
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
loadModulesInto(box);

const html = fs.readFileSync(__dirname + '/index.html', 'utf8');

// index.html's script is an ES module now. The sandbox runs plain script, so
// strip the import line and inject the imported functions directly -- they come
// from js/format.js, which tests-modules.js covers on its own.
const openTag = html.indexOf('<script type="module">') >= 0
  ? '<script type="module">' : '<script>';
let app = html.split(openTag)[1].split('</script>')[0]
  .split('// ---------- File input wiring ----------')[0]
  .replace(/^import\s+\{[^}]*\}\s+from\s+'[^']*';\s*$/gm, '');

// The bridge assigns to window, which the sandbox does not need and which would
// fail on names trimmed off with the file-input wiring above.
app = app.split('// Bridge for inline handlers.')[0]
         .replace(/Object\.assign\(window,\s*\{[\s\S]*$/, '');

vm.runInContext(app, box, { filename: 'index.html' });
vm.runInContext(fs.readFileSync(__dirname + '/tests-cases.js', 'utf8'), box,
  { filename: 'tests-cases.js' });

// Module-layer tests run after the in-page ones. They use real ES module
// imports, so they must be awaited -- hence the async wrapper.
(async () => {
  try {
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
