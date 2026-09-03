/**
 * tools/browser-check.js — BEHAVIOUR tests in a real browser.
 *
 *   PW_EXE=/opt/pw-browsers/chromium node tools/browser-check.js
 *
 * a11y-audit.js checks what the DOM LOOKS like. This checks what the app DOES
 * when a person actually types and taps: real keystrokes, real clicks on inline
 * onclick handlers, real localStorage. The vm sandbox in tests.js cannot do any
 * of that -- getElementById there returns a fresh stub per call, so a value
 * written into an input is unreadable, and an inline onclick is never dispatched.
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');

const srv = http.createServer((q, r) => {
  let p = q.url.split('?')[0]; if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, {
    'content-type': { '.html': 'text/html', '.js': 'text/javascript',
      '.json': 'application/json', '.png': 'image/png' }[path.extname(f)] || 'text/plain'
  });
  r.end(fs.readFileSync(f));
});

// Enough events that the search box renders (the app only shows it above 8).
const ev = (id, title, date, kind) => ({ id, title, date, kind, time: '', location: '',
  notes: '', personIds: [], kidId: null, unread: false, deleted: false, exported: false });
const SEED = {
  schemaVersion: 4,
  events: [
    ev('e1', 'Winter Recital', '2026-12-01', 'event'),
    ev('e2', 'Permission slip', '2026-11-10', 'deadline'),
    ev('e3', 'Picture Day', '2026-11-12', 'event'),
    ev('e4', 'Book Fair', '2026-11-14', 'event'),
    ev('e5', 'Volleyball Tryouts', '2026-11-16', 'event'),
    ev('e6', 'Field Trip Slip Due', '2026-11-18', 'deadline'),
    ev('e7', 'Chalk the Walk', '2026-11-20', 'event'),
    ev('e8', 'Parent Teacher Night', '2026-11-22', 'event'),
    ev('e9', 'Spring Recital', '2026-11-24', 'event'),
    ev('e10', 'Fun Run', '2026-11-26', 'event'),
  ],
  kids: [{ id: 'k1', name: 'Olivia', color: '#7C3AED', type: 'kid' }],
  chores: [], completions: [], rewards: [], redemptions: [], problems: [],
  lists: [{ id: 'l1', name: 'Costco', deleted: false }],
  listItems: [
    { id: 'i1', listId: 'l1', text: 'Milk', checked: false, deleted: false },
    { id: 'i2', listId: 'l1', text: 'Eggs', checked: false, deleted: false },
  ],
  ask: { turns: [] },
  settings: { apiKey: 'x', alerts: { deadline: [7, 1], event: [2, 0] }, theme: 'dark' },
};

// ---- tiny runner -----------------------------------------------------------
const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  ok    ' + name); }
  catch (e) { results.push({ name, ok: false, err: e.message }); console.log('  FAIL  ' + name + '\n        ' + e.message); }
}
const eq = (got, want, what) => {
  if (got !== want) throw new Error(`${what}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
};

(async () => {
  const { chromium } = require('playwright');
  await new Promise(r => srv.listen(8737, r));
  const b = await chromium.launch(process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : {});
  const pg = await b.newPage({ viewport: { width: 393, height: 852 } });
  const pageErrors = [];
  pg.on('pageerror', e => pageErrors.push(e.message));

  // (b) SEED BEFORE THE PAGE SCRIPT RUNS. addInitScript is evaluated in a fresh
  // context on every navigation, before any of the document's own scripts.
  await pg.addInitScript((seed) => localStorage.setItem('flyersnap', JSON.stringify(seed)), SEED);
  await pg.goto('http://localhost:8737/');
  await pg.waitForTimeout(400);

  // Read the app's save file back out of the REAL localStorage.
  const stored = () => pg.evaluate(() => JSON.parse(localStorage.getItem('flyersnap')));

  await check('the seeded save file is what the app booted from', async () => {
    const t = await pg.locator('#main').innerText();
    if (!/Winter Recital/.test(t)) throw new Error('seeded event not on screen:\n' + t.slice(0, 300));
  });

  // (c) NAVIGATE BY A REAL CLICK on an inline-onclick nav button.
  await check('a real click on the Notes tab dispatches its inline onclick', async () => {
    await pg.getByRole('button', { name: /^Notes$/ }).click();
    await pg.waitForTimeout(150);
    eq(await pg.evaluate(() => view.tab), 'notes', 'view.tab after clicking Notes');
    eq(await pg.locator('[aria-current="page"]').innerText(), 'Notes', 'aria-current moved');
  });

  await check('a real click on the Events tab goes back', async () => {
    await pg.getByRole('button', { name: /^Events$/ }).click();
    await pg.waitForTimeout(150);
    eq(await pg.evaluate(() => view.tab), 'events', 'view.tab after clicking Events');
  });

  // (d) TYPE FOR REAL. Every keystroke fires oninput -> onEventSearch(), which
  // calls renderEvents(m) and REPLACES #main.innerHTML -- destroying the very
  // input being typed into and building a new one. The value only survives
  // because the handler re-seeds it from `eventSearch` and re-focuses.
  await check('typing in the events search survives the re-render it triggers', async () => {
    const box = pg.locator('#evSearch');
    await box.click();
    await pg.keyboard.type('recital', { delay: 30 });
    await pg.waitForTimeout(150);
    eq(await pg.locator('#evSearch').inputValue(), 'recital', '#evSearch value after 7 keystrokes');
    eq(await pg.evaluate(() => document.activeElement && document.activeElement.id), 'evSearch',
      'focus stayed in the search box');
  });

  await check('the re-render actually happened (the list is filtered, not just the box)', async () => {
    const t = await pg.locator('#main').innerText();
    if (/Picture Day/.test(t)) throw new Error('list was not filtered; renderEvents did not run');
    if (!/Recital/.test(t)) throw new Error('matching event vanished');
  });

  // The caret is the part no stub can fake. Move it into the middle of the word
  // and type: if setSelectionRange were not restored after each re-render, every
  // further keystroke would land at the end.
  await check('the caret survives the re-render too (mid-word insertion)', async () => {
    await pg.locator('#evSearch').click();
    await pg.keyboard.press('Home');
    await pg.keyboard.press('ArrowRight');
    await pg.keyboard.press('ArrowRight');
    await pg.keyboard.press('ArrowRight');
    await pg.keyboard.type('XY', { delay: 30 });
    await pg.waitForTimeout(150);
    eq(await pg.locator('#evSearch').inputValue(), 'recXYital', 'value after mid-word typing');
  });

  await check('Clear is a real button that empties the box', async () => {
    await pg.getByRole('button', { name: 'Clear' }).click();
    await pg.waitForTimeout(150);
    eq(await pg.evaluate(() => eventSearch), '', 'eventSearch after Clear');
    const t = await pg.locator('#main').innerText();
    if (!/Picture Day/.test(t)) throw new Error('list did not come back after Clear');
  });

  // (e) CLICK AN INLINE-ONCLICK CONTROL AND ASSERT THE STATE CHANGE.
  // Route there by real taps: Notes tab -> the Costco list card.
  await check('tapping a list card opens it (inline onclick on a div, not a button)', async () => {
    await pg.getByRole('button', { name: /^Notes$/ }).click();
    await pg.waitForTimeout(150);
    // Lists is an AREA of the Notes tab: a chip with onclick="setNotesArea('lists')".
    await pg.locator('.filterbar button', { hasText: 'Lists' }).click();
    await pg.waitForTimeout(150);
    await pg.getByText('Costco', { exact: true }).click();
    await pg.waitForTimeout(200);
    eq(await pg.evaluate(() => view.sub), 'listDetail', 'view.sub after tapping the list');
  });

  await check('tapping an item row toggles it AND writes it to localStorage', async () => {
    eq((await stored()).listItems.find(i => i.id === 'i1').checked, false, 'Milk starts unchecked');
    await pg.getByText('Milk', { exact: true }).click();
    await pg.waitForTimeout(200);
    // in-memory
    eq(await pg.evaluate(() => S.listItems.find(i => i.id === 'i1').checked), true, 'S after the tap');
    // and PERSISTED -- save() ran, not just the render
    eq((await stored()).listItems.find(i => i.id === 'i1').checked, true, 'localStorage after the tap');
    // and REFLECTED in the DOM
    const html = await pg.locator('#main').innerHTML();
    if (!/strike/.test(html)) throw new Error('the row did not render as struck through');
  });

  await check('Add is a real button: type + click adds the item and persists it', async () => {
    await pg.locator('#newItem').click();
    await pg.keyboard.type('Bananas', { delay: 20 });
    await pg.getByRole('button', { name: 'Add' }).click();
    await pg.waitForTimeout(200);
    const items = (await stored()).listItems.filter(i => !i.deleted).map(i => i.text);
    if (!items.includes('Bananas')) throw new Error('not persisted; got ' + JSON.stringify(items));
    if (!/Bananas/.test(await pg.locator('#main').innerText())) throw new Error('not on screen');
  });

  // The draft-wipe class of bug, stated as a check rather than an assumption.
  // Type into the add box, then tap something ELSE that calls render().
  await check('an unsent draft in the add box survives an unrelated re-render', async () => {
    await pg.locator('#newItem').click();
    await pg.keyboard.type('Half typed', { delay: 20 });
    eq(await pg.locator('#newItem').inputValue(), 'Half typed', 'draft before the re-render');
    await pg.getByText('Eggs', { exact: true }).click();   // toggleItem -> save(); render()
    await pg.waitForTimeout(200);
    eq(await pg.locator('#newItem').inputValue(), 'Half typed', 'draft after the re-render');
  });

  // ---- every box that keeps a draft, checked the same way ------------------
  // v9.94 mirrored nine inputs into `drafts`. A mirror nobody exercises is a
  // guard over nothing, so each one is typed into for real, made to survive a
  // real re-render, and (where it has one) made to clear on submit.
  const drafted = [
    { id:'newList',     goto:`nav('notes'); setNotesArea('lists')`,          text:'Hardware' },
    { id:'newNote',     goto:`nav('notes'); setNotesArea('notes')`,          text:'Half a thought' },
    { id:'kidName',     goto:`sub('setPeople')`,                             text:'Braelyn' },
    { id:'rwTitle',     goto:`sub('rewards')`,                               text:'Movie night' },
    { id:'newSender',   goto:`sub('senders')`,                               text:'school.org' },
    { id:'gordonEmail', goto:`sub('setAI')`,                                 text:'me@example.com' },
  ];
  for(const d of drafted){
    await check(`#${d.id} keeps what you typed through a re-render`, async () => {
      await pg.evaluate(g => { drafts = {}; eval(g); }, d.goto);
      await pg.waitForTimeout(150);
      const box = pg.locator('#' + d.id);
      if(await box.count() === 0) throw new Error('the box is not on the screen this test navigated to');
      await box.click();
      await pg.keyboard.type(d.text, { delay: 10 });
      eq(await pg.locator('#' + d.id).inputValue(), d.text, 'value as typed');
      // A re-render nobody asked for, exactly like a background email check or
      // a save-failure banner. This is what used to wipe the box.
      await pg.evaluate(() => render());
      await pg.waitForTimeout(120);
      eq(await pg.locator('#' + d.id).inputValue(), d.text, 'value after an unrelated render()');
    });
  }

  await check('the number box keeps its default until you touch it, then keeps yours', async () => {
    await pg.evaluate(() => { drafts = {}; sub('rewards'); });
    await pg.waitForTimeout(150);
    eq(await pg.locator('#rwCost').inputValue(), '10', 'the untouched default');
    await pg.locator('#rwCost').fill('25');
    await pg.evaluate(() => render());
    await pg.waitForTimeout(120);
    eq(await pg.locator('#rwCost').inputValue(), '25', 'after an unrelated render()');
  });

  await check('submitting empties the box instead of handing the text back', async () => {
    await pg.evaluate(() => { drafts = {}; nav('notes'); setNotesArea('lists'); });
    await pg.waitForTimeout(150);
    await pg.locator('#newList').click();
    await pg.keyboard.type('Hardware', { delay: 10 });
    await pg.getByRole('button', { name: 'Add' }).first().click();
    await pg.waitForTimeout(200);
    const names = await pg.evaluate(() => S.lists.filter(l => !l.deleted).map(l => l.name));
    if(!names.includes('Hardware')) throw new Error('the list was not added: ' + JSON.stringify(names));
    eq(await pg.evaluate(() => draft('newList')), '', 'the draft after submitting');
  });

  await check('a secret is never echoed back into the markup', async () => {
    // #apiKey and #gordonPassword are deliberately NOT mirrored. Re-emitting a
    // secret into HTML is not a fix, and a future sweep must not "complete" it.
    const html = await pg.evaluate(() => document.documentElement.innerHTML);
    if(/id="apiKey"[^>]*value=/.test(html)) throw new Error('the API key box now echoes its value');
    if(/id="gordonPassword"[^>]*value=/.test(html)) throw new Error('the password box now echoes its value');
  });

  await check('the add form refuses a date that does not exist, on screen (v9.97)', async () => {
    // eventFormErrors is unit-tested, but the only thing that CALLS it is
    // saveEventEdit, which opens with syncEventForm() -- it reads the live
    // inputs. In the vm harness every input stub reports value:'', so that path
    // is untestable there, and this is the only place the real one runs.
    await pg.evaluate(() => openNewEvent());
    await pg.waitForTimeout(150);
    // A title nothing in the fixture uses -- 'Spring Recital' is already seeded
    // as e9, so asserting on it would have passed no matter what saved.
    await pg.locator('#efTitle').fill('Kazoo Tryouts');
    // MEASURED, and the reason this is not a .fill(): a real <input type="date">
    // REFUSES an impossible value -- Playwright's fill('2026-02-30') errors, and
    // assigning it leaves the box empty. So the picker can never hand the
    // validator a 30th of February. What can is a value set in code: a pending
    // review row the model wrote, an imported backup, or a browser with no date
    // picker where the field degrades to plain text. That is the case here.
    const shown = await pg.evaluate(() => {
      const el = document.getElementById('efDate');
      el.value = '2026-02-30';
      return el.value;
    });
    if(shown === '2026-02-30')
      throw new Error('this browser now accepts an impossible date in a date input; ' +
        'the premise of this check has changed and it needs rewriting');
    // Degrade the field the way a browser without a date picker does, then type
    // it. saveEventEdit re-reads the live input first, so nothing short of this
    // actually reaches the validator.
    await pg.evaluate(() => {
      const el = document.getElementById('efDate');
      el.type = 'text';
      el.value = '2026-02-30';
      saveEventEdit();
    });
    await pg.waitForTimeout(150);
    const msg = await pg.locator('#err-date').textContent();
    if(!/does not exist/.test(msg || ''))
      throw new Error('the inline message was ' + JSON.stringify(msg));
    const saved = await pg.evaluate(() => S.events.some(e => e.title === 'Kazoo Tryouts'));
    if(saved) throw new Error('the impossible date was saved anyway');
    // And a real one goes through, so the guard is not just refusing everything.
    await pg.locator('#efDate').fill('2026-09-12');
    await pg.evaluate(() => saveEventEdit());
    await pg.waitForTimeout(250);
    const ok2 = await pg.evaluate(() => S.events.some(e => e.title === 'Kazoo Tryouts'));
    if(!ok2) throw new Error('a real date was refused too');
  });

  await check('two "which one?" questions are two real taps, no guess between (v9.98)', async () => {
    // The second question is pushed from inside confirmPendingAction rather
    // than returned, and the choice buttons are only wired to an ID when
    // pendingAction is set. Both are renderer facts the vm harness cannot see
    // (its getElementById hands back a fresh stub every call), so this taps the
    // real buttons on the real Ask screen.
    await pg.evaluate(async () => {
      S.lists = [{ id:'L9', name:'Market', deleted:false }];
      S.listItems = [
        { id:'p1', listId:'L9', text:'Whole milk',     checked:false, deleted:false },
        { id:'p2', listId:'L9', text:'Almond milk',    checked:false, deleted:false },
        { id:'p3', listId:'L9', text:'Grape jam',      checked:false, deleted:false },
        { id:'p4', listId:'L9', text:'Strawberry jam', checked:false, deleted:false },
      ];
      askState.turns = [];
      pendingAction = null;
      save();
      sub('ask');
      const r = await performRoute({ consequence: CONSEQUENCE.CONFIRM, intent:'check_list_item',
        params:{ list:'Market', items:['milk', 'jam'] } });
      askState.turns.push({ q:'tick off milk and jam', a:r.answer, domain:r.domain,
        cited:[], day: todayISO(), sourceNote:'', choices: r.choices || null });
      render();
    });
    await pg.waitForTimeout(250);
    const q1 = await pg.evaluate(() => document.body.innerText);
    if(!/Which "milk"/.test(q1)) throw new Error('the first question was not asked: ' + q1.slice(0, 300));
    await pg.getByRole('button', { name: 'Almond milk', exact: true }).click();
    await pg.waitForTimeout(250);
    const q2 = await pg.evaluate(() => document.body.innerText);
    if(!/Which "jam"/.test(q2)) throw new Error('the second question was not asked: ' + q2.slice(0, 300));
    const midway = await pg.evaluate(() => S.listItems.filter(i => i.checked).map(i => i.id));
    if(midway.length) throw new Error('something was ticked while a question was open: ' + JSON.stringify(midway));
    await pg.getByRole('button', { name: 'Grape jam', exact: true }).click();
    await pg.waitForTimeout(300);
    // Read it back out of REAL localStorage, not memory -- a tick nobody saved
    // is a tick that is gone next time the app opens.
    const saved = await pg.evaluate(() => JSON.parse(localStorage.getItem('flyersnap'))
      .listItems.filter(i => i.checked).map(i => i.id).sort());
    if(JSON.stringify(saved) !== JSON.stringify(['p2', 'p3']))
      throw new Error('wrong rows ticked and saved: ' + JSON.stringify(saved));
  });

  await check('#linkUrl: an overlay misfire keeps the URL, Cancel discards it (v10.1)', async () => {
    // The one draft box the earlier sweep never exercised in a browser. Two
    // things MEASURED here that reading the source does not tell you:
    //   1. this sheet is appended to <body>, not into #main, so it survives a
    //      render() on its own -- the draft mirror is not what saves it;
    //   2. the mirror's real job is the reopen, and until v10.1 the overlay and
    //      the Cancel button called the SAME function, so a deliberate "no" and
    //      a fat-fingered tap beside the sheet did the same thing.
    const URL_ = 'https://school.example/very-long-newsletter-flyer.pdf';
    await pg.evaluate(() => { drafts = {}; openLinkSheet(); });
    await pg.waitForTimeout(200);
    await pg.locator('#linkUrl').click();
    await pg.keyboard.type(URL_, { delay: 4 });
    // (1) a re-render nobody asked for
    await pg.evaluate(() => render());
    await pg.waitForTimeout(150);
    if(!(await pg.locator('#linkUrl').count())) throw new Error('render() removed the sheet');
    eq(await pg.locator('#linkUrl').inputValue(), URL_, 'value after an unrelated render()');
    // (2) the overlay misfire: tap the dark area, reopen, it is still there
    await pg.evaluate(() => window._linkSheet.overlay.click());
    await pg.waitForTimeout(150);
    await pg.evaluate(() => openLinkSheet());
    await pg.waitForTimeout(200);
    eq(await pg.locator('#linkUrl').inputValue(), URL_, 'value after tapping beside the sheet');
    // (3) a real Cancel tap -- a deliberate no
    await pg.getByRole('button', { name: 'Cancel', exact: true }).click();
    await pg.waitForTimeout(150);
    await pg.evaluate(() => openLinkSheet());
    await pg.waitForTimeout(200);
    eq(await pg.locator('#linkUrl').inputValue(), '', 'value after tapping Cancel');
    await pg.evaluate(() => closeLinkSheet());
  });

  await check('every sheet button is reachable, and the nav cannot be tapped through it (v10.1)', async () => {
    // FOUND BY THIS HARNESS, not by reading. The sheet was z-index 20 and its
    // overlay 15, against nav's 30 -- so the nav sat ON TOP of every sheet in
    // the app, undimmed and still clickable, and the LAST button of each one
    // was unreachable. Those buttons are "Cancel", "Remove event" and
    // "Delete N events". A tap there did not do nothing: it switched tabs and
    // left the sheet floating over a different screen.
    //
    // elementFromPoint at each button's own centre, which is what a finger hits.
    // Source-reading cannot see this and the a11y audit does not either -- it
    // renders screens, and a sheet is not a screen.
    const openers = [
      ['the link sheet', () => openLinkSheet()],
      ['an event\u2019s actions', () => eventActions(S.events[0].id)],
      ['bulk tag / delete', () => { selectMode = true; selectedEvents = new Set([S.events[0].id]); bulkTagSheet(); }],
    ];
    for(const [label, open] of openers){
      await pg.evaluate(() => { if(window._linkSheet) closeLinkSheet(); if(typeof closeSheet === 'function') closeSheet(); });
      await pg.evaluate(open);
      await pg.waitForTimeout(220);
      const r = await pg.evaluate(() => {
        const btns = [...document.querySelectorAll('.sheet button')];
        const unreachable = btns.filter(el => {
          const b = el.getBoundingClientRect();
          const hit = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2));
          return !(hit && hit.closest && hit.closest('.sheet'));
        }).map(el => el.textContent.trim().slice(0, 24));
        const nav = document.getElementById('nav');
        const nb = nav.getBoundingClientRect();
        const overNav = document.elementFromPoint(Math.round(nb.left + nb.width / 2), Math.round(nb.top + nb.height / 2));
        return { count: btns.length, unreachable,
          navClickable: !!(overNav && overNav.closest && overNav.closest('nav')) };
      });
      if(r.count < 2) throw new Error(label + ': only ' + r.count + ' buttons found -- the sheet did not open');
      if(r.unreachable.length)
        throw new Error(label + ': a real tap cannot reach ' + JSON.stringify(r.unreachable));
      if(r.navClickable)
        throw new Error(label + ': the nav is still tappable through the modal');
    }
    await pg.evaluate(() => { if(window._linkSheet) closeLinkSheet(); if(typeof closeSheet === 'function') closeSheet();
      selectMode = false; selectedEvents = new Set(); render(); });
  });

  console.log('');
  pageErrors.forEach(e => { console.log('  FAIL  uncaught page error\n        ' + e); results.push({ ok: false }); });
  const bad = results.filter(r => !r.ok).length;
  console.log(`${results.length - bad} passed, ${bad} failed\n`);
  process.exitCode = bad ? 1 : 0;
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
