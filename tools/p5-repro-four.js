/**
 * P5 REPRODUCTION — the four candidates the Aug 2026 review read but never ran.
 *
 *   node tools/p5-repro-four.js
 *
 * CLAUDE.md rule 25: an analysis result is not evidence until it has reproduced
 * something already known to be true. Each block below EXECUTES the app's own
 * function and prints what it returned, so the finding is a measurement rather
 * than a reading of the source.
 *
 *   A  :3723  contextFromPs falls back to another model's window
 *   B  :4599  the probed context is cached for the session, never invalidated
 *   C  :6441  a check_list_item disambiguation loses its itemIds, and a user
 *             with no lists gets an empty "which one?" prompt
 *   D  :6239  clarify options are strings, rendered as {id,name}, behind a gate
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
const b = box;
let confirmed = 0, refuted = 0;
const verdict = (name, isBug, detail) => {
  if(isBug) confirmed++; else refuted++;
  console.log((isBug ? 'CONFIRMED  ' : 'REFUTED    ') + name + '\n            ' + detail);
};

// ============================================================ A  contextFromPs
// Contract, from its own docblock: "Returns null rather than a guess when the
// field is absent ... a made-up number here would produce confident wrong
// advice, which is worse than none."
{
  const ps = { models: [
    { model:'llama3:70b',                context_length: 8192  },
    { model:'qwen3-vl:8b-instruct-q4_K_M', context_length: 32768 },
  ]};
  const asked = b.contextFromPs(ps, 'some-model-that-is-not-loaded');
  verdict('A  contextFromPs guesses another model\'s window',
    asked !== null,
    'asked for a model that is NOT loaded; got ' + JSON.stringify(asked)
    + ' (llama3:70b\'s window). Its own contract says null.');

  // ...and the named lookup still works, so a fix must not break it.
  const named = b.contextFromPs(ps, 'qwen3-vl:8b-instruct-q4_K_M');
  console.log('            control: the right model still resolves -> ' + named);
}

// ============================================================ B  cached forever
// INSIDE the vm: localCtx/localCtxAsked/localCtxFor are lexical bindings, so
// b.localCtx = ... from out here sets a property nothing reads. The first draft
// of this block did exactly that and "confirmed" a finding it never touched.
{
  b.localStorage._d = {};
  vm.runInContext(`
    S = load();
    S.settings.localBaseUrl = 'https://host/v1';
    S.settings.localModel = 'model-a';
    invalidateLocalContext();
    localCtx = 32768; localCtxAsked = true; localCtxFor = localCtxKey();
    globalThis.__before = localCtxFor === localCtxKey();
    S.settings.localModel = 'model-b';
    globalThis.__after = localCtxFor === localCtxKey();
  `, box);
  const before = vm.runInContext('globalThis.__before', box);
  const after  = vm.runInContext('globalThis.__after', box);
  verdict('B  the probed window survives a model change',
    before === true && after === true,
    'measured a window under model-a, then switched to model-b. The cache key '
    + 'still matches: ' + after + '. (Fixed: the key includes the model and the '
    + 'endpoint, so the guard at the top of probeLocalContext cannot answer.)');

  const failClears = /if\(!res\.ok\)\{ localCtxAsked = false; return null; \}/
    .test(vm.runInContext('String(probeLocalContext)', box));
  verdict('B2 one failed probe silences the whole session',
    !failClears,
    'a probe that could not answer ' + (failClears ? 'now clears' : 'still sets')
    + ' localCtxAsked, so the app ' + (failClears ? 'asks again' : 'never asks again')
    + ' this session.');
}

// ============================================================ C  no lists
{
  b.localStorage._d = {};
  b.S = b.load();
  b.S.lists = [];
  b.S.listItems = [];
  b.save();
  const out = b.performRoute
    ? (() => { try { return b.performRoute({ intent:'check_list_item',
        params:{ items:['milk'] }, confidence:0.9 }); } catch(e){ return { err:String(e) }; } })()
    : null;
  Promise.resolve(out).then(r => {
    const choices = r && r.choices;
    verdict('C  "which list?" with no lists at all',
      Array.isArray(choices) && choices.length === 0,
      'a user with no lists asked to tick something off; the app answered '
      + JSON.stringify(r && r.answer) + ' with ' + JSON.stringify(choices)
      + ' -- an empty array is TRUTHY, so the screen renders the question, zero '
      + 'buttons, and a "Neither" link.');

    // ...and the itemIds half: askWhich stores { route, target:null, collection }
    // and never carries the matched item ids, while confirmPendingAction's
    // check_list_item case reads `pa.itemIds`.
    // pendingAction is a LEXICAL binding inside the vm: reading box.pendingAction
    // from out here returns undefined whatever the app did, which would make
    // this "refute" on an artefact of the harness. Read it from INSIDE.
    // (CLAUDE.md rule 25 -- the first draft of this probe did exactly that.)
    const pa = vm.runInContext(
      'JSON.stringify({ keys: pendingAction ? Object.keys(pendingAction) : null,'
      + ' itemIds: pendingAction ? (pendingAction.itemIds === undefined ? "MISSING"'
      + ' : pendingAction.itemIds) : null })', box);
    const paObj = JSON.parse(pa);
    verdict('C2 the disambiguation drops the items it was going to tick',
      paObj.keys !== null && paObj.itemIds === 'MISSING',
      'pendingAction after askWhich has keys ' + JSON.stringify(paObj.keys)
      + '; confirmPendingAction reads pa.itemIds, which is ' + JSON.stringify(paObj.itemIds)
      + ' -> `ids` is [] and it ticks nothing off.');

    // ========================================================== D  clarify
    // The model is told to answer {"clarify":"...","options":["A","B"]}, so the
    // options arrive as STRINGS. The renderer reads c.id and c.name.
    // The turn still carries STRINGS -- that is what the prompt asks for. What
    // matters is the shape that reaches the renderer, so measure THERE.
    const shaped = vm.runInContext(`
      (() => {
        const p = parseAssistantTurn(JSON.stringify(
          { clarify:'Which child is this for?', options:['Braelyn','Owen'] }));
        const raw = p.ok ? p.turn.options : null;
        const toScreen = (typeof clarifyChoices === 'function')
          ? clarifyChoices(raw) : raw;
        return JSON.stringify({ raw, toScreen,
          rendered: (toScreen || []).map(c => ({ id:c && c.id, name:c && c.name })) });
      })()`, box);
    const D = JSON.parse(shaped);
    const blank = D.rendered.some(r => !r.name);
    verdict('D  clarify options reach the screen as blank buttons',
      blank,
      'the prompt (line ~2393) yields ' + JSON.stringify(D.raw)
      + '; the screen gets ' + JSON.stringify(D.rendered)
      + (blank ? ' -- blank buttons.' : ' -- named buttons.'));

    // And the gate above it: choices only render when pendingAction is set,
    // which a clarify turn never sets.
    const ask = vm.runInContext('String(renderAsk)', box);
    const gated = /t\.choices && pendingAction/.test(ask);
    verdict('D2 the gate can never open for a clarify',
      gated,
      'the render condition is ' + (gated
        ? '`t.choices && pendingAction` -- a clarify sets choices and never sets '
          + 'pendingAction, so its buttons are unreachable'
        : 'no longer tied to pendingAction; a clarify renders '
          + (/answerClarify\(/.test(ask) ? 'and answers with the option text' : 'but cannot be answered'))
      + '.');

    console.log('\n' + confirmed + ' confirmed, ' + refuted + ' refuted');
    process.exit(0);
  });
}
