/**
 * tools/a11y-audit.js — accessibility audit of the RENDERED DOM.
 *
 *   node tools/a11y-audit.js            # exits 1 if any screen has problems
 *   node tools/a11y-audit.js --only=ask # one screen, while fixing it
 *   PW_EXE=/path/to/chromium node tools/a11y-audit.js
 *
 * The tests in tests-modules.js read the SOURCE; this reads what the browser
 * actually builds, which is the only way to catch a control whose accessible
 * name computes to nothing at runtime. It found exactly that on the Lists
 * screen in v9.1: delete buttons whose only name lived on the <svg> inside.
 *
 * v9.15 — WHY THIS GREW. Until now it walked only the five top-level tabs, and
 * that gap had already cost something: the v9.12 Edit Event review found two
 * defects (chips that were bare `<span onclick>`, and a screen with no <h1>
 * at all) which the v9.1 audit should have caught and could not, because Edit
 * Event is a sub-screen. Three changes close it:
 *
 *   1. Every sub-screen is now visited, each with the state it needs to render
 *      something real rather than an empty state.
 *   2. The seed data is populated. An empty screen has no controls, so it
 *      passes trivially -- which is the least useful kind of green.
 *   3. A missing or duplicated <h1>, and a wrong aria-current count, now FAIL.
 *      They were printed to stderr and then ignored by the exit code, so the
 *      tool could report "no problems found" on a screen with no heading.
 *
 * Chromium, not Safari -- structure, not WebKit behaviour. Logan still checks
 * the installed PWA before a release is called done.
 */
// Playwright is required LAZILY, inside main(). tests-modules.js requires this
// file for its SCREENS table, and `node tests.js` must run on a clean checkout
// with nothing installed -- a top-level require here made the whole suite fail
// with "Cannot find module 'playwright'" on a machine that had never run the
// audit. A test now checks that this require stays inside a function.
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');

const only = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1];

const srv = http.createServer((q, r) => {
  let p = q.url.split('?')[0]; if(p === '/') p = '/index.html';
  const f = path.join(root, p);
  if(!fs.existsSync(f) || fs.statSync(f).isDirectory()){ r.writeHead(404); return r.end(); }
  r.writeHead(200, {'content-type': {'.html':'text/html','.js':'text/javascript',
    '.json':'application/json','.png':'image/png'}[path.extname(f)] || 'text/plain'});
  r.end(fs.readFileSync(f));
});

// A save file with something in every collection. Screens that render an
// empty state expose no controls, so seeding thinly is a way of passing the
// audit without being audited.
const SEED = {
  schemaVersion: 4,
  events: [
    { id:'e1', title:'Winter Recital', date:'2026-12-01', time:'18:00', kind:'event',
      location:'School hall', notes:'Bring a plate', personIds:['k1'], unread:true, deleted:false },
    { id:'e2', title:'Permission slip', date:'2026-08-10', kind:'deadline',
      personIds:['k2'], unread:false, deleted:false },
    { id:'e3', title:'Winter Recital', date:'2026-12-01', kind:'event',
      personIds:[], unread:false, deleted:false },          // a duplicate, for renderDedupe
  ],
  kids: [
    { id:'k1', name:'Olivia', color:'#7C3AED', type:'kid' },
    { id:'k2', name:'Braelyn', color:'#059669', type:'kid' },
    { id:'k3', name:'Dad', color:'#B45309', type:'adult' },
  ],
  chores: [
    { id:'c1', title:'Take out the bins', kidId:'k1', frequency:'daily', stars:2, deleted:false },
    { id:'c2', title:'Tidy the playroom', kidId:null, frequency:'weekly',
      daysOfWeek:'sat', stars:3, deleted:false },
  ],
  completions: [{ id:'x1', choreId:'c1', kidId:'k1', date:'2026-08-20', stars:2 }],
  rewards: [{ id:'r1', title:'Movie night', cost:10, deleted:false }],
  redemptions: [{ id:'d1', kidId:'k1', rewardId:'r1', date:'2026-08-19', cost:10 }],
  problems: [
    { id:'p1', where:'Local model', message:'Fell back to Anthropic: timed out',
      detail:'qwen2.5', first:'2026-08-19T10:00:00Z', last:'2026-08-20T10:00:00Z', count:2, done:false },
    { id:'p2', where:'Watcher', message:'Could not reach the queue',
      first:'2026-08-01T10:00:00Z', last:'2026-08-01T10:00:00Z', count:1, done:true },
  ],
  lists: [{ id:'l1', name:'Costco', deleted:false }, { id:'l2', name:'Hardware', deleted:false }],
  listItems: [
    { id:'i1', listId:'l1', text:'Milk', checked:false, deleted:false },
    { id:'i2', listId:'l1', text:'Eggs', checked:true, deleted:false },
  ],
  ask: { turns: [] },
  settings: {
    apiKey:'x', alerts:{ deadline:[7,1], event:[2,0] }, extraReminders:false,
    watcherUrl:'', watcherToken:'', seenMsgs:[], starCarry:{}, senderTags:{},
    aiProvider:'anthropic', localBaseUrl:'', localModel:'qwen2.5:14b-instruct',
    aiFallback:true, aiEnabled:true, dismissedConflicts:[], theme:'dark',
    exportQueue:[{ id:'e1', title:'Winter Recital', date:'2026-12-01' }],
  },
};

/**
 * Every screen the app can show, and what it takes to get there.
 *
 * `setup` runs INSIDE the page. It puts the app into the state the screen
 * needs and returns nothing; the harness renders afterwards. Anything not
 * listed here is a screen nobody is auditing -- a test below the table checks
 * the list against the app's own `subs` map so a new screen cannot be added
 * without either auditing it or consciously excluding it.
 */
const SCREENS = [
  { key:'events',   setup:`nav('events')` },
  { key:'chores',   setup:`nav('chores')` },
  { key:'lists',    setup:`nav('lists')` },
  { key:'meals',    setup:`nav('meals')` },
  { key:'settings', setup:`nav('settings')` },

  { key:'ask',        setup:`askState = { turns:[], busy:false, error:'', draft:'' }; sub('ask')` },
  // The Ask screen with a pending CONFIRM is a different DOM: a named button,
  // a Cancel, and (v9.14) possibly a row of "which one did you mean?" buttons.
  { key:'ask-confirm', setup:`
      askState = { turns:[{ q:'Delete the recital', a:'Delete "Winter Recital". You can undo it.',
        day: todayISO(), domain:'events', cited:[], sourceNote:'', confirm:true,
        actionName:'Delete Winter Recital', destructive:true }], busy:false, error:'', draft:'' };
      pendingAction = { route:{ ok:true, intent:'delete_event', params:{ event:'recital' } },
        target: S.events[0], collection:'events' };
      sub('ask')` },
  { key:'ask-choices', setup:`
      askState = { turns:[{ q:'add eggs to the shop list', a:'Which one did you mean?',
        day: todayISO(), domain:'lists', cited:[], sourceNote:'',
        choices:[{id:'l1',name:'Costco'},{id:'l2',name:'Hardware'}] }], busy:false, error:'', draft:'' };
      pendingAction = { route:{ ok:true, intent:'add_list_item', params:{ list:'shop', items:['eggs'] } },
        target:null, collection:'lists' };
      sub('ask')` },

  { key:'capture',    setup:`sub('capture')` },
  { key:'review',     setup:`
      pendingEvents = [{ title:'Winter Recital', date:'2026-12-01', time:'18:00', endTime:null,
        kind:'event', location:'School hall', notes:'Bring a plate', selected:true, dup:false,
        personIds:['k1'], kidId:null, aiSource:'claude' }];
      pendingSource = 'assistant'; sub('review')` },
  { key:'eventEdit',  setup:`openEventEdit('e1')` },
  { key:'listDetail', setup:`view = { tab:'lists', sub:'listDetail', data:{ id:'l1' } }` },
  { key:'rewards',    setup:`sub('rewards')` },
  { key:'ledger',     setup:`sub('ledger')` },
  { key:'problems',   setup:`sub('problems')` },
  { key:'senders',    setup:`watchedSenders = ['school.org', 'jane@pta.org']; view = { tab:'settings', sub:'senders', data:null }` },
  { key:'shareEvents',setup:`shareSel = new Set(['e1']); sub('shareEvents')` },
  { key:'pickExport', setup:`sub('pickExport')` },
  { key:'exportQueue',setup:`sub('exportQueue')` },
  { key:'dedupe',     setup:`sub('dedupe')` },
  { key:'recipeBox',  setup:`sub('recipeBox')` },
  { key:'recipeForm', setup:`
      recipeForm = { title:'Pancakes', category:'Breakfast', ingredients:'flour\\nmilk',
        instructions:'1. mix\\n2. cook' };
      recipeBatch = null; sub('recipeForm')` },
  { key:'busy',       setup:`view = { tab:'events', sub:'busy', data:{ msg:'Reading…', hint:'a moment' } }` },
  { key:'compare',    setup:`compareResult = null; sub('compare')` },
  // Two states worth auditing: mid-run (a spinner and a Stop button) and the
  // results, which is where nearly all the controls are.
  { key:'bench',      setup:`
      benchState = { running:false, done:true, i:34, total:34, cancelled:false,
        provider:'anthropic', model:'claude', startedAt:0, ms:41000, error:'',
        results:[
          { id:'a', bucket:'read', sentence:'What is on this week?', expected:'ask_schedule',
            got:'ask_schedule', intentOk:true, pass:true, destructiveEscalation:false,
            writeEscalation:false, missedRefusal:false, overRefusal:false,
            missing:[], wrongValue:[], invented:[] },
          { id:'b', bucket:'write', sentence:'Add a parent teacher meeting', expected:'add_event',
            got:'add_event', intentOk:true, pass:false, destructiveEscalation:false,
            writeEscalation:false, missedRefusal:false, overRefusal:false,
            missing:[], wrongValue:[], invented:['date="2026-09-09"'] },
        ] };
      sub('bench')` },
  { key:'bench-running', setup:`
      benchState = { running:true, done:false, i:7, total:34, cancelled:false,
        provider:'local', model:'qwen2.5:14b-instruct', startedAt:0, ms:0, error:'', results:[] };
      sub('bench')` },
  { key:'selfTest',   setup:`
      selfTestResults = [{ name:'Reaches the model', ok:true, detail:'200 OK' },
                         { name:'Reads an image', ok:false, detail:'no vision support' }];
      sub('selfTest')` },
];

// Exported so tests-modules.js can check this list against the app's own
// `subs` map: a new sub-screen must be added here, or it is a screen nobody
// audits -- the exact gap that let the v9.12 defects through.
module.exports = { SCREENS };

/** Runs in the page. Returns everything wrong with whatever is on screen. */
const AUDIT = () => {
  const problems = [];
  const seen = new Set();
  const add = (s) => { if(!seen.has(s)){ seen.add(s); problems.push(s); } };
  const label = (el) => (el.innerText || el.className || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 34);

  // Anything a person can reach and operate. The tag list alone missed the
  // v9.12 chips, which were focusable spans carrying a role -- so roles and
  // tabindex are part of the net now.
  const OPERABLE = 'button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"]), '
    + '[role="button"], [role="radio"], [role="checkbox"], [role="link"], [role="switch"]';

  document.querySelectorAll(OPERABLE).forEach(el => {
    if(el.type === 'hidden' || el.disabled) return;
    if(el.closest('[aria-hidden="true"]')) return;
    const byId = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    const byLabelledBy = (el.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map(id => id && document.getElementById(id)).filter(Boolean)
      .map(n => n.innerText || '').join(' ');
    const name = (el.getAttribute('aria-label') || '').trim()
      || byLabelledBy.trim()
      || (byId ? (byId.textContent || '').trim() : '')
      || (el.innerText || '').trim()
      || (el.getAttribute('title') || '').trim()
      || (el.tagName === 'INPUT' ? (el.getAttribute('placeholder') || '').trim() : '');
    if(!name) add('unnamed ' + el.tagName.toLowerCase() + ' ' + (el.id || el.className || ''));
  });

  // A control that announces its state must actually have one (WCAG 4.1.2).
  document.querySelectorAll('[role="radio"], [role="checkbox"], [role="switch"]').forEach(el => {
    if(el.getAttribute('aria-checked') == null) add('no aria-checked: ' + label(el));
  });
  document.querySelectorAll('[role="radio"]').forEach(el => {
    if(!el.closest('[role="radiogroup"]')) add('radio outside a radiogroup: ' + label(el));
  });

  // WCAG 2.5.8 target size. Measured on the element's own box; a tall parent
  // does not make a short button easier to hit.
  document.querySelectorAll('button, .chip, .card.row, [role="button"], [role="radio"], [role="checkbox"]')
    .forEach(el => {
      const r = el.getBoundingClientRect();
      // Half a pixel of tolerance: flex layouts land on 43.96 for a control
      // whose min-height IS 44, and reporting that as a defect trains people
      // to ignore the tool.
      if(r.height > 0 && r.height < 43.5) add(`small target ${r.height.toFixed(1)}px: ${label(el)}`);
    });

  // Nothing may sit outside the visible width. A control pushed off the right
  // edge is unreachable, which is how the v9.12 Cancel link was lost.
  const inScroller = (el) => {
    // A horizontally-scrolling strip (the person filter bar) is a legitimate
    // pattern -- what is past the edge is reachable by scrolling the strip,
    // not lost. Only content in a NON-scrolling parent is truly unreachable.
    for(let n = el.parentElement; n && n !== document.body; n = n.parentElement){
      const ox = getComputedStyle(n).overflowX;
      if(ox === 'auto' || ox === 'scroll') return true;
    }
    return false;
  };
  document.querySelectorAll('button, input, textarea, .chip').forEach(el => {
    const r = el.getBoundingClientRect();
    if(r.width > 0 && !inScroller(el) && (r.right > window.innerWidth + 1 || r.left < -1)){
      add(`off-screen horizontally: ${label(el)}`);
    }
  });
  if(document.documentElement.scrollWidth > window.innerWidth + 1){
    add(`page scrolls horizontally (${document.documentElement.scrollWidth}px wide)`);
  }

  // An input needs a visible label or an aria-label; a placeholder alone
  // disappears the moment someone types (NN/g form usability #4).
  document.querySelectorAll('input:not([type=hidden]):not([type=file]), textarea').forEach(el => {
    const hasReal = (el.getAttribute('aria-label') || '').trim()
      || el.getAttribute('aria-labelledby')
      || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
    if(!hasReal) add('placeholder is the only label: ' + (el.id || el.placeholder || el.className));
  });

  const headings = [...document.querySelectorAll('h1')].map(h => (h.innerText || '').trim());
  return {
    problems,
    ariaCurrent: document.querySelectorAll('[aria-current="page"]').length,
    h1: headings.length,
    heading: headings[0] || null,
  };
};

// Only run when invoked directly. tests-modules.js requires this file for its
// SCREENS table, and importing a module must never launch a browser.
if(require.main !== module) return;

(async () => {
  const { chromium } = require('playwright');
  await new Promise(r => srv.listen(8736, r));
  const b = await chromium.launch(process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : {});
  const pg = await b.newPage({ viewport: { width: 393, height: 852 } });
  const pageErrors = [];
  pg.on('pageerror', e => pageErrors.push(e.message));
  await pg.addInitScript((seed) => localStorage.setItem('flyersnap', JSON.stringify(seed)), SEED);
  await pg.goto('http://localhost:8736/');
  await pg.waitForTimeout(500);

  const out = {};
  const failures = [];
  for(const screen of SCREENS){
    if(only && screen.key !== only) continue;
    try{
      await pg.evaluate(`(() => { ${screen.setup}; render(); })()`);
    }catch(e){
      out[screen.key] = { problems: ['could not reach this screen: ' + e.message], ariaCurrent:0, h1:0 };
      failures.push(`${screen.key}: unreachable`);
      continue;
    }
    await pg.waitForTimeout(180);
    const r = await pg.evaluate(AUDIT);
    out[screen.key] = r;
    r.problems.forEach(p => failures.push(`${screen.key}: ${p}`));
    // Landmarks are not advisory. A screen with no heading is a screen a
    // screen-reader user cannot orient on, and it used to pass.
    if(r.h1 !== 1) failures.push(`${screen.key}: expected exactly 1 <h1>, found ${r.h1}`);
    if(r.ariaCurrent !== 1) failures.push(`${screen.key}: expected 1 aria-current, found ${r.ariaCurrent}`);
  }

  console.log(JSON.stringify(out, null, 1));
  pageErrors.forEach(e => failures.push('page error: ' + e));

  if(failures.length){
    console.error('\n' + failures.length + ' problem(s):');
    failures.forEach(f => console.error('  ' + f));
    process.exitCode = 1;
  } else {
    console.log(`\nno problems found across ${Object.keys(out).length} screen(s)`);
  }
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
