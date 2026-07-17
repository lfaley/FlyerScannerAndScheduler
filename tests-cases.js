/* FlyerSnap test cases — loaded by tests.js into a sandbox that already has the
   app's functions in scope. Run these with:  node tests.js  */

// Silence UI side effects
render = () => {};
toast = () => {};
sub = () => {};

function test(name, fn){
  try { fn(); results.passed++; console.log('  ok    ' + name); }
  catch(e){ results.failed++; console.error('  FAIL  ' + name + '\n        ' + e.message); }
}

const GOOD = JSON.stringify({
  events: [{ id:'e1', title:'Recital', date:'2026-12-01', kind:'event', deleted:false }],
  kids: [{ id:'k1', name:'Olivia', color:'#7C3AED', deleted:false }],
  chores: [], completions: [], rewards: [], redemptions: [],
  lists: [], listItems: [], recipes: [], meals: [],
  settings: { apiKey:'sk-ant-real' }
});
function boot(raw){ localStorage._d = raw ? { flyersnap: raw } : {}; S = load(); }

console.log('\nData safety');

test('unreadable data locks the app instead of starting empty', () => {
  boot('{"events":[{"id":"e1"');
  assert.strictEqual(S.__locked, true);
  assert.ok(loadError, 'reason is captured to show the user');
});

test('unreadable data is quarantined, not thrown away', () => {
  boot('{"events":[{"id":"e1"');
  assert.strictEqual(localStorage.getItem('flyersnap-quarantine'), '{"events":[{"id":"e1"');
});

test('a locked app CANNOT overwrite the original data', () => {
  boot('{"events":[{"id":"e1"');
  S.events.push({ id:'x', title:'new', date:'2026-12-01', kind:'event', deleted:false });
  save();
  assert.strictEqual(localStorage.getItem('flyersnap'), '{"events":[{"id":"e1"');
});

test('valid JSON of the wrong shape is refused', () => {
  boot('{"hello":"world"}');
  assert.strictEqual(S.__locked, true);
  boot('[1,2,3]');
  assert.strictEqual(S.__locked, true);
});

test('healthy data loads with defaults merged in', () => {
  boot(GOOD);
  assert.ok(!S.__locked);
  assert.strictEqual(S.events.length, 1);
  assert.strictEqual(S.settings.apiKey, 'sk-ant-real');
  assert.deepStrictEqual(S.settings.alerts.deadline, [7, 1]);
});

test('a full disk warns loudly, once', () => {
  boot(GOOD);
  storageWarned = false; globalThis.lastAlert = null;
  localStorage._fail = true;
  save();
  assert.ok(/storage on this phone is full/i.test(globalThis.lastAlert || ''));
  globalThis.lastAlert = null;
  save();
  assert.strictEqual(globalThis.lastAlert, null, 'nags once, not every keystroke');
  localStorage._fail = false;
});

console.log('\nSnapshots');

test('a save snapshots the previous good copy', () => {
  boot(GOOD);
  S.events.push({ id:'e2', title:'Game', date:'2026-12-02', kind:'event', deleted:false });
  save();
  const keys = snapshotKeys();
  assert.strictEqual(keys.length, 1);
  assert.strictEqual(localStorage.getItem(keys[0]), GOOD);
});

test('snapshots are throttled to one a day', () => {
  boot(GOOD);
  save(); save(); save();
  assert.strictEqual(snapshotKeys().length, 1);
});

test('old snapshots rotate out', () => {
  boot(GOOD);
  ['2026-01-01', '2026-01-02', '2026-01-03'].forEach(d =>
    localStorage.setItem('flyersnap-snap-' + d, GOOD));
  localStorage.setItem('flyersnap-lastsnapshot', '0');
  save();
  assert.strictEqual(snapshotKeys().length, SNAP_KEEP);
  assert.ok(!snapshotKeys().includes('flyersnap-snap-2026-01-01'), 'oldest goes first');
});

test('the throttle marker never masquerades as a snapshot', () => {
  boot(GOOD);
  localStorage.setItem('flyersnap-lastsnapshot', String(Date.now()));
  assert.ok(!snapshotKeys().some(k => /lastsnapshot|snap-at/.test(k)));
});

test('restoring a snapshot recovers a locked app', () => {
  localStorage._d = { flyersnap: 'garbage{', 'flyersnap-snap-2026-05-05': GOOD };
  S = load();
  assert.strictEqual(S.__locked, true);
  restoreSnapshot('flyersnap-snap-2026-05-05');
  assert.ok(!S.__locked);
  assert.strictEqual(S.events[0].title, 'Recital');
  assert.strictEqual(localStorage.getItem('flyersnap'), JSON.stringify(S));
});

test('a corrupt snapshot is refused rather than swallowed', () => {
  localStorage._d = { flyersnap: 'garbage{', 'flyersnap-snap-2026-06-06': 'nope{' };
  S = load();
  globalThis.lastAlert = null;
  restoreSnapshot('flyersnap-snap-2026-06-06');
  assert.ok(/unreadable/i.test(globalThis.lastAlert || ''));
  assert.strictEqual(S.__locked, true, 'stays locked rather than pretending');
});

console.log('\nGroceries (pantry model)');

test('bought ingredients stay covered until their meal has passed', () => {
  boot(GOOD);
  const days = next7();
  S.recipes.push({ id:'r1', title:'Tacos', ingredients:'1 lb ground beef\ntortillas', deleted:false });
  S.meals.push({ id:'m1', date:days[2], slot:'dinner', title:'Tacos', recipeId:'r1', deleted:false });
  openGroceryBuilder();
  assert.strictEqual(grocerySel.size, 2, 'nothing bought yet');
  addToGrocery();

  S.listItems.forEach(i => { i.checked = true; });          // bought it
  openGroceryBuilder();
  assert.strictEqual(grocerySel.size, 0, 'in the fridge, do not buy again');

  S.listItems.forEach(i => { i.forDate = '2020-01-01'; });  // meal came and went
  openGroceryBuilder();
  assert.strictEqual(grocerySel.size, 2, 'eaten, so buy it again');
});

test('quantities are not silently collapsed', () => {
  boot(GOOD);
  const days = next7();
  S.recipes.push({ id:'r1', title:'Tacos', ingredients:'1 lb ground beef', deleted:false });
  S.recipes.push({ id:'r2', title:'Chili', ingredients:'1 lb ground beef', deleted:false });
  S.meals.push({ id:'m1', date:days[1], slot:'dinner', title:'Tacos', recipeId:'r1', deleted:false });
  S.meals.push({ id:'m2', date:days[3], slot:'dinner', title:'Chili', recipeId:'r2', deleted:false });
  openGroceryBuilder();
  assert.strictEqual(groceryItems.length, 1, 'one line for beef');
  assert.strictEqual(groceryItems[0].count, 2, 'but two pounds of it');
});

console.log('\nSharing');

test('shared events carry no provenance', () => {
  boot(GOOD);
  S.events[0].source = 'dance-flyer.pdf';
  S.events[0].kidId = 'k1';
  openShareEvents();
  shareSel = new Set(['e1']);
  shareAsCalendar();
  assert.ok(globalThis.lastBlob.includes('SUMMARY:Recital'));
  assert.ok(!globalThis.lastBlob.includes('dance-flyer'), 'no flyer name leaks');
  assert.ok(!globalThis.lastBlob.includes('Olivia'), 'no kid tag leaks');
  assert.strictEqual(S.events[0].source, 'dance-flyer.pdf', 'and your own copy is untouched');
});

console.log('\nAlerts');

test('never more than the two alerts iOS will honour', () => {
  boot(GOOD);
  S.settings.alerts.deadline = [14, 7, 3, 1];
  S.settings.extraReminders = false;
  const v = buildVEVENTs({ id:'d1', title:'Signup', date:'2026-08-07', time:'17:00', kind:'deadline' });
  assert.strictEqual(v.length, 1);
  assert.strictEqual((v[0].match(/BEGIN:VALARM/g) || []).length, 2);
});

test('extra lead times become their own entries when asked', () => {
  boot(GOOD);
  S.settings.alerts.deadline = [14, 7, 3, 1];
  S.settings.extraReminders = true;
  const v = buildVEVENTs({ id:'d1', title:'Signup', date:'2026-08-07', time:'17:00', kind:'deadline' });
  assert.strictEqual(v.length, 3, 'main event + the two that would not fit');
  assert.ok(v.join('\n').includes('14 days until: Signup'));
});


