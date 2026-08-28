/**
 * P2-01 REPRODUCTION — compareProviders persists a temporary provider.
 *
 *   node tools/p2-repro-compare-provider.js
 *
 * Builds the same sandbox tests.js builds, loads the REAL index.html script,
 * and watches what the app itself writes to localStorage while a provider
 * comparison is in flight. Nothing here is simulated except the model call and
 * the image read; recordAiCall() -> save() is the app's own code path and runs
 * on every AI call.
 *
 * Expected output on the unfixed build:
 *   BEFORE  {"provider":"local","fallback":true}
 *   DURING  [{"provider":"anthropic","fallback":false},{"provider":"local","fallback":false}]
 *   AFTER   {"provider":"local","fallback":true}
 *
 * The DURING line is the finding: for the length of two model calls, the saved
 * settings say the fallback is OFF. Kill the PWA there -- iOS does this to
 * backgrounded apps routinely -- and the finally block never runs.
 */
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
  const dir = __dirname + '/../js';
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

const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');

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
/*
*/

(async () => {
  const b = box;
  b.localStorage._d = {};
  b.S = b.load();
  b.S.settings.aiProvider = 'local';
  b.S.settings.aiFallback = true;
  b.save();
  const before = JSON.parse(b.localStorage.getItem('flyersnap')).settings;
  console.log('BEFORE  on disk:', JSON.stringify({provider: before.aiProvider, fallback: before.aiFallback}));

  const seen = [];
  b.callAI = async () => {
    // recordAiCall -> save() is what the APP does on every AI call. Nothing here
    // is invented; this just observes what the app writes.
    b.recordAiCall({ op:'compare', provider: b.S.settings.aiProvider, ok:true });
    const d = JSON.parse(b.localStorage.getItem('flyersnap')).settings;
    seen.push({ provider: d.aiProvider, fallback: d.aiFallback });
    return '[]';
  };
  b.readImageDownscaled = async () => ({ base64:'x', mediaType:'image/png' });
  b.parseExtractedEvents = () => [];

  await b.compareProviders({ name:'flyer.png' });
  console.log('DURING  on disk:', JSON.stringify(seen));
  const after = JSON.parse(b.localStorage.getItem('flyersnap')).settings;
  console.log('AFTER   on disk:', JSON.stringify({provider: after.aiProvider, fallback: after.aiFallback}));
})();
