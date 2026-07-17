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

const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const app = html.split('<script>')[1].split('</script>')[0]
  .split('// ---------- File input wiring ----------')[0];

vm.runInContext(app, box, { filename: 'index.html' });
vm.runInContext(fs.readFileSync(__dirname + '/tests-cases.js', 'utf8'), box,
  { filename: 'tests-cases.js' });

console.log('\n' + box.results.passed + ' passed, ' + box.results.failed + ' failed\n');
process.exitCode = box.results.failed ? 1 : 0;
